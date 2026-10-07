from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0101.up.sql").read_text(encoding="utf-8")
RENAMES = re.findall(
    r"UPDATE resume_templates SET name = '([^']+)'\s+"
    r"WHERE `key` = '([^']+)' AND BINARY name = BINARY '([^']+)';",
    SQL,
)


def test_names_cover_only_79_muse_keys_with_short_unique_chinese_names() -> None:
    assert len(RENAMES) == 79
    assert len({key for _, key, _ in RENAMES}) == 79
    assert len({name for name, _, _ in RENAMES}) == 79
    assert all(key.startswith("muse-") for _, key, _ in RENAMES)
    assert all(re.fullmatch(r"[\u4e00-\u9fff]{2,4}", name) for name, _, _ in RENAMES)
    assert all(name != old for name, _, old in RENAMES)


def test_historical_rename_contains_only_guarded_name_updates() -> None:
    statements = [line for line in SQL.splitlines() if line and not line.startswith("--")]
    assert len(statements) == len(RENAMES) * 2
    assert all(line.startswith("UPDATE resume_templates SET name = ") for line in statements[::2])
    assert all("AND BINARY name = BINARY" in line for line in statements[1::2])
