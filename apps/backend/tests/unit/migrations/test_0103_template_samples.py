from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

from linkresume.core.migration_sql import sql_statements
from linkresume.domain.resume import CanonicalResumeDocument, TemplateDefinition, compile_layout_plan

ROOT = Path(__file__).resolve().parents[5]
SQL = ROOT / "apps/backend/migrations/sql/0103.up.sql"
PATTERN = re.compile(
    r"UPDATE resume_templates SET data_json = CAST\('((?:[^']|'')*)' AS JSON\)\s+"
    r"WHERE `key` = '([^']+)' AND data_json = CAST\('((?:[^']|'')*)' AS JSON\)\s+"
    r"AND style_json = CAST\('((?:[^']|'')*)' AS JSON\)"
)


def decode(value: str) -> dict:
    return json.loads(value.replace("''", "'").replace("\\\\", "\\"))


UPDATES = [(key, decode(old), decode(new), decode(style))
           for new, key, old, style in PATTERN.findall(SQL.read_text(encoding="utf-8"))]


def test_refresh_matches_only_eleven_complete_known_muse_seeds() -> None:
    statements = sql_statements(SQL.read_text(encoding="utf-8"))
    assert len(statements) == len(UPDATES) == 11
    assert all(PATTERN.fullmatch(statement) for statement in statements)
    assert {key for key, *_ in UPDATES} == {
        "muse-code-cn", "muse-hairline-cn",
        "muse-numerals-cn", "muse-chronicle-cn", "muse-tabs-cn", "muse-drawinglist-cn",
        "muse-dealbook-cn", "muse-memorandum-cn", "muse-clinicalpath-cn", "muse-element-cn",
        "muse-rededitorial-cn",
    }


@pytest.mark.parametrize("key,old,new,style", UPDATES, ids=[row[0] for row in UPDATES])
def test_compact_samples_keep_valid_sections_and_complete_layout_coverage(key, old, new, style):
    document = CanonicalResumeDocument.model_validate(new)
    original = CanonicalResumeDocument.model_validate(old)
    definition = TemplateDefinition.model_validate(style)
    assert definition.template_key == key
    assert document.document_id == original.document_id
    assert document.identity.name.value == "张三"
    assert len(json.dumps(new, ensure_ascii=False)) < len(json.dumps(old, ensure_ascii=False))
    expected = {s.node_id for s in original.sections}
    if key == "muse-dealbook-cn":
        # A duplicate set of transaction metrics is merged into 关键数据.
        expected.remove(next(s.node_id for s in original.sections if s.title.value == "核心数据"))
    assert {s.node_id for s in document.sections} == expected
    assert all(s.entries or s.blocks for s in document.sections)
    plan = compile_layout_plan(document, definition)
    assigned = [n.node_id for region in plan.regions for n in region.nodes]
    assert len(assigned) == len(set(assigned))
    assert set(assigned) == document.layout_node_ids()
    assert plan.content_sha256 == document.content_sha256()


def test_revision_is_sql_first_forward_only_and_extends_0102() -> None:
    path = next((ROOT / "apps/backend/migrations/versions").glob("0103_*.py"))
    spec = importlib.util.spec_from_file_location("compact_samples", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "0103" and module.down_revision == "0102"
    assert not SQL.with_name("0103.down.sql").exists()
    with pytest.raises(RuntimeError, match="forward-only"):
        module.downgrade()
