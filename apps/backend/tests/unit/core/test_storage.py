import base64
from io import BytesIO

import pytest

from linkcv.core.storage import (
    AssetStorage,
    UploadTooLarge,
    build_asset_object_name,
    build_avatar_object_name,
    build_converted_markdown_object_name,
    build_dataset_object_name,
    build_import_cleanup_object_names,
    build_import_object_name,
    build_legacy_converted_markdown_object_name,
    build_interview_asset_object_name,
    decode_image_data_url,
)


def test_image_data_url_and_object_name() -> None:
    payload = base64.b64encode(b"image-data").decode("ascii")

    assert decode_image_data_url(f"data:image/png;base64,{payload}") == (
        b"image-data",
        "image/png",
    )

    object_name = build_asset_object_name("user_123", "头像.png", "image/png")
    assert object_name.startswith("users/user_123/assets/")
    assert "/assets/avatar/" not in object_name
    assert object_name.endswith(".png")

    avatar_object_name = build_avatar_object_name(
        "user_123", "头像.png", "image/png"
    )
    assert avatar_object_name.startswith("users/user_123/assets/avatar/")
    assert avatar_object_name.endswith("-头像.png")


def test_dataset_object_name_is_user_scoped() -> None:
    object_name = build_dataset_object_name(42, "notes.md")
    assert object_name.startswith("users/42/datasets/")
    assert object_name.endswith("-notes.md")


def test_interview_asset_name_is_scoped_to_user_application_and_session() -> None:
    object_name = build_interview_asset_object_name(42, 7, 9, "面试录音.m4a")

    assert object_name.startswith("users/42/interviews/7/9/")
    assert object_name.endswith("-面试录音.m4a")


class FakeMinioClient:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(
        self, bucket: str, object_name: str, reader, **kwargs: object
    ) -> None:
        del bucket, kwargs
        chunks: list[bytes] = []
        while chunk := reader.read(3):
            chunks.append(chunk)
        self.objects[object_name] = b"".join(chunks)

    def remove_object(self, bucket: str, object_name: str) -> None:
        del bucket
        self.objects.pop(object_name, None)


def test_stream_upload_hashes_content_and_cleans_oversized_objects() -> None:
    storage = AssetStorage.__new__(AssetStorage)
    storage.bucket = "test"
    storage.client = FakeMinioClient()
    storage.ensure_bucket = lambda: None  # type: ignore[method-assign]

    result = storage.upload_stream(
        "users/1/interviews/2/3/audio.webm",
        BytesIO(b"abcdef"),
        "audio/webm",
        max_bytes=6,
    )
    assert result.file_size == 6
    assert len(result.sha256) == 64

    with pytest.raises(UploadTooLarge):
        storage.upload_stream(
            "users/1/interviews/2/3/large.webm",
            BytesIO(b"abcdefg"),
            "audio/webm",
            max_bytes=6,
        )
    assert "users/1/interviews/2/3/large.webm" not in storage.client.objects


def test_import_objects_are_isolated_and_cleanup_candidates_are_deduplicated() -> None:
    source = build_import_object_name(42, "task-123", "converted.md")
    assert build_converted_markdown_object_name(42, "task-123") == (
        "users/42/resume-imports/task-123/artifacts/converted.md"
    )
    assert source == "users/42/resume-imports/task-123/source/converted.md"
    assert source != build_converted_markdown_object_name(42, "task-123")
    assert build_legacy_converted_markdown_object_name(42, "task-123") == (
        "users/42/resume-imports/task-123/converted.md"
    )
    assert build_import_cleanup_object_names(42, source, None) == (
        source,
        "users/42/resume-imports/task-123/artifacts/converted.md",
        "users/42/resume-imports/task-123/converted.md",
    )


def test_rejects_non_image_data_url() -> None:
    assert decode_image_data_url("data:text/plain;base64,SGVsbG8=") is None
