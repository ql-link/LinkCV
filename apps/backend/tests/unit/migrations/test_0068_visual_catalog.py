from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from linkresume.domain.resume import (
    CanonicalResumeDocument,
    TemplateDefinition,
    compile_layout_plan,
)

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0068.up.sql").read_text(encoding="utf-8")
PAYLOADS = [json.loads(value.replace("''", "'")) for value in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)]
TEMPLATES = list(zip(PAYLOADS[0::2], PAYLOADS[1::2], strict=True))


def test_catalog_has_37_registered_unique_templates() -> None:
    registry = (ROOT / "apps/web/src/api/atlasThemes.ts").read_text(encoding="utf-8")
    registered = set(re.findall(r'"(atlas-[a-z-]+)"', registry))
    keys = [definition["template_key"] for _, definition in TEMPLATES]
    assert len(keys) == len(set(keys)) == 37
    assert set(keys) == {f"{theme}-cn" for theme in registered}
    assert "ON DUPLICATE KEY UPDATE" in SQL
    assert "style_json = VALUES(style_json)" in SQL
    assert "https://" not in SQL
    assert "UPDATE resumes" not in SQL
    assert "UPDATE resume_versions" not in SQL


@pytest.mark.parametrize("raw,definition", TEMPLATES, ids=[s["template_key"] for _, s in TEMPLATES])
def test_catalog_preserves_every_node_and_accepts_other_content(raw: dict, definition: dict) -> None:
    document = CanonicalResumeDocument.model_validate(raw)
    template = TemplateDefinition.model_validate(definition)
    # Switching to any new layout must also carry the other sample families.
    for candidate in (document, *(CanonicalResumeDocument.model_validate(d) for d, _ in TEMPLATES[::12])):
        plan = compile_layout_plan(candidate, template)
        assigned = [node.node_id for region in plan.regions for node in region.nodes]
        assert sorted(assigned) == sorted([candidate.identity.node_id, *(s.node_id for s in candidate.sections)])
        assert plan.content_sha256 == candidate.content_sha256()
    assert document.identity.name.value == "张三"
    assert len(document.sections) == 5
    assert template.tokens.font_size_pt >= 10
    assert template.tokens.page_margin_mm >= 14
