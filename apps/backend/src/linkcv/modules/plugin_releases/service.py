from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from minio.error import S3Error
from pydantic import ValidationError

from linkcv.core.errors import ApiError
from linkcv.modules.plugin_releases.schemas import PluginRelease, PluginReleasePointer
from linkcv.modules.plugin_releases.validator import (
    ValidatedPluginPackage,
    parse_version,
    validate_plugin_package,
)

POINTER_MAX_BYTES = 16 * 1024
ZIP_CONTENT_TYPE = "application/zip"
JSON_CONTENT_TYPE = "application/json"
RELEASE_PREFIX = "system/plugin-releases/"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PluginReleasePublishResult:
    pointer: PluginReleasePointer
    cleanup_pending: bool


def _not_found(error: Exception) -> bool:
    return (
        isinstance(error, S3Error) or hasattr(error, "code")
    ) and getattr(error, "code", None) in {"NoSuchKey", "NoSuchObject"}


def _close_response(response: Any) -> None:
    try:
        response.close()
    finally:
        response.release_conn()


class PluginReleaseService:
    def __init__(self, storage: Any) -> None:
        self.storage = storage
        self._publish_lock = threading.Lock()

    @property
    def pointer_key(self) -> str:
        return "system/plugin-releases/current.json"

    def object_key(self, version: str) -> str:
        return (
            f"system/plugin-releases/v{version}/"
            f"linkcv-job-capture-v{version}.zip"
        )

    def release_from_pointer(self, pointer: PluginReleasePointer) -> PluginRelease:
        return PluginRelease(
            version=pointer.version,
            released_at=pointer.released_at,
            size=pointer.size,
            sha256=pointer.sha256,
            download_url=f"/api/plugin-releases/{pointer.version}/download",
        )

    def _read_pointer(self) -> PluginReleasePointer | None:
        try:
            response = self.storage.get(self.pointer_key)
        except Exception as error:
            if _not_found(error):
                return None
            raise ApiError(503, "PLUGIN_RELEASE_STORAGE_UNAVAILABLE") from error
        try:
            raw = response.read(POINTER_MAX_BYTES + 1)
        except Exception as error:
            raise ApiError(503, "PLUGIN_RELEASE_STORAGE_UNAVAILABLE") from error
        finally:
            _close_response(response)
        if len(raw) > POINTER_MAX_BYTES:
            raise ApiError(503, "PLUGIN_RELEASE_INVALID_POINTER")
        try:
            pointer = PluginReleasePointer.model_validate_json(raw)
            parse_version(pointer.version)
        except (ValidationError, ValueError) as error:
            raise ApiError(503, "PLUGIN_RELEASE_INVALID_POINTER") from error
        if (
            (
                pointer.schema_version == 2
                and "status" in pointer.model_fields_set
            )
            or (
                pointer.schema_version == 3
                and "status" not in pointer.model_fields_set
            )
            or pointer.object_key != self.object_key(pointer.version)
            or pointer.size <= 0
            or len(pointer.sha256) != 64
            or any(character not in "0123456789abcdef" for character in pointer.sha256)
        ):
            raise ApiError(503, "PLUGIN_RELEASE_INVALID_POINTER")
        return pointer

    @staticmethod
    def _metadata_sha256(stat_result: Any) -> str | None:
        metadata = getattr(stat_result, "metadata", {}) or {}
        for key, value in metadata.items():
            if str(key).lower() in {"sha256", "x-amz-meta-sha256"}:
                return str(value)
        return None

    def _validate_stored_object(self, pointer: PluginReleasePointer) -> None:
        try:
            result = self.storage.stat(pointer.object_key)
        except Exception as error:
            raise ApiError(503, "PLUGIN_RELEASE_OBJECT_UNAVAILABLE") from error
        if (
            int(getattr(result, "size", -1)) != pointer.size
            or self._metadata_sha256(result) != pointer.sha256
        ):
            raise ApiError(503, "PLUGIN_RELEASE_OBJECT_INVALID")

    def current(self) -> PluginReleasePointer | None:
        pointer = self._read_pointer()
        if pointer is None or pointer.status == "unpublished":
            return None
        self._validate_stored_object(pointer)
        return pointer

    def admin_current(self) -> PluginReleasePointer | None:
        pointer = self._read_pointer()
        if pointer is not None and pointer.status == "published":
            self._validate_stored_object(pointer)
        return pointer

    def _write_pointer(self, pointer: PluginReleasePointer, error_code: str) -> None:
        pointer_data = json.dumps(
            pointer.model_dump(mode="json"),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            self.storage.put(
                self.pointer_key,
                pointer_data,
                JSON_CONTENT_TYPE,
                cache_control="private, no-store",
            )
        except Exception as error:
            raise ApiError(503, error_code) from error

    def _finish_publish(
        self,
        pointer: PluginReleasePointer,
    ) -> PluginReleasePublishResult:
        return PluginReleasePublishResult(
            pointer=pointer,
            cleanup_pending=self._cleanup_old_packages(pointer.object_key),
        )

    def _cleanup_old_packages(self, current_object_key: str) -> bool:
        try:
            object_names = self.storage.list_names(RELEASE_PREFIX)
        except Exception:
            logger.warning("Failed to list old plugin release packages", exc_info=True)
            return True
        cleanup_pending = False
        for object_name in object_names:
            if object_name == current_object_key or not object_name.endswith(".zip"):
                continue
            try:
                self.storage.delete(object_name)
            except Exception:
                logger.warning(
                    "Failed to delete old plugin release package: %s",
                    object_name,
                    exc_info=True,
                )
                cleanup_pending = True
        return cleanup_pending

    def publish(self, data: bytes) -> PluginReleasePublishResult:
        package = validate_plugin_package(data)
        with self._publish_lock:
            current = self._read_pointer()
            if current is not None:
                current_version = parse_version(current.version)
                if package.version_tuple < current_version:
                    raise ApiError(409, "PLUGIN_RELEASE_VERSION_CONFLICT")
                if package.version_tuple == current_version:
                    if package.sha256 != current.sha256:
                        raise ApiError(409, "PLUGIN_RELEASE_VERSION_CONFLICT")
                    self._store_package(current.object_key, package)
                    if current.status == "published":
                        return self._finish_publish(current)
                    reactivated = current.model_copy(
                        update={
                            "schema_version": 3,
                            "status": "published",
                            "released_at": datetime.now(UTC),
                        }
                    )
                    self._write_pointer(
                        reactivated,
                        "PLUGIN_RELEASE_PUBLISH_FAILED",
                    )
                    return self._finish_publish(reactivated)
            object_key = self.object_key(package.version)
            self._store_package(object_key, package)
            pointer = PluginReleasePointer(
                version=package.version,
                released_at=datetime.now(UTC),
                object_key=object_key,
                size=package.size,
                sha256=package.sha256,
            )
            self._write_pointer(pointer, "PLUGIN_RELEASE_PUBLISH_FAILED")
            return self._finish_publish(pointer)

    def _store_package(self, object_key: str, package: ValidatedPluginPackage) -> None:
        try:
            existing = self.storage.stat(object_key)
        except Exception as error:
            if not _not_found(error):
                raise ApiError(503, "PLUGIN_RELEASE_STORAGE_UNAVAILABLE") from error
        else:
            if (
                int(getattr(existing, "size", -1)) != package.size
                or self._metadata_sha256(existing) != package.sha256
            ):
                raise ApiError(409, "PLUGIN_RELEASE_IMMUTABLE_CONFLICT")
            return
        try:
            self.storage.put(
                object_key,
                package.data,
                ZIP_CONTENT_TYPE,
                cache_control="private, max-age=31536000, immutable",
                metadata={"sha256": package.sha256},
            )
            stored = self.storage.stat(object_key)
        except Exception as error:
            raise ApiError(503, "PLUGIN_RELEASE_PUBLISH_FAILED") from error
        if (
            int(getattr(stored, "size", -1)) != package.size
            or self._metadata_sha256(stored) != package.sha256
        ):
            raise ApiError(503, "PLUGIN_RELEASE_PUBLISH_FAILED")

    def unpublish(self) -> PluginReleasePointer:
        with self._publish_lock:
            pointer = self._read_pointer()
            if pointer is None or pointer.status == "unpublished":
                raise ApiError(404, "PLUGIN_RELEASE_NOT_FOUND")
            unpublished = pointer.model_copy(
                update={"schema_version": 3, "status": "unpublished"}
            )
            self._write_pointer(
                unpublished,
                "PLUGIN_RELEASE_UNPUBLISH_FAILED",
            )
            return unpublished

    def reactivate(self) -> PluginReleasePointer:
        with self._publish_lock:
            pointer = self._read_pointer()
            if pointer is None:
                raise ApiError(404, "PLUGIN_RELEASE_NOT_FOUND")
            if pointer.status == "published":
                raise ApiError(409, "PLUGIN_RELEASE_ALREADY_PUBLISHED")
            self._validate_stored_object(pointer)
            reactivated = pointer.model_copy(
                update={
                    "schema_version": 3,
                    "status": "published",
                    "released_at": datetime.now(UTC),
                }
            )
            self._write_pointer(
                reactivated,
                "PLUGIN_RELEASE_REACTIVATE_FAILED",
            )
            return reactivated

    def delete_current(self) -> None:
        with self._publish_lock:
            pointer = self._read_pointer()
            if pointer is None:
                raise ApiError(404, "PLUGIN_RELEASE_NOT_FOUND")
            if pointer.status == "published":
                pointer = pointer.model_copy(
                    update={"schema_version": 3, "status": "unpublished"}
                )
                self._write_pointer(
                    pointer,
                    "PLUGIN_RELEASE_DELETE_FAILED",
                )
            try:
                self.storage.delete(pointer.object_key)
                self.storage.delete(self.pointer_key)
            except Exception as error:
                raise ApiError(503, "PLUGIN_RELEASE_DELETE_FAILED") from error

    def open_download(self, version: str) -> tuple[PluginReleasePointer, Any]:
        try:
            parse_version(version)
        except ValueError as error:
            raise ApiError(404, "PLUGIN_RELEASE_NOT_FOUND") from error
        pointer = self.current()
        if pointer is None:
            raise ApiError(404, "PLUGIN_RELEASE_NOT_FOUND")
        if pointer.version != version:
            raise ApiError(409, "PLUGIN_RELEASE_VERSION_CHANGED")
        try:
            response = self.storage.get(pointer.object_key)
        except Exception as error:
            raise ApiError(503, "PLUGIN_RELEASE_OBJECT_UNAVAILABLE") from error
        return pointer, response
