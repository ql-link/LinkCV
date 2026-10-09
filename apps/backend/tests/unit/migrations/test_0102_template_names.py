from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
RENAME_PATTERN = (
    r"UPDATE resume_templates SET name = '([^']+)'\s+"
    r"WHERE `key` = '([^']+)' AND BINARY name = BINARY '([^']+)';"
)
RENAMES = re.findall(RENAME_PATTERN, (ROOT / "apps/backend/migrations/sql/0102.up.sql").read_text())
PREVIOUS = re.findall(RENAME_PATTERN, (ROOT / "apps/backend/migrations/sql/0101.up.sql").read_text())


def test_names_cover_same_catalog_with_longer_unique_names() -> None:
    assert len(RENAMES) == len({key for _, key, _ in RENAMES}) == 79
    assert len({name for name, _, _ in RENAMES}) == 79
    assert all(key.startswith("muse-") for _, key, _ in RENAMES)
    assert all(re.fullmatch(r"[\u4e00-\u9fff]{4,6}", name) for name, _, _ in RENAMES)
    assert {key: old for _, key, old in RENAMES} == {key: name for name, key, _ in PREVIOUS}


def test_current_registry_and_documented_names_match_final_catalog() -> None:
    registry = (ROOT / "apps/web/src/api/museThemes.ts").read_text()
    registered = dict(re.findall(r'theme: "([^"]+)", name: "([^"]+)"', registry))
    expected = {key.removesuffix("-cn"): name for name, key, _ in RENAMES if key.startswith("muse-")}
    assert registered == expected
    originals = {key: old for _, key, old in PREVIOUS}
    documented = (ROOT / "docs/features/resume-template-names.md").read_text()
    assert all(f"| {name} | {originals[key]} | `{key}` |" in documented for name, key, _ in RENAMES)
