from __future__ import annotations

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "apps/backend"
REVISION_PATH = BACKEND_ROOT / "migrations/versions/0052_add_agent_session_pinning.py"
SQL_PATH = BACKEND_ROOT / "migrations/sql/0052.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0052", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_agent_session_pinning_revision_is_forward_only_and_sql_first() -> None:
    revision = load_revision()
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert revision.revision == "0052"
    assert revision.down_revision == "0051"
    assert '"0052.up.sql"' in REVISION_PATH.read_text(encoding="utf-8")
    assert "ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE" in sql
    assert "COMMENT '是否置顶'" in sql
    assert "idx_agent_sessions_user_pinned_updated" in sql
    assert "idx_agent_sessions_resume_pinned_updated" in sql
    assert not SQL_PATH.with_name("0052.down.sql").exists()
