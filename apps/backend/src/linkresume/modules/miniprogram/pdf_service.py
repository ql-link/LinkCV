from __future__ import annotations

import io
import math
from threading import BoundedSemaphore

import pypdfium2 as pdfium

from linkresume.core.pdfium_lock import PDFIUM_LOCK
from linkresume.core.errors import ApiError
from linkresume.modules.resumes.pdf_service import (
    MAX_RENDER_INPUT_BYTES,
    MAX_RENDER_OUTPUT_BYTES,
    ResumePdfRenderer,
    build_render_assets,
)

MAX_PREVIEW_OUTPUT_BYTES = 15 * 1024 * 1024
MAX_PREVIEW_DIMENSION = 8192
MAX_PREVIEW_PIXELS = 24_000_000
PREVIEW_TARGET_WIDTH = 1440
PREVIEW_SLOTS = BoundedSemaphore(2)


class ResumePreviewRenderer:
    """Rasterize the one-page mini-program preview from the shared PDF."""

    def render(self, pdf: bytes) -> bytes:
        if not pdf.startswith(b"%PDF-") or len(pdf) > MAX_RENDER_OUTPUT_BYTES:
            raise ApiError(503, "RESUME_PREVIEW_RENDER_FAILED")
        if not PREVIEW_SLOTS.acquire(blocking=False):
            raise ApiError(503, "RESUME_PDF_BUSY")
        try:
            with PDFIUM_LOCK:
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


        finally:
            PREVIEW_SLOTS.release()


# Backward-compatible exports for existing mini-program callers and tests.
__all__ = [
    "MAX_RENDER_INPUT_BYTES",
    "MAX_RENDER_OUTPUT_BYTES",
    "ResumePdfRenderer",
    "ResumePreviewRenderer",
    "build_render_assets",
]
