import io
from pathlib import Path

import pypdfium2 as pdfium
import pytest
from PIL import Image

from linkcv.core.config import Settings
from linkcv.core.errors import ApiError
from linkcv.modules.miniprogram.pdf_service import ResumePdfRenderer, ResumePreviewRenderer


def renderer(tmp_path: Path, source: str, *, timeout: float = 1) -> ResumePdfRenderer:
    script = tmp_path / "renderer.cjs"
    script.write_text(source, encoding="utf-8")
    return ResumePdfRenderer(
        Settings(
            pdf_renderer_script=str(script),
            pdf_renderer_timeout_seconds=timeout,
        )
    )


def test_renderer_accepts_only_pdf_stdout(tmp_path: Path) -> None:
    service = renderer(tmp_path, 'process.stdout.write("%PDF-1.3\\nfixture")')

    assert service.render({"title": "fixture"}) == b"%PDF-1.3\nfixture"


def test_renderer_rejects_invalid_output(tmp_path: Path) -> None:
    service = renderer(tmp_path, 'process.stdout.write("not-pdf")')

    with pytest.raises(ApiError) as raised:
        service.render({"title": "fixture"})
    assert raised.value.code == "RESUME_PDF_RENDER_FAILED"


def test_renderer_times_out_and_missing_script_fails_closed(tmp_path: Path) -> None:
    timeout_service = renderer(
        tmp_path,
        "setTimeout(() => process.stdout.write('%PDF-1.3'), 1000)",
        timeout=0.01,
    )
    with pytest.raises(ApiError) as timed_out:
        timeout_service.render({"title": "fixture"})
    assert timed_out.value.code == "RESUME_PDF_TIMEOUT"

    missing = ResumePdfRenderer(
        Settings(pdf_renderer_script=str(tmp_path / "missing.cjs"))
    )
    with pytest.raises(ApiError) as unavailable:
        missing.render({"title": "fixture"})
    assert unavailable.value.code == "RESUME_PDF_RENDERER_UNAVAILABLE"


def test_preview_renderer_returns_a_bounded_png() -> None:
    document = pdfium.PdfDocument.new()
    document.new_page(595.28, 841.89)
    source = io.BytesIO()
    document.save(source)
    document.close()

    preview = ResumePreviewRenderer().render(source.getvalue())

    assert preview.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(preview) < 15 * 1024 * 1024
    with Image.open(io.BytesIO(preview)) as image:
        assert image.size == (1440, 2037)


def test_preview_renderer_rejects_invalid_pdf() -> None:
    with pytest.raises(ApiError) as raised:
        ResumePreviewRenderer().render(b"not-pdf")

    assert raised.value.code == "RESUME_PREVIEW_RENDER_FAILED"


def test_preview_renderer_rejects_multiple_pages() -> None:
    document = pdfium.PdfDocument.new()
    document.new_page(595.28, 841.89)
    document.new_page(595.28, 841.89)
    source = io.BytesIO()
    document.save(source)
    document.close()

    with pytest.raises(ApiError) as raised:
        ResumePreviewRenderer().render(source.getvalue())

    assert raised.value.code == "RESUME_PREVIEW_RENDER_FAILED"


def test_preview_renderer_rejects_dimensions_that_cannot_be_safely_scaled() -> None:
    document = pdfium.PdfDocument.new()
    document.new_page(20_000, 20_000)
    source = io.BytesIO()
    document.save(source)
    document.close()

    with pytest.raises(ApiError) as raised:
        ResumePreviewRenderer().render(source.getvalue())

    assert raised.value.status_code == 413
    assert raised.value.code == "RESUME_PREVIEW_TOO_LARGE"
