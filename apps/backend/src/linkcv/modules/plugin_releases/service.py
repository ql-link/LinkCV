from __future__ import annotations

import json
import threading
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
    def __init__(self, storage: Any, *, environment: str, expected_origin: str) -> None:
        self.storage = storage
        self.environment = environment.lower()
        self.expected_origin = expected_origin
        self._publish_lock = threading.Lock()

    @property
    def pointer_key(self) -> str:
        return f"system/plugin-releases/{self.environment}/current.json"

    def object_key(self, version: str) -> str:
        return (
            f"system/plugin-releases/{self.environment}/v{version}/"
            f"linkcv-job-capture-{self.environment}-v{version}.zip"
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
            pointer.environment != self.environment
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
        if pointer is not None:
            self._validate_stored_object(pointer)
        return pointer

    def publish(self, data: bytes) -> PluginReleasePointer:
        package = validate_plugin_package(data, self.expected_origin)
        with self._publish_lock:
            current = self._read_pointer()
            if current is not None:
                current_version = parse_version(current.version)
                if package.version_tuple < current_version:
                    raise ApiError(409, "PLUGIN_RELEASE_VERSION_CONFLICT")
                if package.version_tuple == current_version:
                    if package.sha256 != current.sha256:
                        raise ApiError(409, "PLUGIN_RELEASE_VERSION_CONFLICT")
                    self._validate_stored_object(current)
                    return current
            object_key = self.object_key(package.version)
            self._store_package(object_key, package)
            pointer = PluginReleasePointer(
                environment=self.environment,
                version=package.version,
                released_at=datetime.now(UTC),
                object_key=object_key,
                size=package.size,
                sha256=package.sha256,
            )
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
                raise ApiError(503, "PLUGIN_RELEASE_PUBLISH_FAILED") from error
            return pointer

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
