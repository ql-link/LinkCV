from pathlib import Path

import pytest
from pydantic import ValidationError

from linkcv.core.config import Settings, settings_env_files


def test_settings_env_files_are_stable_and_include_local_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = tmp_path / ".env.development"
    local = tmp_path / ".env.development.local"
    base.write_text("APP_ENV=development\nMYSQL_USER=shared\n", encoding="utf-8")
    local.write_text("MYSQL_USER=local-secret-user\n", encoding="utf-8")
    monkeypatch.setenv("LINKCV_ENV_FILE", str(base))
    monkeypatch.delenv("MYSQL_USER", raising=False)

    files = settings_env_files()
    settings = Settings(_env_file=files)

    assert files == (base, local)
    assert settings.app_environment == "development"
    assert settings.mysql_user == "local-secret-user"


def test_process_environment_has_highest_priority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = tmp_path / ".env"
    local = tmp_path / ".env.local"
    base.write_text("MYSQL_USER=base\n", encoding="utf-8")
    local.write_text("MYSQL_USER=local\n", encoding="utf-8")
    monkeypatch.setenv("LINKCV_ENV_FILE", str(base))
    monkeypatch.setenv("MYSQL_USER", "process")

    assert Settings(_env_file=settings_env_files()).mysql_user == "process"


def test_mysql_and_redis_urls_encode_credentials() -> None:
    settings = Settings(
        mysql_user="user name",
        mysql_password="p@ss/word",
        mysql_database="link cv",
        redis_password="redis/@ password",
    )

    assert settings.sqlalchemy_url == (
        "mysql+pymysql://user%20name:p%40ss%2Fword@127.0.0.1:3306/"
        "link%20cv?charset=utf8mb4"
    )
    assert settings.redis_url == ("redis://:redis%2F%40%20password@127.0.0.1:6379/0")


def test_complete_urls_override_component_settings() -> None:
    settings = Settings(
        database_url="mysql+pymysql://complete:secret@db:3306/linkcv",
        redis_url_override="redis://cache:6379/4",
        mysql_host="ignored",
        redis_host="ignored",
    )

    assert settings.sqlalchemy_url == "mysql+pymysql://complete:secret@db:3306/linkcv"
    assert settings.redis_url == "redis://cache:6379/4"


def test_redis_url_without_password_has_no_authentication_fragment() -> None:
    settings = Settings(redis_password=None, redis_host="cache", redis_port=6380)

    assert settings.redis_url == "redis://cache:6380/0"


def test_resume_version_limit_defaults_to_ten() -> None:
    settings = Settings(_env_file=None)

    assert settings.resume_version_limit == 10


def test_structuring_input_limit_cannot_exceed_markdown_limit() -> None:
    with pytest.raises(ValidationError, match="RESUME_STRUCTURING_MAX_BYTES"):
        Settings(
            resume_markdown_max_bytes=1024,
            resume_structuring_max_bytes=1025,
        )


def test_production_rejects_missing_secrets_without_exposing_values() -> None:
    exposed = "database-password-must-not-leak"
    with pytest.raises(ValidationError) as error:
        Settings(
            app_environment="production",
            jwt_secret="short",
            mysql_password=exposed,
            minio_access_key="",
            minio_secret_key="replace-with-secret",
        )

    message = str(error.value)
    assert "JWT_SECRET" in message
    assert "MINIO_ACCESS_KEY" in message
    assert "MINIO_SECRET_KEY" in message
    assert exposed not in message
    assert "replace-with-secret" not in message


def test_production_accepts_injected_secrets_and_oss_stays_reserved() -> None:
    settings = Settings(
        app_environment="production",
        jwt_secret="a-production-jwt-secret-with-more-than-32-characters",
        mysql_password="production-db-secret",
        minio_access_key="production-minio-access",
        minio_secret_key="production-minio-secret",
        aliyun_oss_endpoint="https://oss-cn-hangzhou.aliyuncs.com",
        aliyun_oss_region="cn-hangzhou",
        aliyun_oss_access_key_id="reserved-access",
        aliyun_oss_access_key_secret="reserved-secret",
        aliyun_oss_bucket="reserved-bucket",
    )

    assert settings.aliyun_oss_bucket == "reserved-bucket"
    assert settings.minio_bucket == "linkcv"
