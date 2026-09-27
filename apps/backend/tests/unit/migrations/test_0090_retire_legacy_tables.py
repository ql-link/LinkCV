"""Preflight behavior; MySQL DDL is exercised separately in integration tests."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect, text
from linkresume.core.database import Base
import linkresume.models  # noqa: F401

ROOT = Path(__file__).resolve().parents[5]
spec = importlib.util.spec_from_file_location("retire_0090", next((ROOT / "apps/backend/migrations/versions").glob("0090_*.py")))
revision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(revision)

@pytest.mark.parametrize("has_rows", [True, False])
def test_upgrade_requires_migrated_assets_before_any_ddl(monkeypatch, has_rows):
    engine = create_engine("sqlite://")
    executed = []
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE interview_assets (id INTEGER PRIMARY KEY)"))
        if has_rows:
            connection.execute(text("INSERT INTO interview_assets VALUES (1)"))
        monkeypatch.setattr(revision, "op", SimpleNamespace(get_bind=lambda: connection))
        monkeypatch.setattr(revision, "execute_sql_file", lambda conn, path: executed.append(path.name))
        if has_rows:
            with pytest.raises(RuntimeError, match="Migrate interview assets"):
                revision.upgrade()
            assert executed == []
            assert connection.scalar(text("SELECT COUNT(*) FROM interview_assets")) == 1
        else:
            revision.upgrade()
            assert executed == ["0090.up.sql"]
    engine.dispose()


def test_runtime_metadata_has_no_retired_tables_or_foreign_keys():
    assert {"resume_versions", "interview_assets"}.isdisjoint(Base.metadata.tables)
    assert "resume_version_id" not in Base.metadata.tables["job_applications"].c
    assert not any(fk.target_fullname.startswith(("resume_versions.", "interview_assets."))
                   for table in Base.metadata.tables.values() for fk in table.foreign_keys)


def test_downgrade_requires_backup():
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()
