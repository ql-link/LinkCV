import base64
import binascii
import re
import time
import unicodedata
from io import BytesIO
from pathlib import PurePath
from urllib.parse import quote, urlsplit

from fastapi import Request
from minio import Minio
from urllib3 import PoolManager, Retry, Timeout

from linkcv.core.config import Settings

SUPPORTED_IMAGE_TYPES = {
    "image/apng": ".apng",
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
}
IMAGE_CONTENT_TYPES = {
    extension: content_type for content_type, extension in SUPPORTED_IMAGE_TYPES.items()
}
DATA_URL_PATTERN = re.compile(r"^data:([^;,]+);base64,(.+)$", re.DOTALL)


class AssetStorage:
    def __init__(self, settings: Settings) -> None:
        endpoint = urlsplit(settings.minio_endpoint)
        if not endpoint.hostname:
            raise ValueError("MINIO_ENDPOINT must include a hostname")
        host = endpoint.hostname
        if endpoint.port:
            host = f"{host}:{endpoint.port}"
        self.bucket = settings.minio_bucket
        self.client = Minio(
            host,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=endpoint.scheme == "https",
            http_client=PoolManager(
                timeout=Timeout(connect=5, read=60),
                retries=Retry(total=False),
            ),
        )

    def ensure_bucket(self) -> None:
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)

    def put(
        self,
        object_name: str,
        data: bytes,
        content_type: str,
        *,
        cache_control: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        self.ensure_bucket()
        object_metadata = dict(metadata or {})
        object_metadata["Cache-Control"] = cache_control
        self.client.put_object(
            self.bucket,
            object_name,
            BytesIO(data),
            len(data),
            content_type=content_type,
            metadata=object_metadata,
        )

    def upload(self, object_name: str, data: bytes, content_type: str) -> None:
        self.put(
            object_name,
            data,
            content_type,
            cache_control="private, max-age=31536000, immutable",
        )

    def get(self, object_name: str):
        self.ensure_bucket()
        return self.client.get_object(self.bucket, object_name)

    def stat(self, object_name: str):
        self.ensure_bucket()
        return self.client.stat_object(self.bucket, object_name)

    def list_names(self, prefix: str) -> list[str]:
        self.ensure_bucket()
        return [
            item.object_name
            for item in self.client.list_objects(
                self.bucket,
                prefix=prefix,
                recursive=True,
            )
        ]

    def delete(self, object_name: str) -> None:
        self.ensure_bucket()
        self.client.remove_object(self.bucket, object_name)

    def delete_prefix(self, prefix: str) -> None:
        self.ensure_bucket()
        for item in self.client.list_objects(self.bucket, prefix=prefix, recursive=True):
            self.client.remove_object(self.bucket, item.object_name)


def get_storage(request: Request) -> AssetStorage:
    return request.app.state.storage


def decode_image_data_url(data_url: object) -> tuple[bytes, str] | None:
    if not isinstance(data_url, str):
        return None
    match = DATA_URL_PATTERN.fullmatch(data_url)
    if not match:
        return None
    content_type = match.group(1).lower()
    if content_type not in SUPPORTED_IMAGE_TYPES:
        return None
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        return None
    return data, content_type


def _build_user_asset_object_name(
    user_id: str,
    file_name: object,
    content_type: str,
    *,
    directory: str | None = None,
) -> str:
    normalized = unicodedata.normalize("NFKD", str(file_name or "image"))
    safe_name = re.sub(r"[^\w.-]+", "-", normalized).strip("-")[:80]
    candidate_extension = PurePath(safe_name).suffix.lower()
    extension = (
        candidate_extension
        if candidate_extension in IMAGE_CONTENT_TYPES
        else SUPPORTED_IMAGE_TYPES[content_type]
    )
    base_name = PurePath(safe_name).stem if safe_name else "image"
    base_name = base_name or "image"
    unique = f"{int(time.time() * 1000)}-{secrets_token(8)}"
    prefix = f"users/{user_id}/assets"
    if directory:
        prefix = f"{prefix}/{directory}"
    return f"{prefix}/{unique}-{base_name}{extension}"


def build_asset_object_name(user_id: str, file_name: object, content_type: str) -> str:
    return _build_user_asset_object_name(user_id, file_name, content_type)


def build_avatar_object_name(user_id: str, file_name: object, content_type: str) -> str:
    return _build_user_asset_object_name(
        user_id,
        file_name,
        content_type,
        directory="avatar",
    )


def build_import_object_name(
    user_id: int,
    operation_id: str,
    file_name: str,
) -> str:
    normalized = unicodedata.normalize("NFKD", file_name)
    safe_name = re.sub(r"[^\w.-]+", "-", normalized).strip("-.")[:120]
    if not safe_name:
        safe_name = "resume.bin"
    return f"users/{user_id}/resume-imports/{operation_id}/{safe_name}"


def build_converted_markdown_object_name(user_id: int, operation_id: str) -> str:
    return f"users/{user_id}/resume-imports/{operation_id}/converted.md"


def build_dataset_object_name(user_id: int, file_name: str) -> str:
    """生成知识库资料对象键，强制以当前用户 id 为前缀，调用方不可覆盖。"""
    normalized = unicodedata.normalize("NFKD", file_name)
    safe_name = re.sub(r"[^\w.-]+", "-", normalized).strip("-.")[:120]
    if not safe_name:
        safe_name = "dataset.bin"
    unique = f"{int(time.time() * 1000)}-{secrets_token(8)}"
    return f"users/{user_id}/datasets/{unique}-{safe_name}"


def build_resume_asset_object_name(
    user_id: int,
    resume_id: int,
    file_name: object,
    content_type: str,
) -> str:
    normalized = unicodedata.normalize("NFKD", str(file_name or "image"))
    safe_name = re.sub(r"[^\w.-]+", "-", normalized).strip("-.")[:80]
    candidate_extension = PurePath(safe_name).suffix.lower()
    extension = (
        candidate_extension
        if candidate_extension in IMAGE_CONTENT_TYPES
        else SUPPORTED_IMAGE_TYPES[content_type]
    )
    base_name = PurePath(safe_name).stem if safe_name else "image"
    unique = f"{int(time.time() * 1000)}-{secrets_token(8)}"
    return f"users/{user_id}/resumes/{resume_id}/assets/{unique}-{base_name}{extension}"


def secrets_token(length: int) -> str:
    import secrets

    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def infer_image_content_type(object_name: str) -> str:
    return IMAGE_CONTENT_TYPES.get(
        PurePath(object_name).suffix.lower(), "application/octet-stream"
    )


def asset_url(object_name: str) -> str:
    return f"/api/assets/{quote(object_name, safe='')}"
