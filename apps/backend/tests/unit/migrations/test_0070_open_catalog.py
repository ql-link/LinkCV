from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from linkresume.domain.resume import CanonicalResumeDocument, TemplateDefinition, compile_layout_plan

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0070.up.sql").read_text(encoding="utf-8")
PAYLOADS = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)]
SAMPLES = list(zip(PAYLOADS[::2], PAYLOADS[1::2], strict=True))


def test_every_adapted_template_ships_pinned_source_and_full_license() -> None:
    notices = (ROOT / "apps/web/public/third-party/template-notices.txt").read_text(encoding="utf-8")
    for _, definition in SAMPLES:
        assert definition["template_key"] in notices
    assert len(re.findall(r"Source: https://github.com/[^\s]+/tree/[0-9a-f]{40}", notices)) == 6
    assert notices.count("Permission is hereby granted, free of charge") == 6
    assert notices.count('THE SOFTWARE IS PROVIDED "AS IS"') == 6


def test_six_new_templates_are_registered_and_insert_only() -> None:
    registry = (ROOT / "apps/web/src/api/openThemes.ts").read_text(encoding="utf-8")
    keys = {t["template_key"] for _, t in SAMPLES}
    assert len(SAMPLES) == len(keys) == 6
    assert keys == {f"{key}-cn" for key in re.findall(r'"(open-[a-z-]+)"', registry)}
    assert "UPDATE resumes" not in SQL
    assert "UPDATE resume_versions" not in SQL
    assert ", is_active, NULL)" in SQL  # Preserve disabled rows; reject incompatible stable keys.
    assert "https://" not in SQL


@pytest.mark.parametrize("raw,definition", SAMPLES, ids=[t["template_key"] for _, t in SAMPLES])
def test_samples_have_substance_and_can_switch_without_dropping_nodes(raw: dict, definition: dict) -> None:
    document = CanonicalResumeDocument.model_validate(raw)
    template = TemplateDefinition.model_validate(definition)
    assert document.identity.name.value == "张三"
    sections = {s.semantic_kind: s for s in document.sections}
    assert len(sections["work"].entries) == 2
    assert len(sections["project"].entries) == 1
    assert len(sections["skills"].entries) == 3
    assert len(sections["project"].entries[0].blocks[1].items) == 3
    assert template.tokens.font_size_pt >= 10
    for other, _ in SAMPLES:
        candidate = CanonicalResumeDocument.model_validate(other)
        plan = compile_layout_plan(candidate, template)
        assigned = [node.node_id for region in plan.regions for node in region.nodes]
        assert sorted(assigned) == sorted([candidate.identity.node_id, *(s.node_id for s in candidate.sections)])
