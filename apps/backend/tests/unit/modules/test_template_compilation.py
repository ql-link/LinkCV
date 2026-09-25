from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from linkresume.domain.resume import CanonicalResumeDocument
from linkresume.modules.resumes import template_compilation
from linkresume.modules.resumes.models import ResumeTemplate
from linkresume.modules.resumes.template_compilation import (
    compiled_template_layout_plan,
    validated_template_snapshot,
)
from linkresume.modules.resumes.template_routes import template_record

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0075.up.sql").read_text(encoding="utf-8")
DATA, DEFINITION = [
    json.loads(value.replace("''", "'"))
    for value in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)
]


@pytest.fixture(autouse=True)
def clear_template_caches():
    template_compilation._validated_snapshot.cache_clear()
    template_compilation._compiled_layout_plan.cache_clear()
    yield
    template_compilation._validated_snapshot.cache_clear()
    template_compilation._compiled_layout_plan.cache_clear()


def count_calls(monkeypatch, target, name: str) -> list:
    calls: list = []
    original = getattr(target, name)

    def spy(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(target, name, spy)
    return calls


def count_parses(monkeypatch) -> list:
    return count_calls(monkeypatch, template_compilation, "parse_persisted_template_snapshot")


def template_row(**overrides) -> ResumeTemplate:
    values = {
        "id": 1,
        "key": DEFINITION["template_key"],
        "name": "索引网格",
        "description": None,
        "data_json": DATA,
        "style_json": DEFINITION,
        "style_categories_json": ["经典"],
        "use_cases_json": ["校招"],
    }
    values.update(overrides)
    return ResumeTemplate(**values)


def test_repeated_reads_reuse_one_validation_and_one_compilation(monkeypatch) -> None:
    parses = count_parses(monkeypatch)
    compilations = count_calls(monkeypatch, template_compilation, "compile_layout_plan")

    for _ in range(3):
        snapshot = validated_template_snapshot(DATA, DEFINITION)
        plan = compiled_template_layout_plan(DATA, DEFINITION)

    assert len(parses) == 1
    assert len(compilations) == 1
    assert plan.template_key == DEFINITION["template_key"]
    assert plan.content_sha256 == snapshot.data.content_sha256()


def test_key_order_does_not_create_a_second_cache_entry(monkeypatch) -> None:
    parses = count_parses(monkeypatch)
    reordered = {key: DATA[key] for key in reversed(list(DATA))}

    validated_template_snapshot(DATA, DEFINITION)
    validated_template_snapshot(reordered, DEFINITION)

    assert len(parses) == 1


def test_changed_content_is_validated_again(monkeypatch) -> None:
    parses = count_parses(monkeypatch)
    validated_template_snapshot(DATA, DEFINITION)

    changed = json.loads(json.dumps(DATA))
    changed["identity"]["name"]["value"] = "李四"
    recompiled = compiled_template_layout_plan(changed, DEFINITION)

    assert len(parses) == 2
    assert recompiled.content_sha256 != compiled_template_layout_plan(
        DATA, DEFINITION
    ).content_sha256


def test_invalid_content_keeps_raising_the_original_error_type(monkeypatch) -> None:
    parses = count_parses(monkeypatch)
    broken = json.loads(json.dumps(DATA))
    broken["schema_version"] = "unsupported"

    for _ in range(2):
        with pytest.raises(ValueError):
            validated_template_snapshot(broken, DEFINITION)

    assert len(parses) == 2
    assert not template_compilation._validated_snapshot.cache_info().currsize


def test_template_record_reads_through_the_cache(monkeypatch) -> None:
    """路由必须走缓存路径:否则第二次读取会重新校验同一份模板内容。"""

    validations = count_calls(monkeypatch, CanonicalResumeDocument, "model_validate")

    first = template_record(template_row())
    assert len(validations) == 1

    second = template_record(template_row(id=2, name="索引网格副本"))

    assert len(validations) == 1
    assert first.layout_plan == second.layout_plan
    assert first.name != second.name
