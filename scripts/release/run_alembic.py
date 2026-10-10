#!/usr/bin/env python3
"""Validate the deployment target before running DrawOffer Alembic migrations."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection, make_url

from drawoffer.core.config import load_settings

BACKEND_ROOT = Path(__file__).resolve().parents[2] / "apps" / "backend"

REVISION_TABLE_MARKERS = {
    # 0106 reconciles two published meanings of 0105. Before 0106, either
    # complete schema is accepted by its own guarded upgrade. After 0106,
    # both sets of markers must exist; never trust the version alone.
    "0106": frozenset({
        "account_preferences", "account_deletion_jobs", "job_application_offer_materials",
    }),
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
}
REVISION_COLUMN_MARKERS = {
    "0106": {
        "users": frozenset({"contact_email", "deletion_requested_at"}),
        "job_applications": frozenset({
            "offer_received_on", "offer_reply_due_on", "offer_start_on", "offer_probation",
        }),
        "interview_sessions": frozenset({
            "review_report", "review_request_id", "review_started_at", "review_status",
            "review_error",
        }),
    },
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
    "0052": {
        "agent_sessions": frozenset({"pinned"}),
    },
}
REVISION_REMOVED_COLUMN_MARKERS = {
    "0090": {"job_applications": frozenset({"resume_version_id"})},
    "0034": {
        "job_descriptions": frozenset({"archived_at"}),
    },
    "0065": {
        "agent_sessions": frozenset({"resume_id"}),
    },
}
REVISION_REMOVED_INDEX_MARKERS = {
    "0065": {
        "agent_sessions": frozenset({"idx_agent_sessions_resume_pinned_updated"}),
    },
}

# Markers above use the names each revision created. 0112 renamed yes/no columns to
# is_xxx and 0115 renamed tables (singular), created_at/updated_at and the indexes
# that embed a table name, so once those revisions are applied the markers are
# translated before they are compared with the live schema.
BOOLEAN_NAMING_REVISION = "0112"
BOOLEAN_COLUMN_RENAMES = {
    ("account_preferences", "interview_reminder_enabled"): "is_interview_reminder_enabled",
    ("agent_sessions", "pinned"): "is_pinned",
    ("interview_recording_transcriptions", "pending_replace"): "is_pending_replace",
    ("llm_model_routes", "enabled"): "is_enabled",
    ("llm_model_routes", "target_available"): "is_target_available",
    ("llm_models", "user_selectable"): "is_user_selectable",
    ("llm_provider_connections", "enabled"): "is_enabled",
    ("llm_use_case_routes", "enabled"): "is_enabled",
    ("mock_interviews", "follow_up_enabled"): "is_follow_up_enabled",
    ("mock_interviews", "low_confidence"): "is_low_confidence",
    ("mock_interviews", "materials_in_questions"): "is_materials_in_questions",
    ("resumes", "share_allow_download"): "is_share_allow_download",
}
SINGULAR_NAMING_REVISION = "0115"
SINGULAR_TABLE_NAMES = {
    "account_deletion_jobs": "account_deletion_job",
    "account_preferences": "account_preference",
    "agent_messages": "agent_message",
    "agent_operations": "agent_operation",
    "agent_runs": "agent_run",
    "agent_sessions": "agent_session",
    "agent_stage_events": "agent_stage_event",
    "agent_tool_calls": "agent_tool_call",
    "announcement_read_cursors": "announcement_read_cursor",
    "announcements": "announcement",
    "document_parse_tasks": "document_parse_task",
    "global_companies": "global_company",
    "interview_recording_transcriptions": "interview_recording_transcription",
    "interview_review_question_notes": "interview_review_question_note",
    "interview_sessions": "interview_session",
    "job_application_offer_materials": "job_application_offer_material",
    "job_application_stages": "job_application_stage",
    "job_applications": "job_application",
    "job_descriptions": "job_description",
    "job_resume_matches": "job_resume_match",
    "llm_call_logs": "llm_call_log",
    "llm_model_routes": "llm_model_route",
    "llm_models": "llm_model",
    "llm_provider_connections": "llm_provider_connection",
    "llm_use_case_routes": "llm_use_case_route",
    "mock_interview_questions": "mock_interview_question",
    "mock_interviews": "mock_interview",
    "product_events": "product_event",
    "resume_change_proposals": "resume_change_proposal",
    "resume_templates": "resume_template",
    "resumes": "resume",
    "user_dataset_folders": "user_dataset_folder",
    "user_profiles": "user_profile",
    "users": "user",
}
TIME_COLUMN_RENAMES = {"created_at": "create_time", "updated_at": "update_time"}


# Singularizing would give both tables the same schema-wide CHECK name.
RENAMED_OBJECT_OVERRIDES = {
    "ck_job_application_stages_type": "ck_job_application_stage_stage_type",
}


def _current_table(table: str, applied: set[str]) -> str:
    if SINGULAR_NAMING_REVISION in applied:
        return SINGULAR_TABLE_NAMES.get(table, table)
    return table


def _current_column(table: str, column: str, applied: set[str]) -> str:
    if BOOLEAN_NAMING_REVISION in applied:
        column = BOOLEAN_COLUMN_RENAMES.get((table, column), column)
    if SINGULAR_NAMING_REVISION in applied:
        column = TIME_COLUMN_RENAMES.get(column, column)
    return column


def _current_index(table: str, index: str, applied: set[str]) -> str:
    if SINGULAR_NAMING_REVISION not in applied or table not in SINGULAR_TABLE_NAMES:
        return index
    if index in RENAMED_OBJECT_OVERRIDES:
        return RENAMED_OBJECT_OVERRIDES[index]
    for prefix in ("pk_", "uk_", "idx_", "ck_"):
        head = prefix + table
        if index == head or index.startswith(head + "_"):
            return prefix + SINGULAR_TABLE_NAMES[table] + index[len(head):]
    return index


# 0051 repairs a profile table that may have been stamped past the actual
# 0045/0046 DDL.  Unlike ordinary removed-column markers, a complete target
# profile schema is a valid pre-0051 state: the migration itself will validate
# it and safely advance the revision without running DDL.
USER_PROFILE_REVISION = "0051"
USER_PROFILE_TARGET_COLUMNS = frozenset(
    {
        "candidate_cities",
        "employment_types",
        "candidate_status",
        "graduation_year",
    }
)
USER_PROFILE_LEGACY_COLUMNS = frozenset(
    {
        "work_city",
        "employment_type",
        "work_mode",
        "target_positions",
        "exclusions",
        "target_companies",
        "availability",
        "available_from",
        "birth_date",
    }
)
USER_PROFILE_INTERMEDIATE_COLUMNS = frozenset({"professional_directions"})
RETIREMENT_TABLES = {
    "dataset_replacements": "0089",
    "dataset_object_cleanup": "0089",
    "interview_assets": "0090",
    "llm_provider_models": "0093",
    "llm_providers": "0093",
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
    profile_table = _current_table("user_profiles", applied)

    if (
        USER_PROFILE_REVISION in applied
        and profile_table not in existing_tables
    ):
        drift.append("0051 missing table: user_profiles")
    elif "0050" in applied and profile_table not in existing_tables:
        drift.append("0051 missing table before revision: user_profiles")
    elif profile_table in existing_tables:
        profile_columns = {
            str(column["name"])
            for column in inspector.get_columns(profile_table)
        }
        target_present = USER_PROFILE_TARGET_COLUMNS & profile_columns
        legacy_present = USER_PROFILE_LEGACY_COLUMNS & profile_columns
        intermediate_present = USER_PROFILE_INTERMEDIATE_COLUMNS & profile_columns
        if USER_PROFILE_REVISION in applied:
            missing_target = USER_PROFILE_TARGET_COLUMNS - profile_columns
            legacy_remaining = USER_PROFILE_LEGACY_COLUMNS & profile_columns
            if missing_target:
                drift.append(
                    "0051 missing columns on user_profiles: "
                    + ", ".join(sorted(missing_target))
                )
            if legacy_remaining:
                drift.append(
                    "0051 removed columns still exist on user_profiles: "
                    + ", ".join(sorted(legacy_remaining))
                )
            if intermediate_present:
                drift.append(
                    "0051 intermediate columns still exist on user_profiles: "
                    + ", ".join(sorted(intermediate_present))
                )
        elif "0050" in applied and profile_columns:
            # Before 0051, only a complete legacy schema or a complete final
            # schema is a supported input.  The revision performs the deeper
            # check (types and constraints); this guard only rejects an
            # unmistakably partial/mixed marker before any later DDL.
            has_complete_target_marker = (
                target_present == USER_PROFILE_TARGET_COLUMNS
                and not legacy_present
                and not intermediate_present
            )
            has_complete_legacy_marker = (
                legacy_present == USER_PROFILE_LEGACY_COLUMNS
                and not target_present
                and not intermediate_present
            )
            if not has_complete_target_marker and not has_complete_legacy_marker:
                drift.append(
                    "0051 user_profiles schema is partial or mixed before revision"
                )

    if "0090" in applied:
        remaining = existing_tables & {"interview_assets", "resume_versions"}
        if remaining:
            drift.append("0090 retired tables still exist: " + ", ".join(sorted(remaining)))

    for revision, marker_tables in REVISION_TABLE_MARKERS.items():
        if "0090" in applied:
            marker_tables = marker_tables - {"interview_assets"}
        marker_tables = frozenset(_current_table(table, applied) for table in marker_tables)
        present = marker_tables & existing_tables
        missing = marker_tables - existing_tables
        if revision in applied and missing:
            drift.append(f"{revision} missing tables: {', '.join(sorted(missing))}")
        elif revision not in applied and present and revision != "0106":
            drift.append(
                f"{revision} tables exist before revision: {', '.join(sorted(present))}"
            )

    for revision, table_markers in REVISION_COLUMN_MARKERS.items():
        for marker_table, marker_columns in table_markers.items():
            table_name = _current_table(marker_table, applied)
            marker_columns = frozenset(
                _current_column(marker_table, column, applied) for column in marker_columns
            )
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
            elif revision not in applied and present and revision != "0106":
                drift.append(
                    f"{revision} columns exist before revision on {table_name}: "
                    f"{', '.join(sorted(present))}"
                )

    for revision, table_markers in REVISION_REMOVED_COLUMN_MARKERS.items():
        for marker_table, removed_columns in table_markers.items():
            table_name = _current_table(marker_table, applied)
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

    for revision, table_markers in REVISION_REMOVED_INDEX_MARKERS.items():
        for marker_table, removed_indexes in table_markers.items():
            table_name = _current_table(marker_table, applied)
            removed_indexes = frozenset(
                _current_index(marker_table, index, applied) for index in removed_indexes
            )
            if table_name not in existing_tables:
                continue
            existing_indexes = {
                str(index["name"])
                for index in inspector.get_indexes(table_name)
                if index.get("name") is not None
            }
            present = removed_indexes & existing_indexes
            missing = removed_indexes - existing_indexes
            if revision in applied and present:
                drift.append(
                    f"{revision} removed indexes still exist on {table_name}: "
                    f"{', '.join(sorted(present))}"
                )
            elif revision not in applied and missing:
                drift.append(
                    f"{revision} indexes removed before revision on {table_name}: "
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


def validate_pending_retirements(
    connection: Connection, script: ScriptDirectory, current_heads: tuple[str, ...]
) -> None:
    """Catch known data-retirement blockers before stopping the old services."""
    applied = _applied_revisions(script, current_heads)
    tables = set(inspect(connection).get_table_names())
    blocked = []
    for table, revision in RETIREMENT_TABLES.items():
        if revision in applied or table not in tables:
            continue
        count = connection.scalar(text(f"SELECT COUNT(*) FROM {table}"))
        if count:
            blocked.append(f"{table}={count} (before {revision})")
    if blocked:
        raise RuntimeError(
            "Legacy retirement data remains: " + ", ".join(blocked) + ". "
            "Run the documented maintenance procedure and back up the database "
            "before stopping the current services."
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-app-env", required=True)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-port", required=True, type=int)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--preflight-only", action="store_true")
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
            validate_pending_retirements(connection, script, current_heads)
    finally:
        engine.dispose()
    current = ",".join(current_heads) if current_heads else "base"
    print(f"Alembic schema alignment verified: current={current}", flush=True)
    if args.preflight_only:
        print("Alembic preflight complete; no DDL applied", flush=True)
        return 0
    command.upgrade(config, "head")
    command.current(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
