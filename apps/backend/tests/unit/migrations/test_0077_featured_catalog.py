from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from linkresume.domain.resume import CanonicalResumeDocument, TemplateDefinition, compile_layout_plan

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0077.up.sql").read_text(encoding="utf-8")
VALUES = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)]
SAMPLES = list(zip(VALUES[::2], VALUES[1::2], strict=True))


def test_featured_catalog_is_insert_only_and_registered() -> None:
    registry = (ROOT / "apps/web/src/api/featuredThemes.ts").read_text(encoding="utf-8")
    keys = {t["template_key"] for _, t in SAMPLES}
    assert len(keys) == len(SAMPLES) == 7
    registered = {f"{key}-cn" for key in re.findall(r'"(featured-[a-z-]+)"', registry)}
    assert keys == registered - {
        "featured-card-dashed-cn",
        "featured-card-rail-cn",
        "featured-classic-business-cn",
        "featured-vitality-cn",
    }
    assert "UPDATE resumes" not in SQL and "UPDATE resume_versions" not in SQL
    assert ", is_active, NULL)" in SQL
    assert "https://" not in SQL  # No upstream portraits or remote resources.


@pytest.mark.parametrize("raw,definition", SAMPLES, ids=[t["template_key"] for _, t in SAMPLES])
def test_featured_samples_and_cross_template_switch_preserve_content(raw: dict, definition: dict) -> None:
    document = CanonicalResumeDocument.model_validate(raw)
    template = TemplateDefinition.model_validate(definition)
    assert document.identity.name.value == "张三"
    assert len(document.sections) >= 5
    assert template.avatar.visibility == "show"
    for other, _ in SAMPLES:
        candidate = json.loads(json.dumps(other))
        candidate["sections"].append({
            "node_id": "node_featuredextra00000001", "source_refs": [], "semantic_kind": "custom",
            "title": {"node_id": "node_featuredextra00000002", "source_refs": [], "value": "补充经历"},
            "title_icon": None, "entries": [], "blocks": [],
        })
        for section in candidate["sections"]:
            section["title"]["value"] = "自定义标题"
        source = CanonicalResumeDocument.model_validate(candidate)
        plan = compile_layout_plan(source, template)
        assert sorted(n.node_id for r in plan.regions for n in r.nodes) == sorted(
            [source.identity.node_id, *(s.node_id for s in source.sections)]
        )
