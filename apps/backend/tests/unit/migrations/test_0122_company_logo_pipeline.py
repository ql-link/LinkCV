from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from linkresume.core.migration_sql import sql_statements
from linkresume.modules.job_descriptions.models import (
    GlobalCompany,
    GlobalCompanyLogoFingerprint,
    GlobalCompanyUnmatchedName,
)

BACKEND = Path(__file__).resolve().parents[3]


def test_logo_pipeline_migration_matches_models_and_is_latest_forward_only_head():
    sql = (BACKEND / "migrations/sql/0122.up.sql").read_text()
    statements = sql_statements(sql)
    assert len(statements) == 6
    assert "ADD COLUMN logo_dhash CHAR(16)" in sql and "logo_dhash" in GlobalCompany.__table__.columns
    assert "global_company_logo_observation" not in sql
    # Only plugin external defaults are cleared; admin and official addresses stay.
    assert "WHERE logo_source = 'plugin' AND logo_url LIKE 'https://%'" in sql
    for model in (GlobalCompanyLogoFingerprint, GlobalCompanyUnmatchedName):
        table = model.__table__
        assert f"CREATE TABLE {table.name} (" in sql
        for column in table.columns:
            assert f"\t{column.name} " in sql, column.name
        for index in table.indexes:
            assert index.name in sql
    assert "FOREIGN KEY" not in sql and "DROP " not in sql
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    scripts = ScriptDirectory.from_config(cfg)
    assert scripts.get_heads() == ["0122"]
    revision = scripts.get_revision("0122")
    assert revision.down_revision == "0121"
    assert "raise RuntimeError" in Path(revision.path).read_text()
