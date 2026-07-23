import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]


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
    module.create_sql_files("20260723_0002", "add example", tmp_path)

    assert (tmp_path / "20260723_0002.up.sql").is_file()
    assert (tmp_path / "20260723_0002.down.sql").is_file()


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
