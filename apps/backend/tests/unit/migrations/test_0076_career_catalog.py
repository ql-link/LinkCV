from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from linkresume.domain.resume import CanonicalResumeDocument, TemplateDefinition, compile_layout_plan

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0076.up.sql").read_text(encoding="utf-8")
VALUES = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)]
SAMPLES = list(zip(VALUES[::2], VALUES[1::2], strict=True))


def test_career_catalog_is_insert_only_registered_and_licensed() -> None:
    registry = (ROOT / "apps/web/src/api/careerThemes.ts").read_text(encoding="utf-8")
    notices = (ROOT / "apps/web/public/third-party/template-notices.txt").read_text(encoding="utf-8")
    keys = {t["template_key"] for _, t in SAMPLES}
    assert len(keys) == len(SAMPLES) == 5
    assert keys == {f"{key}-cn" for key in re.findall(r'"(career-[a-z-]+)"', registry)}
    assert all(key in notices for key in keys)
    assert "UPDATE resumes" not in SQL and "UPDATE resume_versions" not in SQL
    assert ", is_active, NULL)" in SQL


@pytest.mark.parametrize("raw,definition", SAMPLES, ids=[t["template_key"] for _, t in SAMPLES])
def test_career_samples_cover_stage_and_keep_all_sections(raw: dict, definition: dict) -> None:
    document = CanonicalResumeDocument.model_validate(raw)
    template = TemplateDefinition.model_validate(definition)
    assert document.identity.name.value == "张三"
    assert 5 <= len(document.sections) <= 6
    kinds = {s.semantic_kind for s in document.sections}
    assert {"profile", "education", "skills"} <= kinds
    assert 10 <= template.tokens.font_size_pt <= 12
    if definition["template_key"] in {"career-spartan-cn", "career-onepage-cn"}:
        assert "校招" in document.identity.headline.value
        assert {"work", "activity"} <= kinds
        assert "（预计）" in json.dumps(raw, ensure_ascii=False)
    elif definition["template_key"] == "career-classic-cn":
        assert "实习生" in document.identity.headline.value
        assert "work" not in kinds  # No invented full-time employment.
        assert {"project", "activity"} <= kinds
        assert "每周可到岗 4 天" in json.dumps(raw, ensure_ascii=False)
    else:
        assert "社招" in document.identity.headline.value
        assert len(next(s for s in document.sections if s.semantic_kind == "work").entries) == 2
    for other, _ in SAMPLES:
        candidate = json.loads(json.dumps(other))
        candidate["sections"].append({
            "node_id": "node_careerextra00000001", "source_refs": [], "semantic_kind": "custom",
            "title": {"node_id": "node_careerextra00000002", "source_refs": [], "value": "补充经历"},
            "title_icon": None, "entries": [], "blocks": [],
        })
        for section in candidate["sections"]:
            section["title"]["value"] = "自定义标题"
        source = CanonicalResumeDocument.model_validate(candidate)
        plan = compile_layout_plan(source, template)
        assert sorted(n.node_id for r in plan.regions for n in r.nodes) == sorted(
            [source.identity.node_id, *(s.node_id for s in source.sections)]
        )
