import base64
from types import SimpleNamespace

import pytest

from linkresume.core.errors import ApiError
from linkresume.modules.resumes import resume_asset_routes
from linkresume.modules.resumes.image_limits import MAX_RESUME_IMAGE_BYTES


class RecordingStorage:
    def __init__(self) -> None:
        self.uploaded_size = 0

    def upload(self, object_key: str, data: bytes, content_type: str) -> None:
        assert object_key.startswith("users/7/resumes/11/assets/")
        assert content_type == "image/png"
        self.uploaded_size = len(data)


def payload(size: int) -> resume_asset_routes.ResumeAssetUploadRequest:
    encoded = base64.b64encode(b"x" * size).decode("ascii")
    return resume_asset_routes.ResumeAssetUploadRequest(
        file_name="photo.png",
        data_url=f"data:image/png;base64,{encoded}",
    )


def payload_with_type(
    size: int, content_type: str
) -> resume_asset_routes.ResumeAssetUploadRequest:
    encoded = base64.b64encode(b"x" * size).decode("ascii")
    return resume_asset_routes.ResumeAssetUploadRequest(
        file_name="photo.webp",
        data_url=f"data:{content_type};base64,{encoded}",
    )


def test_resume_image_upload_accepts_the_shared_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        resume_asset_routes,
        "require_owned_resume",
        lambda db, resume_id, user_id: SimpleNamespace(id=11),
    )
    storage = RecordingStorage()

    response = resume_asset_routes.upload_resume_asset(
        "11",
        payload(MAX_RESUME_IMAGE_BYTES),
        db=object(),  # type: ignore[arg-type]
        user=SimpleNamespace(id=7),  # type: ignore[arg-type]
        storage=storage,  # type: ignore[arg-type]
    )

    assert storage.uploaded_size == MAX_RESUME_IMAGE_BYTES
    assert response.asset.url.startswith("/api/resumes/11/assets/")


def test_resume_image_upload_rejects_above_the_shared_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        resume_asset_routes,
        "require_owned_resume",
        lambda db, resume_id, user_id: SimpleNamespace(id=11),
    )

    with pytest.raises(ApiError) as raised:
        resume_asset_routes.upload_resume_asset(
            "11",
            payload(MAX_RESUME_IMAGE_BYTES + 1),
            db=object(),  # type: ignore[arg-type]
            user=SimpleNamespace(id=7),  # type: ignore[arg-type]
            storage=RecordingStorage(),  # type: ignore[arg-type]
        )

    assert raised.value.status_code == 413
    assert raised.value.code == "IMAGE_TOO_LARGE"


def test_resume_image_upload_rejects_formats_pdf_cannot_render(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        resume_asset_routes,
        "require_owned_resume",
        lambda db, resume_id, user_id: SimpleNamespace(id=11),
    )

    with pytest.raises(ApiError) as raised:
        resume_asset_routes.upload_resume_asset(
            "11",
            payload_with_type(1, "image/webp"),
            db=object(),  # type: ignore[arg-type]
            user=SimpleNamespace(id=7),  # type: ignore[arg-type]
            storage=RecordingStorage(),  # type: ignore[arg-type]
        )

    assert raised.value.status_code == 400
    assert raised.value.code == "INVALID_IMAGE"
