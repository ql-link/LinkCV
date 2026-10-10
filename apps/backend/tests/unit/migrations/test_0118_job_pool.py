import re
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from linkresume.core.migration_sql import sql_statements
from linkresume.modules.job_pool.models import GlobalJob, GlobalJobSource

BACKEND = Path(__file__).resolve().parents[3]
SQL = (BACKEND / "migrations/sql/0118.up.sql").read_text()


def test_additive_sql_matches_reviewed_orm_columns_and_indexes():
    statements = sql_statements(SQL)
    assert len(statements) == 5
    for model, size in [(GlobalJobSource, 14), (GlobalJob, 20)]:
        statement = next(item for item in statements if item.startswith("CREATE TABLE " + model.__tablename__ + " "))
        columns = set(re.findall(r"^\s+([a-z_]+)\s+(?:BIGINT|INTEGER|TINYINT|VARCHAR|LONGTEXT|DATETIME|JSON)\b", statement, re.M))
        assert columns == set(model.__table__.columns.keys()) and len(columns) == size
        names = {item.name for item in model.__table__.constraints if item.name} | {item.name for item in model.__table__.indexes}
        assert names <= set(re.findall(r"\b((?:pk|uk|idx|ck)_[a-z_]+)\b", SQL))
    assert "WITH PARSER ngram" in SQL
    assert "ADD COLUMN global_job_id BIGINT UNSIGNED NULL" in SQL
    assert "UNIQUE (user_id, global_job_id)" in SQL
    assert not any(word in SQL.upper() for word in ["DELETE FROM", "DROP TABLE", "INSERT INTO", "CREATE DATABASE"])


def test_revision_remains_forward_only_and_has_one_head():
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    scripts = ScriptDirectory.from_config(cfg)
    assert len(scripts.get_heads()) == 1
    revision = scripts.get_revision("0118")
    assert revision.down_revision == "0117"
    assert "raise RuntimeError" in Path(revision.path).read_text()
    assert not (BACKEND / "migrations/sql/0118.down.sql").exists()
