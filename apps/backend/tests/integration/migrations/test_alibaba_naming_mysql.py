"""0111-0115 bring every table to the Alibaba MySQL rules without losing data."""

from datetime import datetime

from sqlalchemy import create_engine, inspect, text

import drawoffer.models  # noqa: F401  (register every ORM table)
from drawoffer.core.database import Base
from tests.integration.migrations.test_mysql_migrations import (
    migration_test_url,
    reset_test_database_to_base,
    run_alembic,
)
from tests.migration_naming import TABLE_RENAMES

READ_THROUGH = datetime(2026, 9, 1, 8, 0, 0)


def seed_0110(connection) -> int:
    user_id = connection.execute(
        text(
            "INSERT INTO users (email, password_hash, nickname) "
            "VALUES ('naming@example.test', 'fictional-hash', '张三')"
        )
    ).lastrowid
    connection.execute(
        text(
            "INSERT INTO account_preferences (user_id, locale, interview_reminder_enabled) "
            "VALUES (:user_id, 'en-US', 1)"
        ),
        {"user_id": user_id},
    )
    connection.execute(
        text(
            "INSERT INTO announcement_read_cursors (user_id, read_through_at, updated_at) "
            "VALUES (:user_id, :read_through, :read_through)"
        ),
        {"user_id": user_id, "read_through": READ_THROUGH},
    )
    return user_id


def test_mysql_0111_to_0115_apply_alibaba_naming_and_keep_data() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0110")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            user_id = seed_0110(connection)

        run_alembic(database_url, "upgrade", "head")
        inspector = inspect(engine)
        tables = set(inspector.get_table_names()) - {"alembic_version"}

        assert not tables & set(TABLE_RENAMES), "plural table names must be gone"
        assert set(TABLE_RENAMES.values()) <= tables
        for table in sorted(tables):
            columns = {column["name"]: column for column in inspector.get_columns(table)}
            assert inspector.get_foreign_keys(table) == [], table
            assert inspector.get_pk_constraint(table)["constrained_columns"] == ["id"], table
            assert {"create_time", "update_time"} <= set(columns), table
            assert not {"created_at", "updated_at"} & set(columns), table
            assert all(column.get("comment") for column in columns.values()), table

        # The ORM must describe exactly the migrated schema.
        for table in Base.metadata.sorted_tables:
            live = {column["name"] for column in inspector.get_columns(table.name)}
            assert live == {column.name for column in table.columns}, table.name

        with engine.connect() as connection:
            assert connection.scalar(
                text("SELECT email FROM `user` WHERE id = :id"), {"id": user_id}
            ) == "naming@example.test"
            preference = connection.execute(
                text(
                    "SELECT id, locale, is_interview_reminder_enabled FROM account_preference "
                    "WHERE user_id = :id"
                ),
                {"id": user_id},
            ).one()
            assert preference.id >= 1
            assert preference.locale == "en-US"
            assert preference.is_interview_reminder_enabled == 1
            cursor = connection.execute(
                text(
                    "SELECT create_time, update_time, read_through_at FROM announcement_read_cursor "
                    "WHERE user_id = :id"
                ),
                {"id": user_id},
            ).one()
            # 0114 backfills create_time from update_time without touching update_time.
            assert cursor.create_time == cursor.update_time == READ_THROUGH
            boolean = connection.execute(
                text(
                    "SELECT column_type FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = 'agent_session' "
                    "AND column_name = 'is_pinned'"
                )
            ).scalar_one()
            assert boolean == "tinyint unsigned"
    finally:
        engine.dispose()
