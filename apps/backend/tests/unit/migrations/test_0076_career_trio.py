from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from linkresume.domain.resume import CanonicalResumeDocument, TemplateDefinition, compile_layout_plan

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0076.up.sql").read_text(encoding="utf-8")
VALUES = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)]
TEMPLATES = VALUES[1::2]


def test_trio_is_append_only_and_contains_complete_careers() -> None:
    assert {t["template_key"] for t in TEMPLATES} == {
        "original-offset-cn", "original-marginal-cn", "original-hanging-cn",
    }
    assert "UPDATE resumes" not in SQL
    assert "UPDATE resume_versions" not in SQL
    assert ", is_active, NULL)" in SQL
    for raw in VALUES[::2]:
        document = CanonicalResumeDocument.model_validate(raw)
        assert document.identity.name.value == "张三"
        assert {s.semantic_kind for s in document.sections} == {"profile", "work", "project", "education", "skills"}
        work = next(s for s in document.sections if s.semantic_kind == "work")
        assert len(work.entries) == 2
        assert all(len(e.blocks[-1].items) == 3 for e in work.entries)


@pytest.mark.parametrize("raw_template", TEMPLATES, ids=[t["template_key"] for t in TEMPLATES])
def test_trio_covers_renamed_and_optional_sections_without_loss(raw_template: dict) -> None:
    template = TemplateDefinition.model_validate(raw_template)
    for revision in ("0073", "0074", "0075", "0076"):
        sql = (ROOT / f"apps/backend/migrations/sql/{revision}.up.sql").read_text(encoding="utf-8")
        values = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", sql)]
        for raw in values[::2]:
            raw["sections"].append({
                "node_id": "node_careertrioextra000001", "source_refs": [], "semantic_kind": "custom",
                "title": {"node_id": "node_careertrioextra000002", "value": "开源贡献", "source_refs": []},
                "title_icon": None, "entries": [], "blocks": [],
            })
            for section in raw["sections"]:
                section["title"]["value"] = "可编辑章节标题"
            document = CanonicalResumeDocument.model_validate(raw)
            plan = compile_layout_plan(document, template)
            assigned = [n.node_id for r in plan.regions for n in r.nodes]
            assert sorted(assigned) == sorted([document.identity.node_id, *(s.node_id for s in document.sections)])
            mapping = {n.semantic_kind: r.region_id for r in plan.regions for n in r.nodes}
            assert mapping["custom"] == "additional"
            if template.template_key == "original-marginal-cn":
                assert mapping["work"] == "main"
                assert mapping["skills"] == mapping["profile"] == "sidebar"
                assert mapping["project"] == "projects"
                assert mapping["education"] == "education"
            else:
                assert mapping["work"] == mapping["profile"] == mapping["project"] == "header"
                assert mapping["education"] == "main"
                assert mapping["skills"] == "sidebar"
