"""Complete accounts after the earlier Offer migration; reconcile legacy 0105."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import inspect

from drawoffer.core.migration_sql import execute_sql_file

revision: str = "0106"
down_revision: str | None = "0105"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"

# Two independent branches used 0105. Existing databases can contain either
# group or both. Validate both groups before DDL; never rerun an existing group
# (in particular, do not overwrite users.contact_email with the login email).
OFFER_COLUMNS = {
    "job_applications": {
        "offer_received_on", "offer_reply_due_on", "offer_start_on", "offer_probation",
    },
    "interview_sessions": {
        "review_report", "review_request_id", "review_started_at", "review_status",
        "review_error",
    },
}
OFFER_TABLES = {
    "job_application_offer_materials": {"application_id", "dataset_id"},
}
ACCOUNT_COLUMNS = {"users": {"contact_email", "deletion_requested_at"}}
ACCOUNT_TABLES = {
    "account_preferences": {
        "user_id", "locale", "interview_reminder_enabled", "created_at", "updated_at",
    },
    "account_deletion_jobs": {
        "id", "public_id", "user_id", "status", "phase", "cleanup_manifest",
        "receipt_hash", "attempt_count", "last_error_code", "next_attempt_at",
        "lease_until", "created_at", "updated_at", "completed_at",
    },
}


def _group_present(inspector, name, columns, tables) -> bool:
    existing_tables = set(inspector.get_table_names())
    markers = []
    for table, expected in columns.items():
        if table not in existing_tables:
            raise RuntimeError(f"0106 missing prerequisite table: {table}")
        actual = {column["name"] for column in inspector.get_columns(table)}
        markers.extend(column in actual for column in expected)
    for table, expected in tables.items():
        exists = table in existing_tables
        markers.append(exists)
        if exists:
            actual = {column["name"] for column in inspector.get_columns(table)}
            if actual != expected:
                raise RuntimeError(f"0106 incompatible {name} table: {table}")
    if any(markers) and not all(markers):
        raise RuntimeError(f"0106 partial {name} schema; reconcile before migration")
    return all(markers)


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    offer_present = _group_present(inspector, "Offer", OFFER_COLUMNS, OFFER_TABLES)
    account_present = _group_present(inspector, "account", ACCOUNT_COLUMNS, ACCOUNT_TABLES)
    if not offer_present:
        execute_sql_file(connection, SQL_DIR / "0105.up.sql")
    if not account_present:
        execute_sql_file(connection, SQL_DIR / "0106.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
