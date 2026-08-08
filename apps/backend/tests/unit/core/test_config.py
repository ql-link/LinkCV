from pathlib import Path

from cryptography.fernet import Fernet
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
    monkeypatch.delenv("APP_ENV", raising=False)
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
        mysql_host="127.0.0.1",
        mysql_port=3306,
        mysql_user="user name",
        mysql_password="p@ss/word",
        mysql_database="link cv",
        redis_host="127.0.0.1",
        redis_port=6379,
        redis_db=0,
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


def test_resume_import_timeout_defaults_leave_cleanup_budget() -> None:
    settings = Settings(
        _env_file=None,
        linkparse_timeout_seconds=90,
        resume_structuring_timeout_seconds=60,
        llm_timeout_seconds=75,
    )

    assert settings.linkparse_timeout_seconds == 90
    assert settings.resume_structuring_timeout_seconds == 60
    assert settings.llm_timeout_seconds == 75
    assert (
        settings.resume_import_parse_stale_seconds
        > settings.resume_import_parse_deadline_seconds
    )
    assert (
        settings.resume_import_worker_lock_seconds
        >= settings.resume_import_parse_stale_seconds
    )


def test_resume_import_parse_stale_window_must_exceed_deadline() -> None:
    with pytest.raises(ValidationError, match="RESUME_IMPORT_PARSE_STALE_SECONDS"):
        Settings(
            resume_import_parse_deadline_seconds=180,
            resume_import_parse_stale_seconds=180,
        )


def test_kafka_vendor_requires_bootstrap_servers() -> None:
    with pytest.raises(ValidationError, match="KAFKA_BOOTSTRAP_SERVERS"):
        Settings(mq_vendor="kafka", kafka_bootstrap_servers="")


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
    assert "LLM_CREDENTIAL_ENCRYPTION_KEYS" in message
    assert "LINKPARSE_API_KEY" in message
    assert "RABBITMQ_URL" in message
    assert exposed not in message
    assert "replace-with-secret" not in message


def test_production_accepts_injected_secrets() -> None:
    settings = Settings(
        app_environment="production",
        jwt_secret="a-production-jwt-secret-with-more-than-32-characters",
        mysql_password="production-db-secret",
        minio_access_key="production-minio-access",
        minio_secret_key="production-minio-secret",
        llm_credential_encryption_keys=(
            f"production:{Fernet.generate_key().decode('ascii')}"
        ),
        linkparse_api_key="fictional-linkparse-key",
        rabbitmq_url="amqp://linkcv:fictional-secret@rabbitmq:5672/",
    )
    assert settings.minio_bucket == "linkcv"
