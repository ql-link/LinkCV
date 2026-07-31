import base64

from linkcv.core.storage import (
    build_asset_object_name,
    build_avatar_object_name,
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


def test_rejects_non_image_data_url() -> None:
    assert decode_image_data_url("data:text/plain;base64,SGVsbG8=") is None
