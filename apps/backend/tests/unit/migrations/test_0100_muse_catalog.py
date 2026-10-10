from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from drawoffer.domain.resume import (
    CanonicalResumeDocument,
    TemplateDefinition,
    compile_layout_plan,
)

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0100.up.sql").read_text(encoding="utf-8")
SAMPLES = {
    key: json.loads(value.replace("''", "'"))
    for key, value in re.findall(
        r"SET @muse_sample_(\w+) = CAST\('((?:[^']|'')*)' AS JSON\)", SQL
    )
}
CATALOG = [
    (key, SAMPLES[sample], json.loads(definition.replace("''", "'")))
    for key, sample, definition in re.findall(
        r"VALUES \('(muse-[a-z]+-cn)', '(?:[^']|'')*', '(?:[^']|'')*', "
        r"@muse_sample_(\w+), CAST\('((?:[^']|'')*)' AS JSON\)", SQL
    )
]


def test_catalog_has_exactly_79_registered_unique_keys_and_frozen_samples() -> None:
    registry = (ROOT / "apps/web/src/api/museThemes.ts").read_text(encoding="utf-8")
    registered = set(re.findall(r'theme: "(muse-[a-z]+)"', registry))
    keys = [key for key, _, _ in CATALOG]
    assert len(keys) == len(set(keys)) == 79
    assert set(keys) == {f"{theme}-cn" for theme in registered}
    assert len(SAMPLES) == 12
    assert sum(raw is SAMPLES["general"] for _, raw, _ in CATALOG) == 58
    assert SQL.count("ON DUPLICATE KEY UPDATE") == 79
    assert SQL.count("resume_templates.is_active,\n    NULL") == 79
    assert "UPDATE resumes" not in SQL
    assert "UPDATE resume_versions" not in SQL
    assert "https://" not in SQL
    assert "sort_order = VALUES" not in SQL
    assert "style_labels = VALUES" not in SQL


@pytest.mark.parametrize("key,raw,definition", CATALOG, ids=[key for key, _, _ in CATALOG])
def test_catalog_routes_every_node_without_changing_any_content(
    key: str, raw: dict, definition: dict
) -> None:
    template = TemplateDefinition.model_validate(definition)
    assert template.template_key == key
    assert template.tokens.font_size_pt >= 10
    assert template.avatar.fallback_asset in {"system-default", "none"}
    for source in (raw, *SAMPLES.values()):
        document = CanonicalResumeDocument.model_validate(source)
        before = document.model_dump(mode="json")
        plan = compile_layout_plan(document, template)
        assigned = [node.node_id for region in plan.regions for node in region.nodes]
        assert len(assigned) == len(set(assigned))
        assert set(assigned) == document.layout_node_ids()
        assert plan.content_sha256 == document.content_sha256()
        assert document.model_dump(mode="json") == before
        fallback = next(slot for slot in template.slots if slot.universal_fallback)
        assert "custom" in fallback.accepts


def test_industry_samples_keep_cases_projects_and_papers_as_editable_text() -> None:
    for industry, expected in {
        "A": "滨江社区文化中心",
        "L": "某科技公司股权回购纠纷仲裁案",
        "M": "Remote follow-up management",
        "E": "教学 · 教研 · 育人",
        "X": "选择性 JAK1 抑制剂先导优化",
        "P": "《海上灯塔》",
    }.items():
        content = json.dumps(SAMPLES[industry], ensure_ascii=False)
        assert expected in content
        assert "undefined" not in content
        assert "[object Object]" not in content
        assert "<i>" not in content
