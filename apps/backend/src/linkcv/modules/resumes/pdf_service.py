from __future__ import annotations

import base64
import json
import os
import pwd
import re
import signal
import shutil
import subprocess
from pathlib import Path
from threading import BoundedSemaphore
from typing import Any
from urllib.parse import unquote

from minio.error import S3Error

from linkcv.core.config import REPO_ROOT, Settings
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, infer_image_content_type


# These limits are deliberately kept in the service boundary.  The renderer
# receives only a bounded JSON document and returns only a complete PDF.
MAX_RENDER_INPUT_BYTES = 12 * 1024 * 1024
MAX_RENDER_OUTPUT_BYTES = 15 * 1024 * 1024
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024
PRIVATE_ASSET_PATTERN = re.compile(
    r"/api/(?:assets/[^\s)'\"<>]+|resumes/[^/\s)'\"<>]+/assets/[^\s)'\"<>]+)"
)
RENDER_SLOTS = BoundedSemaphore(2)
RENDER_PROTOCOL_VERSION = 1


def _private_sources(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, str):
        found.update(PRIVATE_ASSET_PATTERN.findall(value))
    elif isinstance(value, list):
        for item in value:
            found.update(_private_sources(item))
    elif isinstance(value, dict):
        for item in value.values():
            found.update(_private_sources(item))
    return found


def _object_key(source: str, user_id: int, resume_id: int) -> str | None:
    account_prefix = "/api/assets/"
    resume_prefix = f"/api/resumes/{resume_id}/assets/"
    if source.startswith(account_prefix):
        object_key = unquote(source[len(account_prefix) :])
        if object_key.startswith(f"users/{user_id}/assets/"):
            return object_key
    if source.startswith(resume_prefix):
        asset_name = unquote(source[len(resume_prefix) :])
        if asset_name and "/" not in asset_name and "\\" not in asset_name:
            return f"users/{user_id}/resumes/{resume_id}/assets/{asset_name}"
    return None


def _read_image(storage: AssetStorage, object_key: str) -> tuple[bytes, str]:
    content_type = infer_image_content_type(object_key)
    if content_type not in {"image/png", "image/jpeg"}:
        raise ApiError(422, "RESUME_PDF_IMAGE_UNSUPPORTED")
    try:
        response = storage.get(object_key)
    except KeyError:
        raise ApiError(422, "RESUME_PDF_IMAGE_UNAVAILABLE")
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(422, "RESUME_PDF_IMAGE_UNAVAILABLE") from error
        raise ApiError(502, "RESUME_PDF_ASSET_READ_FAILED") from error
    except Exception as error:
        raise ApiError(502, "RESUME_PDF_ASSET_READ_FAILED") from error
    chunks: list[bytes] = []
    size = 0
    try:
        for chunk in response.stream(64 * 1024):
            size += len(chunk)
            if size > MAX_IMAGE_BYTES:
                raise ApiError(413, "RESUME_PDF_ASSET_TOO_LARGE")
            chunks.append(chunk)
    finally:
        response.close()
        response.release_conn()
    return b"".join(chunks), content_type


def build_render_assets(
    storage: AssetStorage,
    data: dict[str, Any],
    *,
    user_id: int,
    resume_id: int,
) -> dict[str, str]:
    """Resolve only private, owned image paths into in-memory data URLs.

    External URLs are intentionally ignored.  The renderer is never given an
    URL that could cause it to make a network request, and object keys are
    derived from the authenticated owner and resume rather than trusted from
    document data.
    """
    assets: dict[str, str] = {}
    total = 0
    for source in sorted(_private_sources(data)):
        object_key = _object_key(source, user_id, resume_id)
        if object_key is None:
            raise ApiError(422, "RESUME_PDF_IMAGE_UNAVAILABLE")
        image = _read_image(storage, object_key)
        content, content_type = image
        total += len(content)
        if total > MAX_IMAGE_TOTAL_BYTES:
            raise ApiError(413, "RESUME_PDF_ASSETS_TOO_LARGE")
        assets[source] = (
            f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}"
        )
    return assets


class ResumePdfRenderer:
    """Run the fixed PDF CLI with a bounded, versioned stdin protocol."""

    def __init__(self, settings: Settings) -> None:
        production_path = Path("/app/pdf/render-resume-pdf.cjs")
        self.script = Path(settings.pdf_renderer_script) if settings.pdf_renderer_script else (
            production_path
            if production_path.is_file()
            else REPO_ROOT / "apps/web/dist-server/render-resume-pdf.cjs"
        )
        self.timeout_seconds = settings.pdf_renderer_timeout_seconds
        self.chromium_executable_path = getattr(
            settings, "chromium_executable_path", None
        )
        self.max_smart_height_mm = getattr(
            settings, "pdf_renderer_max_smart_height_mm", 2000
        )

    def _environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        if self.chromium_executable_path:
            environment["CHROMIUM_EXECUTABLE_PATH"] = str(
                self.chromium_executable_path
            )
        environment["PDF_RENDERER_MAX_SMART_HEIGHT_MM"] = str(
            self.max_smart_height_mm
        )
        # Chromium refuses to run as root unless sandboxing is disabled.  Keep
        # the sandbox enabled in production by dropping to the dedicated
        # runtime account when the container happens to start as root.  Tests
        # and local development retain their normal process identity.
        if self._runtime_user_available():
            environment["HOME"] = "/var/lib/linkcv-pdf"
            environment["TMPDIR"] = "/tmp/linkcv-pdf"
        else:
            environment.setdefault("HOME", "/tmp")
            environment.setdefault("TMPDIR", "/tmp")
        return environment

    @staticmethod
    def _runtime_user_available() -> bool:
        if os.geteuid() != 0 or shutil.which("runuser") is None:
            return False
        try:
            pwd.getpwnam("linkcv-pdf")
        except KeyError:
            return False
        return True

    @classmethod
    def _command(cls, script: Path) -> list[str]:
        if not cls._runtime_user_available():
            return ["node", str(script)]
        return ["runuser", "-u", "linkcv-pdf", "--", "node", str(script)]

    @staticmethod
    def _renderer_error(stderr: bytes) -> ApiError:
        codes = re.findall(rb"(?:PDF|RESUME_PDF)_[A-Z_]+", stderr[-8192:])
        code = codes[-1].decode("ascii") if codes else ""
        mapping = {
            "PDF_RENDER_PAGE_TOO_TALL": (413, "RESUME_PDF_PAGE_TOO_TALL"),
            "PDF_RENDER_INPUT_TOO_LARGE": (413, "RESUME_PDF_INPUT_TOO_LARGE"),
            "PDF_RENDER_INPUT_INVALID": (422, "RESUME_PDF_RENDER_PROTOCOL_INVALID"),
            "PDF_RENDER_IMAGE_UNAVAILABLE": (422, "RESUME_PDF_IMAGE_UNAVAILABLE"),
            "PDF_RENDER_CHROMIUM_UNAVAILABLE": (503, "RESUME_PDF_RENDERER_UNAVAILABLE"),
        }
        status, public_code = mapping.get(code, (503, "RESUME_PDF_RENDER_FAILED"))
        return ApiError(status, public_code)

    def render(self, payload: dict[str, Any]) -> bytes:
        if not isinstance(payload, dict):
            raise ApiError(422, "RESUME_PDF_RENDER_PROTOCOL_INVALID")
        provided_protocol = payload.get("protocol_version", RENDER_PROTOCOL_VERSION)
        if provided_protocol != RENDER_PROTOCOL_VERSION:
            raise ApiError(422, "RESUME_PDF_RENDER_PROTOCOL_UNSUPPORTED")
        request_payload = {
            "protocol_version": RENDER_PROTOCOL_VERSION,
            **payload,
        }
        encoded = json.dumps(
            request_payload, ensure_ascii=False, separators=(",", ":")
        ).encode()
        if len(encoded) > MAX_RENDER_INPUT_BYTES:
            raise ApiError(413, "RESUME_PDF_INPUT_TOO_LARGE")
        if not self.script.is_file():
            raise ApiError(503, "RESUME_PDF_RENDERER_UNAVAILABLE")
        if not RENDER_SLOTS.acquire(blocking=False):
            raise ApiError(503, "RESUME_PDF_BUSY")
        process: subprocess.Popen[bytes] | None = None
        try:
            try:
                process = subprocess.Popen(
                    self._command(self.script),
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=self._environment(),
                    start_new_session=True,
                )
                stdout, stderr = process.communicate(
                    input=encoded,
                    timeout=self.timeout_seconds,
                )
            except subprocess.TimeoutExpired as error:
                if process is not None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.communicate()
                raise ApiError(503, "RESUME_PDF_TIMEOUT") from error
            except OSError as error:
                raise ApiError(503, "RESUME_PDF_RENDER_FAILED") from error
        finally:
            RENDER_SLOTS.release()
        if process is None or process.returncode != 0:
            raise self._renderer_error(stderr)
        if not stdout.startswith(b"%PDF-") or len(stdout) > MAX_RENDER_OUTPUT_BYTES:
            raise ApiError(503, "RESUME_PDF_RENDER_FAILED")
        return stdout
