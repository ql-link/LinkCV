from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from linkresume.core.migration_sql import sql_statements
from linkresume.modules.job_descriptions.models import GlobalCompany

BACKEND = Path(__file__).resolve().parents[3]


def test_company_migration_is_additive_forward_only_and_latest_head():
    sql = (BACKEND / "migrations/sql/0120.up.sql").read_text()
    assert len(sql_statements(sql)) == 1
    assert sql.startswith("ALTER TABLE global_company")
    for column in ("aliases", "logo_source", "lock_version"):
        assert f"ADD COLUMN {column}" in sql
        assert column in GlobalCompany.__table__.columns
    assert "JSON_ARRAY()" in sql and "BIGINT UNSIGNED" in sql
    assert "CREATE TABLE" not in sql and "INDEX" not in sql
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    scripts = ScriptDirectory.from_config(cfg)
    assert scripts.get_heads() == ["0120"]
    revision = scripts.get_revision("0120")
    assert revision.down_revision == "0119"
    assert "raise RuntimeError" in Path(revision.path).read_text()
