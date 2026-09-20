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


REPO_ROOT = Path(__file__).resolve().parents[5]
SQL_PATH = REPO_ROOT / "apps/backend/migrations/sql/0064.up.sql"

EXPECTED_TEMPLATES = {
    "campus-professional-graduate-cn": "校招通用 · 成长型",
    "classic-social-general-cn": "社招通用 · 稳健专业",
    "classic-technical-frontend-cn": "前端工程师 · 技术单页",
    "modern-product-manager-cn": "产品经理 · 现代双栏",
    "creative-orange-new-media-cn": "新媒体运营 · 创意表达",
    "civic-service-finance-cn": "财务会计 · 清晰规范",
    "administrative-sidebar-hr-cn": "人力资源 · 行政双栏",
    "compact-data-analyst-cn": "数据分析师 · 紧凑信息",
}


def _payloads(up_sql: str) -> list[dict[str, object]]:
    encoded = re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", up_sql)
    return [json.loads(value.replace("''", "'")) for value in encoded]


def test_0064_seeds_guarded_canonical_role_templates() -> None:
    up_sql = SQL_PATH.read_text(encoding="utf-8")
    payloads = _payloads(up_sql)

    assert len(payloads) == len(EXPECTED_TEMPLATES) * 2
    assert "ON DUPLICATE KEY UPDATE" in up_sql
    assert "data_json = VALUES(data_json)" in up_sql
    assert "style_json = VALUES(style_json)" in up_sql

    documents = [
        CanonicalResumeDocument.model_validate(value) for value in payloads[0::2]
    ]
    definitions = [TemplateDefinition.model_validate(value) for value in payloads[1::2]]

    assert {definition.template_key for definition in definitions} == set(
        EXPECTED_TEMPLATES
    )
    for document, definition in zip(documents, definitions, strict=True):
        plan = compile_layout_plan(document, definition)
        assert plan.template_key == definition.template_key
        assert plan.content_sha256 == document.content_sha256()
        assert document.identity.name is not None
        assert document.identity.name.value == "张三"
        assert len(document.sections) == 5

    for key, name in EXPECTED_TEMPLATES.items():
        assert f"'{key}'" in up_sql
        assert f"'{name}'" in up_sql


def test_0064_keeps_the_pilot_batch_fictional_and_self_contained() -> None:
    up_sql = SQL_PATH.read_text(encoding="utf-8")

    assert "zhangsan@example.com" in up_sql
    assert "13800000000" in up_sql
    assert "http://" not in up_sql
    assert "https://" not in up_sql
    assert "<strong>" not in up_sql
    assert "<ul>" not in up_sql

    for rejected_source_value in (
        "UP简历",
        "upcv.tech",
        "阿里巴巴",
        "字节跳动",
        "腾讯科技",
        "北京大学",
        "清华大学",
    ):
        assert rejected_source_value not in up_sql


@pytest.mark.parametrize("revision", ["0065", "0066"])
def test_visual_templates_compile_with_full_content_coverage(revision: str) -> None:
    payloads = _payloads((SQL_PATH.parent / f"{revision}.up.sql").read_text(encoding="utf-8"))
    assert len(payloads) == 6
    for index in range(0, len(payloads), 2):
        document = CanonicalResumeDocument.model_validate(payloads[index])
        definition = TemplateDefinition.model_validate(payloads[index + 1])
        plan = compile_layout_plan(document, definition)
        assigned = [node.node_id for region in plan.regions for node in region.nodes]
        expected = [document.identity.node_id, *(section.node_id for section in document.sections)]
        assert sorted(assigned) == sorted(expected)
        if definition.template_key == "right-rail-cn":
            regions = {region.region_id: region for region in plan.regions}
            assert [node.node_id for node in regions["header"].nodes] == [document.identity.node_id]
            skills = next(section for section in document.sections if section.semantic_kind == "skills")
            assert [node.node_id for node in regions["sidebar"].nodes] == [skills.node_id]


def test_0067_refresh_is_bounded_and_preserves_layouts() -> None:
    sql = (SQL_PATH.parent / "0067.up.sql").read_text(encoding="utf-8")
    payloads = _payloads(sql)
    assert len(payloads) == 18
    assert sql.count("UPDATE resume_templates SET data_json") == 6
    assert sql.count("AND data_json =") == 6
    assert sql.count("AND style_json =") == 6
    for index in range(0, len(payloads), 3):
        new, old, style = payloads[index:index + 3]
        document = CanonicalResumeDocument.model_validate(new)
        template = TemplateDefinition.model_validate(style)
        plan = compile_layout_plan(document, template)
        assert len(plan.regions) == len(template.regions)
        assert new["identity"] == old["identity"]
        assert len(new["sections"]) == 5
        projects = next(s for s in new["sections"] if s["semantic_kind"] == "project")
        assert len(projects["entries"]) == (1 if template.template_key == "centered-portrait-cn" else 2)
        def text_size(value: object) -> int:
            if isinstance(value, list):
                return sum(text_size(item) for item in value)
            if isinstance(value, dict):
                return sum(len(v) if k in {"text", "value"} and isinstance(v, str) else text_size(v) for k, v in value.items())
            return 0
        assert text_size(old) < text_size(new) < 1100
