from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

from drawoffer.core.migration_sql import sql_statements
from drawoffer.modules.resumes.template_admin_routes import AdminTemplateClassificationRequest

ROOT = Path(__file__).resolve().parents[5]
SQL = ROOT / "apps/backend/migrations/sql/0104.up.sql"


def curation_entries():
    value = re.search(r"SET @muse_curation = CAST\('((?:[^']|'')*)' AS JSON\)", SQL.read_text()).group(1)
    return json.loads(value.replace("''", "'").replace("\\\\", "\\"))


def test_curation_targets_only_muse_seeds_and_keeps_65_representatives():
    entries = curation_entries()
    assert len(entries) == len({item["key"] for item in entries}) == 79
    assert all(item["key"].startswith("muse-") for item in entries)
    assert {item["seed_order"] for item in entries} == set(range(1, 80))
    assert sorted(item["rank"] for item in entries if item["rank"]) == list(range(1, 66))
    assert {item["key"] for item in entries if not item["rank"]} == {
        "muse-navymast-cn", "muse-nameband-cn", "muse-slanted-cn", "muse-formgrid-cn",
        "muse-ruled-cn", "muse-righttitle-cn", "muse-evergreen-cn", "muse-deeprail-cn",
        "muse-bluewash-cn", "muse-roundrail-cn", "muse-signaturerail-cn", "muse-greeting-cn",
        "muse-ledger-cn", "muse-drawinglist-cn",
    }
    statements = sql_statements(SQL.read_text())
    assert len(statements) == 6
    assert len([s for s in statements if s.startswith("UPDATE resume_templates")]) == 3
    assert not any(re.search(r"\b(DELETE|INSERT|ALTER|DROP|CREATE)\b", s) for s in statements)
    assert not re.search(r"SET\s+(?:template\.)?(?:data_json|style_json|name)\s*=", SQL.read_text())


@pytest.mark.parametrize("entry", [i for i in curation_entries() if i["rank"]], ids=lambda i: i["key"])
def test_retained_classifications_match_existing_admin_contract(entry):
    labels = AdminTemplateClassificationRequest(
        style_categories=entry["style_categories"], use_cases=entry["use_cases"], style_review_status="classified"
    )
    assert labels.style_categories and labels.use_cases
    assert entry["definition"]["template_key"] == entry["key"]


def test_revision_is_forward_only_and_follows_0103():
    path = next((ROOT / "apps/backend/migrations/versions").glob("0104_*.py"))
    spec = importlib.util.spec_from_file_location("curate_templates", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "0104" and module.down_revision == "0103"
    assert not SQL.with_name("0104.down.sql").exists()
    with pytest.raises(RuntimeError, match="forward-only"):
        module.downgrade()
