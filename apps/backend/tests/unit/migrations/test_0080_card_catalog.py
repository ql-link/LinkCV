from __future__ import annotations

import json
import re
from pathlib import Path

from linkresume.domain.resume import TemplateDefinition

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0080.up.sql").read_text(encoding="utf-8")
DEFINITIONS = [
    TemplateDefinition.model_validate(json.loads(value.replace("''", "'")))
    for value in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)
]


def test_card_catalog_reuses_fictional_content_and_registers_both_layouts() -> None:
    registry = (ROOT / "apps/web/src/api/featuredThemes.ts").read_text(encoding="utf-8")
    keys = {definition.template_key for definition in DEFINITIONS}
    assert keys == {"featured-card-dashed-cn", "featured-card-rail-cn"}
    assert keys <= {f"{key}-cn" for key in re.findall(r'"(featured-[a-z-]+)"', registry)}
    assert SQL.count("WHERE source.`key` = 'featured-product-cn'") == 2
    assert SQL.count("ON DUPLICATE KEY UPDATE") == 2
    assert len(re.findall(r"is_active,\s+NULL", SQL)) == 2
    assert "UPDATE resumes" not in SQL and "UPDATE resume_versions" not in SQL
    assert "https://" not in SQL


def test_card_layouts_keep_single_column_content_and_safe_avatar_fallback() -> None:
    assert len(DEFINITIONS) == 2
    for definition in DEFINITIONS:
        assert [region.region_id for region in definition.regions] == ["header", "main"]
        assert definition.avatar.visibility == "show"
        assert definition.avatar.fallback_asset == "system-default"
        assert definition.tokens.accent_color == "#2864e8"
