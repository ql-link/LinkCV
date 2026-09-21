from __future__ import annotations

import json
import re
from pathlib import Path

from linkresume.domain.resume import CanonicalResumeDocument, TemplateDefinition, compile_layout_plan

ROOT = Path(__file__).resolve().parents[5]
SQL = (ROOT / "apps/backend/migrations/sql/0075.up.sql").read_text(encoding="utf-8")
DATA, DEFINITION = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", SQL)]


def test_only_approved_index_is_appended() -> None:
    assert DEFINITION["template_key"] == "original-index-cn"
    assert "UPDATE resumes" not in SQL
    assert "UPDATE resume_versions" not in SQL
    assert ", is_active, NULL)" in SQL
    document = CanonicalResumeDocument.model_validate(DATA)
    assert document.identity.name.value == "张三"
    assert {s.semantic_kind for s in document.sections} == {"profile", "work", "project", "education", "skills"}
    assert len(next(s for s in document.sections if s.semantic_kind == "work").entries) == 2


def test_index_regions_cover_existing_original_samples_without_loss() -> None:
    template = TemplateDefinition.model_validate(DEFINITION)
    for revision in ("0073", "0074", "0075"):
        sql = (ROOT / f"apps/backend/migrations/sql/{revision}.up.sql").read_text(encoding="utf-8")
        values = [json.loads(v.replace("''", "'")) for v in re.findall(r"CAST\('((?:[^']|'')*)' AS JSON\)", sql)]
        for raw in values[::2]:
            document = CanonicalResumeDocument.model_validate(raw)
            plan = compile_layout_plan(document, template)
            assigned = [n.node_id for r in plan.regions for n in r.nodes]
            assert sorted(assigned) == sorted([document.identity.node_id, *(s.node_id for s in document.sections)])
            mapping = {n.semantic_kind: r.region_id for r in plan.regions for n in r.nodes}
            assert mapping == {"identity": "header", "profile": "main", "skills": "sidebar", "work": "experience", "education": "education", "project": "projects"}
