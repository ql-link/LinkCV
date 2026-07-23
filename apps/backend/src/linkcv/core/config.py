from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
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
    session_ttl_days: int = Field(default=7, alias="SESSION_TTL_DAYS")
    cookie_secure: bool = Field(default=False, alias="COOKIE_SECURE")

    minio_endpoint: str = Field(default="http://127.0.0.1:9000", alias="MINIO_ENDPOINT")
    minio_access_key: str = Field(default="linkcv", alias="MINIO_ACCESS_KEY")
    minio_secret_key: str = Field(
        default="linkcv-minio-local-change-me",
        alias="MINIO_SECRET_KEY",
    )
    minio_bucket: str = Field(default="linkcv", alias="MINIO_BUCKET")

    web_dist_dir: Path | None = Field(default=None, alias="WEB_DIST_DIR")

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url

        user = quote_plus(self.mysql_user)
        password = quote_plus(self.mysql_password)
        database = quote_plus(self.mysql_database)
        return (
            f"mysql+pymysql://{user}:{password}@{self.mysql_host}:"
            f"{self.mysql_port}/{database}?charset=utf8mb4"
        )


@lru_cache
def load_settings() -> Settings:
    return Settings()
