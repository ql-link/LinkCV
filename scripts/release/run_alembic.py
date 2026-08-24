#!/usr/bin/env python3
"""Validate the deployment target before running LinkCV Alembic migrations."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Connection, make_url

from linkcv.core.config import load_settings

BACKEND_ROOT = Path(__file__).resolve().parents[2] / "apps" / "backend"

REVISION_TABLE_MARKERS = {
    "0030": frozenset(
        {
            "agent_sessions",
            "agent_runs",
            "agent_messages",
            "agent_tool_calls",
            "resume_change_proposals",
        }
    ),
    "0033": frozenset(
        {
            "job_applications",
            "interview_sessions",
            "interview_assets",
        }
    ),
    "0036": frozenset({"release_notices"}),
}
REVISION_COLUMN_MARKERS = {
    "0031": {
        "resume_change_proposals": frozenset(
            {
                "proposal_mode",
                "target_locator_json",
                "target_content_hash",
                "diagnosis_json",
                "operations_json",
                "rationale_json",
                "source_refs_json",
            }
        ),
    },
    "0032": {
        "agent_messages": frozenset({"message_type", "metadata_json"}),
    },
    "0036": {
        "users": frozenset({"last_notice_read_at"}),
    },
}
REVISION_REMOVED_COLUMN_MARKERS = {
    "0034": {
        "job_descriptions": frozenset({"archived_at"}),
    },
}


@dataclass(frozen=True)
class ExpectedTarget:
    app_env: str
    host: str
    port: int
    database: str


def validate_target(database_url: str, app_env: str, expected: ExpectedTarget) -> str:
    url = make_url(database_url)
    actual = {
        "APP_ENV": app_env,
        "MYSQL_HOST": url.host or "",
        "MYSQL_PORT": url.port or 3306,
        "MYSQL_DATABASE": url.database or "",
    }
    wanted = {
        "APP_ENV": expected.app_env,
        "MYSQL_HOST": expected.host,
        "MYSQL_PORT": expected.port,
        "MYSQL_DATABASE": expected.database,
    }
    mismatches = [
        f"{name}: actual={actual[name]!r}, expected={wanted[name]!r}"
        for name in wanted
        if actual[name] != wanted[name]
    ]
    if mismatches:
        raise ValueError("Alembic target mismatch: " + "; ".join(mismatches))
    return (
        f"APP_ENV={app_env} database={url.host}:{actual['MYSQL_PORT']}/{url.database} "
        f"user={url.username or '<unset>'}"
    )


def _applied_revisions(
    script: ScriptDirectory, current_heads: tuple[str, ...]
) -> set[str]:
    applied: set[str] = set()
    for current_head in current_heads:
        applied.update(
            revision.revision
            for revision in script.iterate_revisions(current_head, "base")
        )
    return applied


def validate_schema_revision_alignment(
    connection: Connection, script: ScriptDirectory
) -> tuple[str, ...]:
    """Reject known partial or manually stamped migrations before DDL."""
    current_heads = MigrationContext.configure(connection).get_current_heads()
    applied = _applied_revisions(script, current_heads)
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())
    drift: list[str] = []

    for revision, marker_tables in REVISION_TABLE_MARKERS.items():
        present = marker_tables & existing_tables
        missing = marker_tables - existing_tables
        if revision in applied and missing:
            drift.append(f"{revision} missing tables: {', '.join(sorted(missing))}")
        elif revision not in applied and present:
            drift.append(
                f"{revision} tables exist before revision: {', '.join(sorted(present))}"
            )

    for revision, table_markers in REVISION_COLUMN_MARKERS.items():
        for table_name, marker_columns in table_markers.items():
            if table_name not in existing_tables:
                if revision in applied:
                    drift.append(f"{revision} missing table: {table_name}")
                continue
            existing_columns = {
                column["name"] for column in inspector.get_columns(table_name)
            }
            present = marker_columns & existing_columns
            missing = marker_columns - existing_columns
            if revision in applied and missing:
                drift.append(
                    f"{revision} missing columns on {table_name}: "
                    f"{', '.join(sorted(missing))}"
                )
            elif revision not in applied and present:
                drift.append(
                    f"{revision} columns exist before revision on {table_name}: "
                    f"{', '.join(sorted(present))}"
                )

    for revision, table_markers in REVISION_REMOVED_COLUMN_MARKERS.items():
        for table_name, removed_columns in table_markers.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {
                column["name"] for column in inspector.get_columns(table_name)
            }
            present = removed_columns & existing_columns
            missing = removed_columns - existing_columns
            if revision in applied and present:
                drift.append(
                    f"{revision} removed columns still exist on {table_name}: "
                    f"{', '.join(sorted(present))}"
                )
            elif revision not in applied and missing:
                drift.append(
                    f"{revision} columns removed before revision on {table_name}: "
                    f"{', '.join(sorted(missing))}"
                )

    if drift:
        current = ",".join(current_heads) if current_heads else "base"
        raise RuntimeError(
            "Alembic schema drift detected before migration "
            f"(current={current}): {'; '.join(drift)}. "
            "Stop deployment and reconcile the schema with alembic_version; "
            "the release runner will not apply DDL to a drifted database."
        )
    return current_heads


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-app-env", required=True)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-port", required=True, type=int)
    parser.add_argument("--expected-database", required=True)
    args = parser.parse_args()

    settings = load_settings()
    expected = ExpectedTarget(
        app_env=args.expected_app_env,
        host=args.expected_host,
        port=args.expected_port,
        database=args.expected_database,
    )
    summary = validate_target(
        settings.sqlalchemy_url, settings.app_environment, expected
    )
    print(f"Alembic target verified: {summary}", flush=True)

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    script = ScriptDirectory.from_config(config)
    engine = create_engine(settings.sqlalchemy_url)
    try:
        with engine.connect() as connection:
            current_heads = validate_schema_revision_alignment(connection, script)
    finally:
        engine.dispose()
    current = ",".join(current_heads) if current_heads else "base"
    print(f"Alembic schema alignment verified: current={current}", flush=True)
    command.upgrade(config, "head")
    command.current(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
