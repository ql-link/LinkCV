from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[5]
SQL_PATH = REPO_ROOT / "apps/backend/migrations/sql/0064.up.sql"
REVISION_PATH = (
    REPO_ROOT
    / "apps/backend/migrations/versions/0064_remove_agent_session_resume_binding.py"
)


def test_0064_backfills_message_context_before_removing_binding() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")
    revision = REVISION_PATH.read_text(encoding="utf-8")

    assert "UPDATE agent_messages AS message" in sql
    assert "'$.contexts'" in sql
    assert "JSON_EXTRACT(message.metadata_json, '$.contexts') IS NULL" in sql
    assert sql.index("UPDATE agent_messages AS message") < sql.index(
        "ALTER TABLE agent_sessions"
    )
    assert "ALTER TABLE agent_sessions" in sql
    assert "DROP INDEX idx_agent_sessions_resume_pinned_updated" in sql
    assert "DROP COLUMN resume_id" in sql
    assert "DROP TABLE" not in sql.upper()
    assert 'revision: str = "0064"' in revision
    assert 'down_revision: str | None = "0063"' in revision
    assert "forward-only" in revision
