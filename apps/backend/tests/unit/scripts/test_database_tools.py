import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
INITIAL_REVISION = "0001"
FOUR_TABLE_REVISION = "0002"
TEMPLATE_DELETE_REVISION = "0003"


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_no_legacy_python_schema_baseline_is_present() -> None:
    assert not (REPO_ROOT / "apps/backend/migrations/db.sql").exists()
    assert not (
        REPO_ROOT / "apps/backend/migrations/versions/20260723_0001_initial.py"
    ).exists()


def test_sql_migration_executor_rejects_database_scope_changes(tmp_path: Path) -> None:
    module = load_module(
        "linkcv_migration_sql_test",
        REPO_ROOT / "apps/backend/src/linkcv/core/migration_sql.py",
    )
    sql_file = tmp_path / "unsafe.up.sql"
    sql_file.write_text("USE other_database;", encoding="utf-8")

    with pytest.raises(ValueError, match="cannot change database scope"):
        module.execute_sql_file(object(), sql_file)


def test_sql_revision_files_are_created_as_a_pair(tmp_path: Path) -> None:
    module = load_module(
        "linkcv_create_sql_revision_test",
        REPO_ROOT / "scripts/db/create_sql_revision.py",
    )
    module.create_sql_files("0002", "add example", tmp_path)

    assert (tmp_path / "0002.up.sql").is_file()
    assert (tmp_path / "0002.down.sql").is_file()


def test_next_sql_revision_uses_zero_padded_sequence(tmp_path: Path) -> None:
    module = load_module(
        "linkcv_create_sql_revision_sequence_test",
        REPO_ROOT / "scripts/db/create_sql_revision.py",
    )

    assert module.next_revision_id(tmp_path) == "0001"
    (tmp_path / "0001_create_users.py").write_text("revision", encoding="utf-8")
    assert module.next_revision_id(tmp_path) == "0002"


def test_next_sql_revision_rejects_mixed_random_ids(tmp_path: Path) -> None:
    module = load_module(
        "linkcv_create_sql_revision_invalid_sequence_test",
        REPO_ROOT / "scripts/db/create_sql_revision.py",
    )
    (tmp_path / "2b158fb5d8b6_random.py").write_text("revision", encoding="utf-8")

    with pytest.raises(ValueError, match="must use 000x naming"):
        module.next_revision_id(tmp_path)


def test_initial_business_revision_is_sql_first_and_complete() -> None:
    revision = next(
        (REPO_ROOT / "apps/backend/migrations/versions").glob(
            f"{INITIAL_REVISION}_*.py"
        )
    )
    revision_text = revision.read_text(encoding="utf-8")
    up_sql = (
        REPO_ROOT / f"apps/backend/migrations/sql/{INITIAL_REVISION}.up.sql"
    ).read_text(encoding="utf-8")
    down_sql = (
        REPO_ROOT / f"apps/backend/migrations/sql/{INITIAL_REVISION}.down.sql"
    ).read_text(encoding="utf-8")

    assert "op.create_table" not in revision_text
    assert f'"{INITIAL_REVISION}.up.sql"' in revision_text
    assert f'"{INITIAL_REVISION}.down.sql"' in revision_text
    assert "CREATE TABLE users" in up_sql
    assert "CREATE TABLE resumes" in up_sql
    assert "markdown LONGTEXT NOT NULL" in up_sql
    assert "split_ratio DOUBLE NOT NULL" in up_sql
    assert "created_at DATETIME(6)" in up_sql
    assert "ck_users_auth_version_positive" in up_sql
    assert "ck_resumes_split_ratio_positive" in up_sql
    assert "ck_resumes_preview_scale_positive" in up_sql
    assert "CONSTRAINT uk_users_email UNIQUE (email)" in up_sql
    assert "CONSTRAINT fk_resumes_user_id_users" in up_sql
    assert "KEY idx_resumes_user_updated (user_id, updated_at)" in up_sql
    assert down_sql.index("DROP TABLE resumes") < down_sql.index("DROP TABLE users")


def test_four_core_table_revision_is_sql_first_and_guarded() -> None:
    revision = next(
        (REPO_ROOT / "apps/backend/migrations/versions").glob(
            f"{FOUR_TABLE_REVISION}_*.py"
        )
    )
    revision_text = revision.read_text(encoding="utf-8")
    up_sql = (
        REPO_ROOT / f"apps/backend/migrations/sql/{FOUR_TABLE_REVISION}.up.sql"
    ).read_text(encoding="utf-8")
    down_sql = (
        REPO_ROOT / f"apps/backend/migrations/sql/{FOUR_TABLE_REVISION}.down.sql"
    ).read_text(encoding="utf-8")

    assert "op.create_table" not in revision_text
    assert 'revision: str = \'0002\'' in revision_text
    assert 'down_revision: str | None = \'0001\'' in revision_text
    assert '"0002.up.sql"' in revision_text
    assert '"0002.down.sql"' in revision_text
    assert "require_empty_business_tables(connection)" in revision_text
    assert "only supports empty business tables" in revision_text
    assert "DROP TABLE IF EXISTS resumes" in up_sql
    assert "CREATE TABLE users" in up_sql
    assert "CREATE TABLE resume_templates" in up_sql
    assert "CREATE TABLE resumes" in up_sql
    assert "CREATE TABLE resume_versions" in up_sql
    assert "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT" in up_sql
    assert "auth_version" not in up_sql
    assert "idx_resumes_user_updated_id" in up_sql
    assert "uk_resume_versions_no" in up_sql
    assert "DROP TABLE IF EXISTS resume_versions" in down_sql
    assert down_sql.index("DROP TABLE IF EXISTS resume_versions") < down_sql.index(
        "DROP TABLE IF EXISTS resumes"
    )


def test_template_delete_revision_is_sql_first_and_reversible_when_safe() -> None:
    revision = next(
        (REPO_ROOT / "apps/backend/migrations/versions").glob(
            f"{TEMPLATE_DELETE_REVISION}_*.py"
        )
    )
    revision_text = revision.read_text(encoding="utf-8")
    up_sql = (
        REPO_ROOT
        / f"apps/backend/migrations/sql/{TEMPLATE_DELETE_REVISION}.up.sql"
    ).read_text(encoding="utf-8")
    down_sql = (
        REPO_ROOT
        / f"apps/backend/migrations/sql/{TEMPLATE_DELETE_REVISION}.down.sql"
    ).read_text(encoding="utf-8")

    assert "op.create_foreign_key" not in revision_text
    assert "0003.up.sql" in revision_text
    assert "0003.down.sql" in revision_text
    assert "ON DELETE SET NULL" in up_sql
    assert "ON DELETE RESTRICT" in down_sql
    assert "DROP CHECK ck_resumes_source_fields" in up_sql
    assert "source_type = 'template' AND template_id IS NULL" in revision_text


def test_database_initializer_rejects_any_schema_except_linkcv() -> None:
    module = load_module(
        "linkcv_init_mysql_test", REPO_ROOT / "scripts/db/init_mysql.py"
    )

    with pytest.raises(ValueError, match="target must be 'linkcv'"):
        module.validated_target(
            "mysql+pymysql://user:secret@db.example:3306/tolink_rag_db"
        )


def test_database_initializer_summary_never_contains_password() -> None:
    module = load_module(
        "linkcv_init_mysql_summary_test", REPO_ROOT / "scripts/db/init_mysql.py"
    )

    target = module.validated_target(
        "mysql+pymysql://linkcv:super-secret@db.example:3306/linkcv"
    )

    assert target.audit_summary == ("database=db.example:3306/linkcv user=linkcv")
    assert "super-secret" not in target.audit_summary


def test_database_initializer_reports_only_mysql_error_code() -> None:
    module = load_module(
        "linkcv_init_mysql_error_test", REPO_ROOT / "scripts/db/init_mysql.py"
    )
    error = module.OperationalError(
        "statement",
        {},
        RuntimeError(1045, "Access denied for user with hidden details"),
    )

    assert module.safe_failure_reason(error) == "mysql_error_code=1045"
    assert module.mysql_error_code(error) == 1045


def test_release_runner_validates_all_expected_target_fields() -> None:
    module = load_module(
        "linkcv_run_alembic_test", REPO_ROOT / "scripts/release/run_alembic.py"
    )
    expected = module.ExpectedTarget(
        app_env="development",
        host="db.example",
        port=13306,
        database="linkcv",
    )

    summary = module.validate_target(
        "mysql+pymysql://linkcv:super-secret@db.example:13306/linkcv",
        "development",
        expected,
    )

    assert summary == (
        "APP_ENV=development database=db.example:13306/linkcv user=linkcv"
    )
    assert "super-secret" not in summary


def test_release_runner_fails_before_migration_on_target_mismatch() -> None:
    module = load_module(
        "linkcv_run_alembic_mismatch_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    expected = module.ExpectedTarget(
        app_env="development",
        host="expected.example",
        port=13306,
        database="linkcv",
    )

    with pytest.raises(ValueError, match="Alembic target mismatch") as error:
        module.validate_target(
            "mysql+pymysql://linkcv:super-secret@actual.example:3306/linkcv",
            "development",
            expected,
        )

    assert "super-secret" not in str(error.value)
