import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[5]


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
    session_cookie_name: str = Field(
        default="resume_session", alias="SESSION_COOKIE_NAME"
    )
    # SESSION_TTL_DAYS 保留为七天的语义契约,Redis 会话滑动有效期沿用该值。
    session_ttl_days: int = Field(default=7, alias="SESSION_TTL_DAYS")
    # Access Token 为短期 JWT,默认 30 分钟失效,需要 Refresh Token 续期。
    access_token_ttl_minutes: int = Field(
        default=30, alias="ACCESS_TOKEN_TTL_MINUTES"
    )
    # 单个会话绝对上限 30 天,滑动续期不可越过该时间窗。
    refresh_token_absolute_days: int = Field(
        default=30, alias="REFRESH_TOKEN_ABSOLUTE_DAYS"
    )
    # Refresh 不透明通行串对应的 HttpOnly Cookie 名,与 access Cookie 分离。
    refresh_cookie_name: str = Field(
        default="resume_refresh", alias="REFRESH_COOKIE_NAME"
    )
    cookie_secure: bool = Field(default=False, alias="COOKIE_SECURE")

    minio_endpoint: str = Field(default="http://127.0.0.1:9000", alias="MINIO_ENDPOINT")
    minio_access_key: str = Field(default="linkcv", alias="MINIO_ACCESS_KEY")
    minio_secret_key: str = Field(
        default="linkcv-minio-local-change-me",
        alias="MINIO_SECRET_KEY",
    )
    minio_bucket: str = Field(default="linkcv", alias="MINIO_BUCKET")

    redis_url_override: str | None = Field(default=None, alias="REDIS_URL")
    redis_host: str = Field(default="127.0.0.1", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_db: int = Field(default=0, alias="REDIS_DB")
    redis_password: str | None = Field(default=None, alias="REDIS_PASSWORD")

    aliyun_oss_endpoint: str | None = Field(default=None, alias="ALIYUN_OSS_ENDPOINT")
    aliyun_oss_region: str | None = Field(default=None, alias="ALIYUN_OSS_REGION")
    aliyun_oss_access_key_id: str | None = Field(
        default=None, alias="ALIYUN_OSS_ACCESS_KEY_ID"
    )
    aliyun_oss_access_key_secret: str | None = Field(
        default=None, alias="ALIYUN_OSS_ACCESS_KEY_SECRET"
    )
    aliyun_oss_bucket: str | None = Field(default=None, alias="ALIYUN_OSS_BUCKET")

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
        if invalid:
            names = ", ".join(sorted(set(invalid)))
            raise ValueError(f"production secrets are missing or unsafe: {names}")
        return self


@lru_cache
def load_settings() -> Settings:
    return Settings(_env_file=settings_env_files())
