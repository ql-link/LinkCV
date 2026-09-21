from __future__ import annotations

import json
import re
from pathlib import Path

from linkresume.domain.resume import TemplateDefinition

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0079.up.sql").read_text(encoding="utf-8")
DEFINITIONS = [
    TemplateDefinition.model_validate(json.loads(value.replace("''", "'")))
    for value in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)
]


def test_new_visual_catalog_reuses_fictional_content_and_registers_both_layouts() -> None:
    registry = (ROOT / "apps/web/src/api/featuredThemes.ts").read_text(encoding="utf-8")
    keys = {definition.template_key for definition in DEFINITIONS}
    assert keys == {"featured-classic-business-cn", "featured-vitality-cn"}
    assert keys <= {f"{key}-cn" for key in re.findall(r'"(featured-[a-z-]+)"', registry)}
    assert SQL.count("WHERE source.`key` = 'featured-product-cn'") == 2
    assert SQL.count("ON DUPLICATE KEY UPDATE") == 2
    assert len(re.findall(r"is_active,\s+NULL", SQL)) == 2
    assert "UPDATE resumes" not in SQL and "UPDATE resume_versions" not in SQL
    assert "https://" not in SQL


def test_classic_business_is_single_column_and_vitality_owns_a_supporting_rail() -> None:
    definitions = {definition.template_key: definition for definition in DEFINITIONS}
    classic = definitions["featured-classic-business-cn"]
    vitality = definitions["featured-vitality-cn"]

    assert [region.region_id for region in classic.regions] == ["header", "main"]
    assert [region.region_id for region in vitality.regions] == ["header", "main", "sidebar"]
    assert vitality.avatar.region_id == "header"
    assert vitality.tokens.accent_color == "#f06b32"
    support = next(slot for slot in vitality.slots if slot.region_id == "sidebar")
    assert set(support.accepts) == {"skills", "certificates", "languages", "interests"}
    for definition in DEFINITIONS:
        assert definition.avatar.visibility == "show"
        assert definition.avatar.fallback_asset == "system-default"
