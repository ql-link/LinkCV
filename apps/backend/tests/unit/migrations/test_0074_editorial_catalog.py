from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from linkresume.domain.resume import CanonicalResumeDocument, TemplateDefinition, compile_layout_plan

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0074.up.sql").read_text(encoding="utf-8")
PAYLOADS = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)]
SAMPLES = list(zip(PAYLOADS[::2], PAYLOADS[1::2], strict=True))


def test_only_two_approved_originals_are_appended() -> None:
    assert {t["template_key"] for _, t in SAMPLES} == {"original-axis-cn", "original-warm-cn"}
    assert "UPDATE resumes" not in SQL
    assert "UPDATE resume_versions" not in SQL
    assert ", is_active, NULL)" in SQL


@pytest.mark.parametrize("raw,definition", SAMPLES, ids=[t["template_key"] for _, t in SAMPLES])
def test_editorial_samples_and_cross_template_coverage(raw: dict, definition: dict) -> None:
    document = CanonicalResumeDocument.model_validate(raw)
    template = TemplateDefinition.model_validate(definition)
    sections = {s.semantic_kind: s for s in document.sections}
    assert document.identity.name.value == "张三"
    assert len(sections["work"].entries) == 2
    assert len(sections["project"].entries) == 1
    assert len(sections["skills"].entries) == 3
    assert template.tokens.font_size_pt >= 10.5
    for revision in ("0073", "0074"):
        sql = (ROOT / f"apps/backend/migrations/sql/{revision}.up.sql").read_text(encoding="utf-8")
        values = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", sql)]
        for other in values[::2]:
            candidate = CanonicalResumeDocument.model_validate(other)
            plan = compile_layout_plan(candidate, template)
            assigned = [node.node_id for region in plan.regions for node in region.nodes]
            assert sorted(assigned) == sorted([candidate.identity.node_id, *(s.node_id for s in candidate.sections)])
    plan = compile_layout_plan(document, template)
    mapping = {node.semantic_kind: region.region_id for region in plan.regions for node in region.nodes}
    assert mapping["work"] == mapping["project"] == "header"
    assert mapping["education"] == "sidebar"
    assert mapping["skills"] == "main"
