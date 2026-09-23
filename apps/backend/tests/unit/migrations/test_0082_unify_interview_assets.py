from __future__ import annotations

import importlib.util
from pathlib import Path

from linkresume.modules.datasets.models import UserDataset

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "apps/backend"
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations/versions/0082_unify_interview_assets_into_user_dataset.py"
)
SQL_PATH = BACKEND_ROOT / "migrations/sql/0082.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkresume_revision_0082", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0082_is_forward_only_sql_first_and_mysql_compatible() -> None:
    revision = load_revision()
    sql = SQL_PATH.read_text(encoding="utf-8")
    model_constraint_names = {
        constraint.name for constraint in UserDataset.__table__.constraints
    }

    assert revision.revision == "0082"
    assert revision.down_revision == "0081"
    assert '"0082.up.sql"' in REVISION_PATH.read_text(encoding="utf-8")
    assert "FOREIGN KEY (interview_session_id)" in sql
    assert "ON DELETE SET NULL" in sql
    assert "ck_user_dataset_interview_source" not in sql
    assert "ck_user_dataset_interview_source" not in model_constraint_names
    assert not SQL_PATH.with_name("0082.down.sql").exists()
