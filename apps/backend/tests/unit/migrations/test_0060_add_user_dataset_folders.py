from __future__ import annotations

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "apps/backend"
REVISION_PATH = BACKEND_ROOT / "migrations/versions/0060_add_user_dataset_folders.py"
SQL_PATH = BACKEND_ROOT / "migrations/sql/0060.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0060", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_user_dataset_folders_revision_is_forward_only_and_sql_first() -> None:
    revision = load_revision()
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert revision.revision == "0060"
    assert revision.down_revision == "0059"
    assert '"0060.up.sql"' in REVISION_PATH.read_text(encoding="utf-8")
    assert "CREATE TABLE user_dataset_folders" in sql
    assert "ADD COLUMN folder_id BIGINT UNSIGNED NULL" in sql
    assert "fk_user_dataset_folder" in sql
    assert "idx_user_dataset_user_folder" in sql
    assert not SQL_PATH.with_name("0060.down.sql").exists()
