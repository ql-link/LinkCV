import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

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


def test_sql_migration_executor_keeps_json_colons_literal(tmp_path: Path) -> None:
    module = load_module(
        "linkcv_migration_sql_json_test",
        REPO_ROOT / "apps/backend/src/linkcv/core/migration_sql.py",
    )
    sql_file = tmp_path / "json.up.sql"
    sql_file.write_text(
        "INSERT INTO example (payload) VALUES "
        "('{\"font_size\":14,\"smart_one_page\":false}');",
        encoding="utf-8",
    )

    class Connection:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def exec_driver_sql(
            self,
            statement: str,
            *,
            execution_options: dict[str, bool],
        ) -> None:
            assert execution_options == {"no_parameters": True}
            self.statements.append(statement)

    connection = Connection()
    module.execute_sql_file(connection, sql_file)

    assert connection.statements == [
        "INSERT INTO example (payload) VALUES "
        "('{\"font_size\":14,\"smart_one_page\":false}')"
    ]


def test_sql_migration_executor_keeps_percent_literals_unparameterized(
    tmp_path: Path,
) -> None:
    module = load_module(
        "linkcv_migration_sql_percent_test",
        REPO_ROOT / "apps/backend/src/linkcv/core/migration_sql.py",
    )
    sql_file = tmp_path / "percent.up.sql"
    sql_file.write_text(
        "INSERT INTO example (payload) VALUES ('专业前 10%');",
        encoding="utf-8",
    )

    class Connection:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, bool]]] = []

        def exec_driver_sql(
            self,
            statement: str,
            *,
            execution_options: dict[str, bool],
        ) -> None:
            self.calls.append((statement, execution_options))

    connection = Connection()
    module.execute_sql_file(connection, sql_file)

    assert connection.calls == [
        (
            "INSERT INTO example (payload) VALUES ('专业前 10%')",
            {"no_parameters": True},
        )
    ]


def test_sql_migration_executor_strips_utf8_bom(tmp_path: Path) -> None:
    module = load_module(
        "linkcv_migration_sql_bom_test",
        REPO_ROOT / "apps/backend/src/linkcv/core/migration_sql.py",
    )
    sql_file = tmp_path / "bom.up.sql"
    sql_file.write_text(
        "-- migration comment\nALTER TABLE example ADD COLUMN enabled BOOLEAN;",
        encoding="utf-8-sig",
    )

    class Connection:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def exec_driver_sql(
            self,
            statement: str,
            *,
            execution_options: dict[str, bool],
        ) -> None:
            assert execution_options == {"no_parameters": True}
            self.statements.append(statement)

    connection = Connection()
    module.execute_sql_file(connection, sql_file)

    assert connection.statements == [
        "ALTER TABLE example ADD COLUMN enabled BOOLEAN"
    ]


def test_sql_revision_creates_only_upgrade_file(tmp_path: Path) -> None:
    module = load_module(
        "linkcv_create_sql_revision_test",
        REPO_ROOT / "scripts/db/create_sql_revision.py",
    )
    module.create_up_sql_file("0002", "add example", tmp_path)

    assert (tmp_path / "0002.up.sql").is_file()
    assert not (tmp_path / "0002.down.sql").exists()


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
    assert "op.create_table" not in revision_text
    assert f'"{INITIAL_REVISION}.up.sql"' in revision_text
    assert ".down.sql" not in revision_text
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
    assert "op.create_table" not in revision_text
    assert 'revision: str = \'0002\'' in revision_text
    assert 'down_revision: str | None = \'0001\'' in revision_text
    assert '"0002.up.sql"' in revision_text
    assert ".down.sql" not in revision_text
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


def test_template_delete_revision_is_sql_first_and_forward_only() -> None:
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
    assert "op.create_foreign_key" not in revision_text
    assert "0003.up.sql" in revision_text
    assert ".down.sql" not in revision_text
    assert "ON DELETE SET NULL" in up_sql
    assert "DROP CHECK ck_resumes_source_fields" in up_sql


def test_all_migrations_are_forward_only() -> None:
    sql_dir = REPO_ROOT / "apps/backend/migrations/sql"
    assert list(sql_dir.glob("*.down.sql")) == []
    for revision in (REPO_ROOT / "apps/backend/migrations/versions").glob("*.py"):
        if revision.name == "__init__.py":
            continue
        revision_text = revision.read_text(encoding="utf-8")
        assert ".down.sql" not in revision_text
        assert "LinkCV database migrations are forward-only" in revision_text


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


def migration_script_directory(module: ModuleType) -> ScriptDirectory:
    config = Config(str(module.BACKEND_ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location", str(module.BACKEND_ROOT / "migrations")
    )
    return ScriptDirectory.from_config(config)


def test_release_runner_rejects_agent_tables_ahead_of_alembic_revision() -> None:
    module = load_module(
        "linkcv_run_alembic_table_drift_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0029')"))
        connection.execute(text("CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY)"))

    with engine.connect() as connection, pytest.raises(
        RuntimeError, match="0030 tables exist before revision"
    ):
        module.validate_schema_revision_alignment(
            connection, migration_script_directory(module)
        )
    engine.dispose()


def test_release_runner_rejects_missing_tables_for_applied_revision() -> None:
    module = load_module(
        "linkcv_run_alembic_missing_table_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0030')"))
        connection.execute(text("CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY)"))

    with engine.connect() as connection, pytest.raises(
        RuntimeError, match="0030 missing tables"
    ):
        module.validate_schema_revision_alignment(
            connection, migration_script_directory(module)
        )
    engine.dispose()


def test_release_runner_rejects_scoped_columns_ahead_of_revision() -> None:
    module = load_module(
        "linkcv_run_alembic_column_drift_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0030')"))
        for table_name in module.REVISION_TABLE_MARKERS["0030"]:
            connection.execute(text(f"CREATE TABLE {table_name} (id INTEGER PRIMARY KEY)"))
        connection.execute(
            text("ALTER TABLE resume_change_proposals ADD COLUMN proposal_mode VARCHAR(32)")
        )

    with engine.connect() as connection, pytest.raises(
        RuntimeError, match="0031 columns exist before revision"
    ):
        module.validate_schema_revision_alignment(
            connection, migration_script_directory(module)
        )
    engine.dispose()


def test_release_runner_accepts_aligned_agent_schema() -> None:
    module = load_module(
        "linkcv_run_alembic_aligned_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0032')"))
        for table_name in module.REVISION_TABLE_MARKERS["0030"]:
            marker_columns = set().union(
                *(
                    table_markers.get(table_name, frozenset())
                    for table_markers in module.REVISION_COLUMN_MARKERS.values()
                )
            )
            if marker_columns:
                columns = ", ".join(f"{column} TEXT" for column in marker_columns)
                connection.execute(
                    text(
                        f"CREATE TABLE {table_name} (id INTEGER PRIMARY KEY, {columns})"
                    )
                )
            else:
                connection.execute(
                    text(f"CREATE TABLE {table_name} (id INTEGER PRIMARY KEY)")
                )

    with engine.connect() as connection:
        assert module.validate_schema_revision_alignment(
            connection, migration_script_directory(module)
        ) == ("0032",)
    engine.dispose()


def test_release_runner_rejects_clarification_columns_ahead_of_revision() -> None:
    module = load_module(
        "linkcv_run_alembic_clarification_drift_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0031')"))
        for table_name in module.REVISION_TABLE_MARKERS["0030"]:
            if table_name == "resume_change_proposals":
                columns = ", ".join(
                    f"{column} TEXT"
                    for column in module.REVISION_COLUMN_MARKERS["0031"][table_name]
                )
                connection.execute(
                    text(f"CREATE TABLE {table_name} (id INTEGER PRIMARY KEY, {columns})")
                )
            elif table_name == "agent_messages":
                connection.execute(
                    text("CREATE TABLE agent_messages (id INTEGER PRIMARY KEY, message_type TEXT)")
                )
            else:
                connection.execute(text(f"CREATE TABLE {table_name} (id INTEGER PRIMARY KEY)"))

    with engine.connect() as connection, pytest.raises(
        RuntimeError, match="0032 columns exist before revision"
    ):
        module.validate_schema_revision_alignment(
            connection, migration_script_directory(module)
        )
    engine.dispose()


def test_release_runner_rejects_job_archive_column_still_present_after_0034() -> None:
    module = load_module(
        "linkcv_run_alembic_removed_column_applied_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    module.REVISION_TABLE_MARKERS = {}
    module.REVISION_COLUMN_MARKERS = {}
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0034')"))
        connection.execute(
            text(
                "CREATE TABLE job_descriptions "
                "(id INTEGER PRIMARY KEY, archived_at TEXT)"
            )
        )

    with engine.connect() as connection, pytest.raises(
        RuntimeError, match="0034 removed columns still exist"
    ):
        module.validate_schema_revision_alignment(
            connection, migration_script_directory(module)
        )
    engine.dispose()


def test_release_runner_rejects_job_archive_column_removed_before_0034() -> None:
    module = load_module(
        "linkcv_run_alembic_removed_column_ahead_test",
        REPO_ROOT / "scripts/release/run_alembic.py",
    )
    module.REVISION_TABLE_MARKERS = {}
    module.REVISION_COLUMN_MARKERS = {}
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0033')"))
        connection.execute(text("CREATE TABLE job_descriptions (id INTEGER PRIMARY KEY)"))

    with engine.connect() as connection, pytest.raises(
        RuntimeError, match="0034 columns removed before revision"
    ):
        module.validate_schema_revision_alignment(
            connection, migration_script_directory(module)
        )
    engine.dispose()
