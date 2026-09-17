"""Focused MySQL checks against a reconstructed pre-logo metadata baseline.

The full historical migration suite remains a separate check; this fixture must
not be reported as proof that every historical revision upgrades successfully.
"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from time import sleep

from sqlalchemy import MetaData, Table, create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker

import linkresume.models  # noqa: F401
from linkresume.application.job_descriptions.logo_service import attach_logo
from linkresume.core.database import Base
from linkresume.modules.job_descriptions.models import JobDescription
from tests.integration.api.test_company_logos import LogoStorage, picture
from tests.integration.migrations.test_mysql_migrations import (
    invoke_alembic,
    migration_test_url,
    reset_test_database_to_base,
    run_alembic,
)


def _metadata_without_company_logo_schema() -> tuple[MetaData, Table]:
    baseline = MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name != "global_companies":
            table.to_metadata(baseline)
    table = baseline.tables["job_descriptions"]
    table._columns.remove(table.c.logo_url)
    table._columns.remove(table.c.logo_sha256)
    return baseline, table


def test_logo_upgrade_repairs_legacy_development_0059_shape():
    url = migration_test_url()
    reset_test_database_to_base(url)
    engine = create_engine(url)
    baseline, jobs = _metadata_without_company_logo_schema()
    baseline.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text("""
            CREATE TABLE user_preferences (
              user_id BIGINT UNSIGNED NOT NULL,
              preference_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
              value_json JSON NOT NULL,
              CONSTRAINT pk_user_preferences PRIMARY KEY (user_id, preference_key),
              CONSTRAINT fk_user_preferences_user
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
              CONSTRAINT ck_user_preferences_value_object
                CHECK (LOWER(JSON_TYPE(value_json)) = 'object')
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        """)
        )
    run_alembic(url, "stamp", "0061")
    with engine.begin() as connection:
        user = connection.execute(
            baseline.tables["users"]
            .insert()
            .values(
                email="legacy-logo-migration@example.test",
                password_hash="fictional",
                nickname="张三",
            )
        ).lastrowid
        connection.execute(
            jobs.insert().values(
                user_id=user,
                job_title="历史岗位",
                company_name="示例公司",
                description="测试正文",
                skills=[],
                source_type="manual",
            )
        )

    run_alembic(url, "upgrade", "head")
    run_alembic(url, "upgrade", "head")

    inspector = inspect(engine)
    assert {"user_preferences", "global_companies"} <= set(inspector.get_table_names())
    columns = {
        column["name"]: column for column in inspector.get_columns("job_descriptions")
    }
    assert columns["logo_url"]["type"].length == 2048
    assert columns["logo_sha256"]["type"].length == 64
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT job_title, logo_url, logo_sha256 FROM job_descriptions")
        ).one() == ("历史岗位", None, None)
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0062"
        )
    engine.dispose()


def test_logo_upgrade_resumes_after_legacy_logo_url_ddl_committed():
    url = migration_test_url()
    reset_test_database_to_base(url)
    engine = create_engine(url)
    baseline, _ = _metadata_without_company_logo_schema()
    baseline.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text("""
                CREATE TABLE user_preferences (
                  user_id BIGINT UNSIGNED NOT NULL,
                  preference_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                  value_json JSON NOT NULL,
                  CONSTRAINT pk_user_preferences PRIMARY KEY (user_id, preference_key),
                  CONSTRAINT fk_user_preferences_user
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
                  CONSTRAINT ck_user_preferences_value_object
                    CHECK (LOWER(JSON_TYPE(value_json)) = 'object')
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
            """)
        )
        connection.execute(
            text(
                "ALTER TABLE job_descriptions "
                "ADD COLUMN logo_url VARCHAR(2048) NULL AFTER company_name"
            )
        )
    run_alembic(url, "stamp", "0061")

    run_alembic(url, "upgrade", "head")

    inspector = inspect(engine)
    assert "global_companies" in inspector.get_table_names()
    assert {"logo_url", "logo_sha256"} <= {
        column["name"] for column in inspector.get_columns("job_descriptions")
    }
    engine.dispose()


def test_logo_upgrade_rejects_unknown_partial_schema_before_ddl():
    url = migration_test_url()
    reset_test_database_to_base(url)
    engine = create_engine(url)
    baseline, _ = _metadata_without_company_logo_schema()
    baseline.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "ALTER TABLE job_descriptions "
                "ADD COLUMN logo_url VARCHAR(2048) NULL AFTER company_name"
            )
        )
    run_alembic(url, "stamp", "0061")

    result = invoke_alembic(url, "upgrade", "head")

    assert result.returncode != 0
    assert (
        "0062 company-logo schema is unsupported or partially applied" in result.stderr
    )
    inspector = inspect(engine)
    assert "global_companies" not in inspector.get_table_names()
    assert "logo_sha256" not in {
        column["name"] for column in inspector.get_columns("job_descriptions")
    }
    engine.dispose()


def test_logo_upgrade_stamps_after_target_ddl_was_committed():
    url = migration_test_url()
    reset_test_database_to_base(url)
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    run_alembic(url, "stamp", "0061")

    run_alembic(url, "upgrade", "head")

    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0062"
        )
    inspector = inspect(engine)
    assert "global_companies" in inspector.get_table_names()
    assert {"logo_url", "logo_sha256"} <= {
        column["name"] for column in inspector.get_columns("job_descriptions")
    }
    engine.dispose()


def test_logo_column_upgrade_preserves_jobs_and_concurrent_upload_reuses_content():
    url = migration_test_url()
    reset_test_database_to_base(url)
    engine = create_engine(url)
    baseline = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(baseline)
    table = baseline.tables["job_descriptions"]
    table._columns.remove(table.c.logo_sha256)
    baseline.create_all(engine)
    run_alembic(url, "stamp", "0061")
    before_tables = set(inspect(engine).get_table_names())
    with engine.begin() as connection:
        user = connection.execute(
            baseline.tables["users"]
            .insert()
            .values(
                email="logo-migration@example.test",
                password_hash="fictional",
                nickname="张三",
            )
        ).lastrowid
        for title in ["岗位一", "岗位二"]:
            connection.execute(
                table.insert().values(
                    user_id=user,
                    job_title=title,
                    company_name="示例公司",
                    logo_url="https://example.test/old.png",
                    description="测试正文",
                    skills=[],
                    source_type="manual",
                )
            )
    run_alembic(url, "upgrade", "head")
    run_alembic(url, "upgrade", "head")
    inspector = inspect(engine)
    assert set(inspector.get_table_names()) == before_tables
    column = next(
        col
        for col in inspector.get_columns("job_descriptions")
        if col["name"] == "logo_sha256"
    )
    assert column["nullable"] and column["type"].length == 64
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT job_title, logo_url, logo_sha256 FROM job_descriptions ORDER BY id"
            )
        ).all()
        assert rows == [
            ("岗位一", "https://example.test/old.png", None),
            ("岗位二", "https://example.test/old.png", None),
        ]
        info = connection.execute(
            text(
                "SELECT character_set_name, collation_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='job_descriptions' AND column_name='logo_sha256'"
            )
        ).one()
        assert info == ("ascii", "ascii_bin")

    class SlowStorage(LogoStorage):
        def put(self, *args, **kwargs):
            sleep(0.15)
            super().put(*args, **kwargs)

    storage = SlowStorage()
    sessions = sessionmaker(engine, expire_on_commit=False)
    barrier = Barrier(2)

    def save(job_id):
        with sessions() as db:
            job = db.get(JobDescription, job_id)
            barrier.wait(timeout=5)
            return attach_logo(
                db, storage, job, picture(), mode="fill_missing", expected_revision=None
            )

    with sessions() as db:
        ids = list(db.scalars(select(JobDescription.id)))
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(save, ids))
    assert results[0]["revision"] == results[1]["revision"]
    assert storage.writes == 1
    with sessions() as db:
        assert (
            list(db.scalars(select(JobDescription.logo_sha256)))
            == [results[0]["revision"]] * 2
        )
    engine.dispose()
