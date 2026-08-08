import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from cryptography.fernet import Fernet
from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[5]
LLM_KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def settings_env_files() -> tuple[Path, ...]:
    base = Path(os.environ.get("LINKCV_ENV_FILE", REPO_ROOT / ".env")).expanduser()
    if not base.is_absolute():
        base = (REPO_ROOT / base).resolve()
    local = Path(f"{base}.local")
    return (base, local) if local.is_file() else (base,)


def _is_placeholder(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    return not normalized or any(
        marker in normalized for marker in ("replace-with", "change-me", "example")
    )


def parse_llm_credential_encryption_keys(
    value: SecretStr | str | None,
) -> tuple[tuple[str, bytes], ...]:
    if isinstance(value, SecretStr):
        raw = value.get_secret_value()
    else:
        raw = value or ""
    if not raw.strip():
        return ()

    keys: list[tuple[str, bytes]] = []
    seen_ids: set[str] = set()
    for entry in raw.split(","):
        key_id, separator, encoded_key = entry.strip().partition(":")
        if (
            not separator
            or not LLM_KEY_ID_PATTERN.fullmatch(key_id)
            or key_id in seen_ids
        ):
            raise ValueError("LLM_CREDENTIAL_ENCRYPTION_KEYS is invalid")
        try:
            encoded = encoded_key.strip().encode("ascii")
            Fernet(encoded)
        except (UnicodeEncodeError, ValueError) as error:
            raise ValueError("LLM_CREDENTIAL_ENCRYPTION_KEYS is invalid") from error
        keys.append((key_id, encoded))
        seen_ids.add(key_id)
    return tuple(keys)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
        hide_input_in_errors=True,
    )

    app_environment: str = Field(default="development", alias="APP_ENV")
    backend_host: str = Field(default="127.0.0.1", alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")

    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    mysql_host: str = Field(default="127.0.0.1", alias="MYSQL_HOST")
    mysql_port: int = Field(default=3306, alias="MYSQL_PORT")
    mysql_database: str = Field(default="linkcv", alias="MYSQL_DATABASE")
    mysql_user: str = Field(default="linkcv", alias="MYSQL_USER")
    mysql_password: str = Field(
        default="linkcv-local-change-me",
        alias="MYSQL_PASSWORD",
    )

    jwt_secret: str = Field(
        default="linkcv-development-secret-change-me", alias="JWT_SECRET"
    )
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_ttl_minutes: int = Field(default=15, alias="ACCESS_TTL_MINUTES")
    session_cookie_name: str = Field(
        default="resume_session", alias="SESSION_COOKIE_NAME"
    )
    access_cookie_name: str = Field(
        default="resume_access", alias="ACCESS_COOKIE_NAME"
    )
    refresh_cookie_name: str = Field(
        default="resume_refresh", alias="REFRESH_COOKIE_NAME"
    )
    session_ttl_days: int = Field(default=7, alias="SESSION_TTL_DAYS")
    cookie_secure: bool = Field(default=False, alias="COOKIE_SECURE")

    llm_credential_encryption_keys: SecretStr | None = Field(
        default=None,
        alias="LLM_CREDENTIAL_ENCRYPTION_KEYS",
    )
    llm_timeout_seconds: float = Field(
        default=75,
        alias="LLM_TIMEOUT_SECONDS",
        gt=0,
    )

    minio_endpoint: str = Field(default="http://127.0.0.1:9000", alias="MINIO_ENDPOINT")
    minio_access_key: str = Field(default="linkcv", alias="MINIO_ACCESS_KEY")
    minio_secret_key: str = Field(
        default="linkcv-minio-local-change-me",
        alias="MINIO_SECRET_KEY",
    )
    minio_bucket: str = Field(default="linkcv", alias="MINIO_BUCKET")

    resume_version_limit: int = Field(default=10, alias="RESUME_VERSION_LIMIT", ge=2)
    resume_import_max_bytes: int = Field(
        default=10 * 1024 * 1024,
        alias="RESUME_IMPORT_MAX_BYTES",
        ge=1,
    )
    resume_markdown_max_bytes: int = Field(
        default=2 * 1024 * 1024,
        alias="RESUME_MARKDOWN_MAX_BYTES",
        ge=1,
    )
    resume_structuring_max_bytes: int = Field(
        default=128 * 1024,
        alias="RESUME_STRUCTURING_MAX_BYTES",
        ge=1,
    )
    resume_import_requests_per_minute: int = Field(
        default=3,
        alias="RESUME_IMPORT_REQUESTS_PER_MINUTE",
        ge=1,
        le=60,
    )
    resume_import_global_concurrency: int = Field(
        default=4,
        alias="RESUME_IMPORT_GLOBAL_CONCURRENCY",
        ge=1,
        le=100,
    )
    resume_import_user_concurrency: int = Field(
        default=1,
        alias="RESUME_IMPORT_USER_CONCURRENCY",
        ge=1,
        le=10,
    )
    resume_structuring_timeout_seconds: float = Field(
        default=60,
        alias="RESUME_STRUCTURING_TIMEOUT_SECONDS",
        gt=0,
    )
    resume_import_upload_stale_seconds: int = Field(
        default=120, alias="RESUME_IMPORT_UPLOAD_STALE_SECONDS", ge=1
    )
    resume_import_parse_deadline_seconds: int = Field(
        default=180, alias="RESUME_IMPORT_PARSE_DEADLINE_SECONDS", ge=1
    )
    resume_import_parse_stale_seconds: int = Field(
        default=240, alias="RESUME_IMPORT_PARSE_STALE_SECONDS", ge=1
    )
    resume_import_worker_lock_seconds: int = Field(
        default=240, alias="RESUME_IMPORT_WORKER_LOCK_SECONDS", ge=1
    )
    resume_import_idempotency_bind_ttl_seconds: int = Field(
        default=30, alias="RESUME_IMPORT_IDEMPOTENCY_BIND_TTL_SECONDS", ge=1
    )
    resume_import_idempotency_ttl_seconds: int = Field(
        default=900, alias="RESUME_IMPORT_IDEMPOTENCY_TTL_SECONDS", ge=1
    )
    resume_import_worker_concurrency: int = Field(
        default=4,
        alias="RESUME_IMPORT_WORKER_CONCURRENCY",
        ge=1,
        le=100,
    )

    mq_vendor: Literal["rabbitmq", "kafka"] = Field(
        default="rabbitmq", alias="MQ_VENDOR"
    )
    rabbitmq_url: SecretStr | None = Field(default=None, alias="RABBITMQ_URL")
    rabbitmq_exchange_name: str = Field(
        default="tolink.cv.resume_import",
        alias="RABBITMQ_EXCHANGE_NAME",
        min_length=1,
        max_length=255,
    )
    rabbitmq_queue: str = Field(
        default="linkcv.resume_import.worker",
        alias="RABBITMQ_QUEUE",
        min_length=1,
        max_length=255,
    )
    rabbitmq_routing_key: str = Field(
        default="resume.import",
        alias="RABBITMQ_ROUTING_KEY",
        min_length=1,
        max_length=255,
    )
    kafka_bootstrap_servers: str | None = Field(
        default=None, alias="KAFKA_BOOTSTRAP_SERVERS"
    )
    kafka_topic: str = Field(
        default="tolink.cv.resume_import",
        alias="KAFKA_TOPIC",
        min_length=1,
        max_length=249,
    )
    kafka_consumer_group: str = Field(
        default="linkcv.resume_import.worker",
        alias="KAFKA_CONSUMER_GROUP",
        min_length=1,
        max_length=255,
    )
    mq_publish_confirm_timeout_seconds: float = Field(
        default=5,
        alias="MQ_PUBLISH_CONFIRM_TIMEOUT_SECONDS",
        gt=0,
    )
    mq_consume_max_retries: int = Field(
        default=2,
        alias="MQ_CONSUME_MAX_RETRIES",
        ge=0,
        le=10,
    )
    mq_consume_retry_backoff_seconds: float = Field(
        default=1,
        alias="MQ_CONSUME_RETRY_BACKOFF_SECONDS",
        gt=0,
    )

    linkparse_base_url: str = Field(
        default="http://100.86.10.52:18743",
        alias="LINKPARSE_BASE_URL",
    )
    linkparse_api_key: SecretStr | None = Field(
        default=None,
        alias="LINKPARSE_API_KEY",
    )
    linkparse_parse_path: str = Field(
        default="/v1/parse",
        alias="LINKPARSE_PARSE_PATH",
    )
    linkparse_timeout_seconds: float = Field(
        default=90,
        alias="LINKPARSE_TIMEOUT_SECONDS",
        gt=0,
    )
    linkparse_response_max_bytes: int = Field(
        default=3 * 1024 * 1024,
        alias="LINKPARSE_RESPONSE_MAX_BYTES",
        ge=1,
    )
    docx_conversion_timeout_seconds: float = Field(
        default=30,
        alias="DOCX_CONVERSION_TIMEOUT_SECONDS",
        gt=0,
    )

    redis_url_override: str | None = Field(default=None, alias="REDIS_URL")
    redis_host: str = Field(default="127.0.0.1", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_db: int = Field(default=0, alias="REDIS_DB")
    redis_password: str | None = Field(default=None, alias="REDIS_PASSWORD")
    redis_connect_timeout_seconds: float = Field(
        default=2,
        alias="REDIS_CONNECT_TIMEOUT_SECONDS",
        gt=0,
    )
    redis_socket_timeout_seconds: float = Field(
        default=2,
        alias="REDIS_SOCKET_TIMEOUT_SECONDS",
        gt=0,
    )

    web_dist_dir: Path | None = Field(default=None, alias="WEB_DIST_DIR")

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url

        user = quote(self.mysql_user, safe="")
        password = quote(self.mysql_password, safe="")
        database = quote(self.mysql_database, safe="")
        return (
            f"mysql+pymysql://{user}:{password}@{self.mysql_host}:"
            f"{self.mysql_port}/{database}?charset=utf8mb4"
        )

    @property
    def redis_url(self) -> str:
        if self.redis_url_override:
            return self.redis_url_override
        auth = ""
        if self.redis_password:
            auth = f":{quote(self.redis_password, safe='')}@"
        return f"redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.resume_structuring_max_bytes > self.resume_markdown_max_bytes:
            raise ValueError(
                "RESUME_STRUCTURING_MAX_BYTES cannot exceed RESUME_MARKDOWN_MAX_BYTES"
            )
        if (
            self.resume_import_parse_stale_seconds
            <= self.resume_import_parse_deadline_seconds
        ):
            raise ValueError(
                "RESUME_IMPORT_PARSE_STALE_SECONDS must exceed "
                "RESUME_IMPORT_PARSE_DEADLINE_SECONDS"
            )
        if (
            self.resume_import_worker_lock_seconds
            < self.resume_import_parse_stale_seconds
        ):
            raise ValueError(
                "RESUME_IMPORT_WORKER_LOCK_SECONDS must be at least "
                "RESUME_IMPORT_PARSE_STALE_SECONDS"
            )
        rabbitmq_url = (
            self.rabbitmq_url.get_secret_value()
            if self.rabbitmq_url is not None
            else None
        )
        if self.mq_vendor == "kafka" and _is_placeholder(
            self.kafka_bootstrap_servers
        ):
            raise ValueError(
                "KAFKA_BOOTSTRAP_SERVERS is required when MQ_VENDOR=kafka"
            )
        if self.app_environment.lower() != "production":
            return self

        invalid: list[str] = []
        if _is_placeholder(self.jwt_secret) or len(self.jwt_secret) < 32:
            invalid.append("JWT_SECRET")
        if self.database_url:
            if _is_placeholder(self.database_url):
                invalid.append("DATABASE_URL")
        elif _is_placeholder(self.mysql_password):
            invalid.append("MYSQL_PASSWORD")
        if _is_placeholder(self.minio_access_key):
            invalid.append("MINIO_ACCESS_KEY")
        if _is_placeholder(self.minio_secret_key):
            invalid.append("MINIO_SECRET_KEY")
        if _is_placeholder(self.linkparse_base_url):
            invalid.append("LINKPARSE_BASE_URL")
        linkparse_key = (
            self.linkparse_api_key.get_secret_value()
            if self.linkparse_api_key is not None
            else None
        )
        if _is_placeholder(linkparse_key):
            invalid.append("LINKPARSE_API_KEY")
        if self.mq_vendor == "rabbitmq" and _is_placeholder(rabbitmq_url):
            invalid.append("RABBITMQ_URL")
        try:
            llm_keys = parse_llm_credential_encryption_keys(
                self.llm_credential_encryption_keys
            )
        except ValueError:
            llm_keys = ()
        if not llm_keys:
            invalid.append("LLM_CREDENTIAL_ENCRYPTION_KEYS")
        if invalid:
            names = ", ".join(sorted(set(invalid)))
            raise ValueError(f"production secrets are missing or unsafe: {names}")
        return self


@lru_cache
def load_settings() -> Settings:
    return Settings(_env_file=settings_env_files())
