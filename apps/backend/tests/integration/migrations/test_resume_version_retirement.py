"""Execute the migration data mapping in SQLite, not a MySQL DDL proof."""
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.resumes.models import Resume, ResumeVersion
from tests.integration.api.test_interviews import build_app, register, create_job, create_resume, create_application

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0084.up.sql").read_text()
MAPPING = SQL[SQL.index("UPDATE job_applications"):]


@pytest.mark.parametrize("foreign_owner", [False, True])
def test_mapping_resolves_owned_parent_without_changing_history_or_new_links(foreign_owner):
    app = build_app()
    with TestClient(app) as client, TestClient(app) as other:
        register(client, "migration-first@example.test")
        register(other, "migration-second@example.test")
        source = create_resume(other if foreign_owner else client, app)
        alternate = create_resume(client, app, "另一份简历")
        application = create_application(client, create_job(client, "虚构迁移公司"))
    with app.state.session_factory() as db:
        row = db.get(Resume, int(source["id"]))
        legacy = ResumeVersion(resume_id=row.id, template_id=row.template_id, version_no=4,
                               name="旧名称", reason="manual", data_json=deepcopy(row.data_json),
                               style_json=deepcopy(row.style_json))
        db.add(legacy)
        db.flush()
        target = db.get(JobApplication, int(application["id"]))
        target.resume_version_id = legacy.id
        db.commit()
        db.execute(text(MAPPING))
        db.commit()
        db.refresh(target)
        assert target.resume_id == (None if foreign_owner else row.id)
        assert target.resume_version_id == legacy.id
        assert db.get(ResumeVersion, legacy.id) is not None
        target.resume_id = int(alternate["id"])
        db.commit()
        db.execute(text(MAPPING))
        db.commit()
        db.refresh(target)
        assert target.resume_id == int(alternate["id"])


def test_migration_only_expands_storage_without_snapshot_table_or_history_deletion():
    assert "DROP " not in SQL.upper()
    assert "application_resume_snapshots" not in SQL
    assert "ADD COLUMN resume_id BIGINT UNSIGNED NULL" in SQL
    assert "ON DELETE SET NULL" in SQL
    assert "creation_request_hash CHAR(64)" in SQL
    assert "MODIFY COLUMN proposed_data_json JSON NULL" in SQL
