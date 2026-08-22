from __future__ import annotations

import base64
import io
import json
import math
import re
import subprocess
from pathlib import Path
from threading import BoundedSemaphore
from typing import Any
from urllib.parse import unquote

import pypdfium2 as pdfium
from minio.error import S3Error
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import REPO_ROOT, Settings
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, infer_image_content_type
from linkcv.modules.resumes.models import ResumeVersion

MAX_RENDER_INPUT_BYTES = 12 * 1024 * 1024
MAX_RENDER_OUTPUT_BYTES = 15 * 1024 * 1024
MAX_PREVIEW_OUTPUT_BYTES = 15 * 1024 * 1024
MAX_PREVIEW_DIMENSION = 8192
MAX_PREVIEW_PIXELS = 24_000_000
PREVIEW_TARGET_WIDTH = 1440
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024
PRIVATE_ASSET_PATTERN = re.compile(
    r"/api/(?:assets/[^\s)'\"<>]+|resumes/[^/\s)'\"<>]+/assets/[^\s)'\"<>]+)"
)
RENDER_SLOTS = BoundedSemaphore(2)
PREVIEW_SLOTS = BoundedSemaphore(2)


def select_readable_version(
    db: Session,
    resume_id: int,
    *,
    version_id: int | None = None,
) -> ResumeVersion | None:
    query = select(ResumeVersion).where(ResumeVersion.resume_id == resume_id)
    manual = db.scalar(
        query.where(ResumeVersion.reason == "manual").order_by(
            ResumeVersion.version_no.desc(), ResumeVersion.id.desc()
        )
    )
    selected = manual or db.scalar(
        query.where(ResumeVersion.reason == "initial").order_by(
            ResumeVersion.version_no.desc(), ResumeVersion.id.desc()
        )
    )
    if version_id is not None and (selected is None or selected.id != version_id):
        return None
    return selected


def select_readable_versions(
    db: Session,
    resume_ids: list[int],
) -> dict[int, ResumeVersion]:
    if not resume_ids:
        return {}
    versions = db.scalars(
        select(ResumeVersion)
        .where(
            ResumeVersion.resume_id.in_(resume_ids),
            ResumeVersion.reason.in_(("manual", "initial")),
        )
        .order_by(
            ResumeVersion.resume_id,
            ResumeVersion.version_no.desc(),
            ResumeVersion.id.desc(),
        )
    ).all()
    selected: dict[int, ResumeVersion] = {}
    for version in versions:
        current = selected.get(version.resume_id)
        if current is None or (current.reason == "initial" and version.reason == "manual"):
            selected[version.resume_id] = version
    return selected


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
        object_key = unquote(source[len(account_prefix):])
        if object_key.startswith(f"users/{user_id}/assets/"):
            return object_key
    if source.startswith(resume_prefix):
        asset_name = unquote(source[len(resume_prefix):])
        if asset_name and "/" not in asset_name and "\\" not in asset_name:
            return f"users/{user_id}/resumes/{resume_id}/assets/{asset_name}"
    return None


def _read_image(storage: AssetStorage, object_key: str) -> tuple[bytes, str] | None:
    content_type = infer_image_content_type(object_key)
    if content_type not in {"image/png", "image/jpeg"}:
        return None
    try:
        response = storage.get(object_key)
    except KeyError:
        return None
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            return None
        raise ApiError(502, "RESUME_PDF_ASSET_READ_FAILED") from error
    except Exception as error:
        raise ApiError(502, "RESUME_PDF_ASSET_READ_FAILED") from error
    chunks: list[bytes] = []
    size = 0
    try:
        for chunk in response.stream(64 * 1024):
            size += len(chunk)
            if size > MAX_IMAGE_BYTES:
                return None
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
    assets: dict[str, str] = {}
    total = 0
    for source in sorted(_private_sources(data)):
        object_key = _object_key(source, user_id, resume_id)
        if object_key is None:
            continue
        image = _read_image(storage, object_key)
        if image is None:
            continue
        content, content_type = image
        total += len(content)
        if total > MAX_IMAGE_TOTAL_BYTES:
            raise ApiError(413, "RESUME_PDF_ASSETS_TOO_LARGE")
        assets[source] = (
            f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}"
        )
    return assets


class ResumePdfRenderer:
    def __init__(self, settings: Settings) -> None:
        production_path = Path("/app/pdf/render-resume-pdf.cjs")
        self.script = Path(settings.pdf_renderer_script) if settings.pdf_renderer_script else (
            production_path if production_path.is_file()
            else REPO_ROOT / "apps/web/dist-server/render-resume-pdf.cjs"
        )
        self.timeout_seconds = settings.pdf_renderer_timeout_seconds

    def render(self, payload: dict[str, Any]) -> bytes:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        if len(encoded) > MAX_RENDER_INPUT_BYTES:
            raise ApiError(413, "RESUME_PDF_INPUT_TOO_LARGE")
        if not self.script.is_file():
            raise ApiError(503, "RESUME_PDF_RENDERER_UNAVAILABLE")
        if not RENDER_SLOTS.acquire(blocking=False):
            raise ApiError(503, "RESUME_PDF_BUSY")
        try:
            try:
                result = subprocess.run(
                    ["node", str(self.script)],
                    input=encoded,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=self.timeout_seconds,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                raise ApiError(503, "RESUME_PDF_RENDER_FAILED") from error
        finally:
            RENDER_SLOTS.release()
        if (
            result.returncode != 0
            or not result.stdout.startswith(b"%PDF-")
            or len(result.stdout) > MAX_RENDER_OUTPUT_BYTES
        ):
            raise ApiError(503, "RESUME_PDF_RENDER_FAILED")
        return result.stdout


class ResumePreviewRenderer:
    def render(self, pdf: bytes) -> bytes:
        if not pdf.startswith(b"%PDF-") or len(pdf) > MAX_RENDER_OUTPUT_BYTES:
            raise ApiError(503, "RESUME_PREVIEW_RENDER_FAILED")
        if not PREVIEW_SLOTS.acquire(blocking=False):
            raise ApiError(503, "RESUME_PDF_BUSY")
        document = None
        page = None
        bitmap = None
        image = None
        try:
            document = pdfium.PdfDocument(pdf)
            if len(document) != 1:
                raise ApiError(503, "RESUME_PREVIEW_RENDER_FAILED")
            page = document[0]
            width, height = page.get_size()
            if (
                width <= 0
                or height <= 0
                or not math.isfinite(width)
                or not math.isfinite(height)
            ):
                raise ApiError(503, "RESUME_PREVIEW_RENDER_FAILED")
            scale = min(
                PREVIEW_TARGET_WIDTH / width,
                MAX_PREVIEW_DIMENSION / max(width, height),
                math.sqrt(MAX_PREVIEW_PIXELS / (width * height)),
            )
            if scale < 0.5:
                raise ApiError(413, "RESUME_PREVIEW_TOO_LARGE")
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=True)
            content = output.getvalue()
            if (
                not content.startswith(b"\x89PNG\r\n\x1a\n")
                or len(content) > MAX_PREVIEW_OUTPUT_BYTES
            ):
                raise ApiError(413, "RESUME_PREVIEW_TOO_LARGE")
            return content
        except ApiError:
            raise
        except Exception as error:
            raise ApiError(503, "RESUME_PREVIEW_RENDER_FAILED") from error
        finally:
            if image is not None:
                image.close()
            if bitmap is not None:
                bitmap.close()
            if page is not None:
                page.close()
            if document is not None:
                document.close()
            PREVIEW_SLOTS.release()
