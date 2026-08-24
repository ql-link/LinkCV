from pathlib import Path

import pytest

from linkcv.core.config import Settings
from linkcv.core.errors import ApiError
from linkcv.modules.resumes.pdf_service import (
    RENDER_SLOTS,
    ResumePdfRenderer,
    _object_key,
    build_render_assets,
)


def renderer(tmp_path: Path, source: str) -> ResumePdfRenderer:
    script = tmp_path / "renderer.cjs"
    script.write_text(source, encoding="utf-8")
    return ResumePdfRenderer(
        Settings(
            pdf_renderer_script=str(script),
            pdf_renderer_timeout_seconds=1,
        )
    )


def test_renderer_sends_protocol_version_and_accepts_complete_pdf(tmp_path: Path) -> None:
    service = renderer(
        tmp_path,
        """
        let input = '';
        process.stdin.on('data', chunk => input += chunk);
        process.stdin.on('end', () => {
          const payload = JSON.parse(input);
          if (payload.protocol_version !== 1) process.exit(2);
          process.stdout.write('%PDF-1.7\\nfixture');
        });
        """,
    )

    assert service.render({"title": "fixture"}) == b"%PDF-1.7\nfixture"


def test_renderer_rejects_unsupported_protocol_before_starting_process(tmp_path: Path) -> None:
    service = renderer(tmp_path, 'process.stdout.write("%PDF-1.3")')

    with pytest.raises(ApiError) as raised:
        service.render({"protocol_version": 2, "title": "fixture"})

    assert raised.value.status_code == 422
    assert raised.value.code == "RESUME_PDF_RENDER_PROTOCOL_UNSUPPORTED"


@pytest.mark.parametrize(
    ("stderr", "status", "code"),
    [
        (b"PDF_RENDER_PAGE_TOO_TALL\n", 413, "RESUME_PDF_PAGE_TOO_TALL"),
        (b"PDF_RENDER_IMAGE_UNAVAILABLE\n", 422, "RESUME_PDF_IMAGE_UNAVAILABLE"),
        (b"PDF_RENDER_CHROMIUM_UNAVAILABLE\n", 503, "RESUME_PDF_RENDERER_UNAVAILABLE"),
        (b"unexpected failure\n", 503, "RESUME_PDF_RENDER_FAILED"),
    ],
)
def test_renderer_maps_private_cli_errors(stderr: bytes, status: int, code: str) -> None:
    error = ResumePdfRenderer._renderer_error(stderr)
    assert error.status_code == status
    assert error.code == code


def test_renderer_returns_busy_when_render_slots_are_exhausted(tmp_path: Path) -> None:
    service = renderer(tmp_path, 'process.stdout.write("%PDF-1.3")')
    acquired = [RENDER_SLOTS.acquire(blocking=False) for _ in range(2)]
    assert all(acquired)
    try:
        with pytest.raises(ApiError) as raised:
            service.render({"title": "fixture"})
        assert raised.value.status_code == 503
        assert raised.value.code == "RESUME_PDF_BUSY"
    finally:
        for _ in acquired:
            RENDER_SLOTS.release()


def test_asset_keys_are_derived_from_the_authenticated_owner_and_resume() -> None:
    assert _object_key(
        "/api/assets/users/7/assets/avatar.png", 7, 11
    ) == "users/7/assets/avatar.png"
    assert _object_key("/api/assets/users/8/assets/avatar.png", 7, 11) is None
    assert _object_key(
        "/api/resumes/11/assets/logo.png", 7, 11
    ) == "users/7/resumes/11/assets/logo.png"
    assert _object_key("/api/resumes/12/assets/logo.png", 7, 11) is None
    assert _object_key("/api/resumes/11/assets/a/b.png", 7, 11) is None


class RecordingStorage:
    def __init__(self) -> None:
        self.requested: list[str] = []

    def get(self, object_key: str):
        self.requested.append(object_key)
        raise AssertionError("external or unowned assets must not be fetched")


def test_external_asset_urls_are_ignored_without_network_fetches() -> None:
    storage = RecordingStorage()
    assets = build_render_assets(
        storage,  # type: ignore[arg-type]
        {
            "image": "https://example.invalid/private.png",
        },
        user_id=7,
        resume_id=11,
    )

    assert assets == {}
    assert storage.requested == []


def test_unowned_private_asset_fails_closed_without_fetching() -> None:
    storage = RecordingStorage()

    with pytest.raises(ApiError) as raised:
        build_render_assets(
            storage,  # type: ignore[arg-type]
            {"image": "/api/assets/users/8/assets/private.png"},
            user_id=7,
            resume_id=11,
        )

    assert raised.value.status_code == 422
    assert raised.value.code == "RESUME_PDF_IMAGE_UNAVAILABLE"
    assert storage.requested == []
