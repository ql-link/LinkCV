"""Bind every persisted resume snapshot to an existing template.

Revision ID: 0047
Revises: 0046
Create Date: 2026-08-28

The schema change is deliberately limited to the four existing resume tables.
Before any DDL runs, the preflight resolves every current resume and historical
version to one existing template row.  A row that cannot be resolved is a
cutover blocker; this migration never guesses a default template or creates a
synthetic snapshot.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume import (
    CanonicalResumeDocument,
    ResumePresentation,
    TemplateDefinition,
)
from linkcv.domain.resume.legacy_cutover import (
    convert_legacy_document,
    convert_legacy_template,
    presentation_for_legacy,
)
from linkcv.domain.resume_snapshot import parse_resume_snapshot

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
JsonObject = dict[str, object]
JsonPair = tuple[JsonObject, JsonObject]
CutoverPayloads = tuple[
    dict[int, int],
    dict[int, int],
    dict[int, JsonPair],
    dict[int, JsonPair],
    dict[int, JsonPair],
]


def _decode_json(value: object, *, field: str) -> object:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    return value


def _template_key(value: object, *, field: str) -> str | None:
    decoded = _decode_json(value, field=field)
    if not isinstance(decoded, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    direct = decoded.get("template_key")
    if isinstance(direct, str) and direct:
        return direct
    nested = decoded.get("template_snapshot")
    if isinstance(nested, dict):
        nested_key = nested.get("template_key")
        if isinstance(nested_key, str) and nested_key:
            return nested_key
    return None


def _template_rows(
    connection: sa.engine.Connection,
) -> tuple[
    dict[int, str],
    dict[str, int],
    dict[int, TemplateDefinition],
    dict[int, JsonPair],
]:
    rows = (
        connection.execute(
            sa.text(
                "SELECT id, `key`, data_json, style_json FROM resume_templates ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
    by_id = {int(row["id"]): str(row["key"]) for row in rows}
    by_key = {key: template_id for template_id, key in by_id.items()}
    if len(by_id) != len(by_key):
        raise RuntimeError("resume template keys must be unique before 0047")
    definitions: dict[int, TemplateDefinition] = {}
    converted: dict[int, tuple[dict[str, object], dict[str, object]]] = {}
    for row in rows:
        template_id = int(row["id"])
        key = str(row["key"])
        data = _decode_json(row["data_json"], field=f"template {template_id}.data_json")
        style = _decode_json(
            row["style_json"], field=f"template {template_id}.style_json"
        )
        if not isinstance(data, dict) or not isinstance(style, dict):
            raise RuntimeError(f"template {template_id} JSON roots must be objects")
        try:
            if style.get("schema_version") == "template-definition.v1":
                definition = TemplateDefinition.model_validate(style)
                canonical_data = CanonicalResumeDocument.model_validate(data)
                if definition.template_key != key:
                    raise RuntimeError(
                        f"template {template_id} relational key and definition key disagree"
                    )
            else:
                legacy = parse_resume_snapshot(data, style)
                if legacy.style.template_key != key:
                    raise RuntimeError(
                        f"template {template_id} relational key and style key disagree"
                    )
                definition = convert_legacy_template(legacy.style, template_key=key)
                canonical_data = convert_legacy_document(legacy.data)
        except (TypeError, ValueError) as error:
            raise RuntimeError(f"template {template_id} cannot be cut over") from error
        definitions[template_id] = definition
        converted[template_id] = (
            canonical_data.model_dump(mode="json"),
            definition.model_dump(mode="json"),
        )
    return by_id, by_key, definitions, converted


def _preflight(
    connection: sa.engine.Connection,
) -> CutoverPayloads:
    """Resolve resume and version template identities before any DDL."""

    template_by_id, template_by_key, template_definitions, template_payloads = (
        _template_rows(connection)
    )
    active_imports = connection.scalar(
        sa.text(
            "SELECT COUNT(*) FROM document_parse_tasks "
            "WHERE source_type='resume_import' "
            "AND (upload_status='uploading' OR parse_status='processing')"
        )
    )
    if int(active_imports or 0):
        raise RuntimeError("0047 requires a resume-import maintenance window")
    resume_templates: dict[int, int] = {}
    resume_payloads: dict[int, tuple[dict[str, object], dict[str, object]]] = {}
    resume_rows = (
        connection.execute(
            sa.text(
                "SELECT id, template_id, data_json, style_json FROM resumes ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
    for row in resume_rows:
        resume_id = int(row["id"])
        template_id = row["template_id"]
        key = _template_key(row["style_json"], field=f"resume {resume_id}.style_json")
        if key is None:
            raise RuntimeError(
                f"resume {resume_id} has no uniquely resolvable template identity"
            )
        if key not in template_by_key:
            raise RuntimeError(
                f"resume {resume_id} references unknown style template {key}"
            )
        # The persisted style is the layout snapshot that users actually saw.
        # A stale relational template_id can exist after historical switches;
        # cutover repairs that pointer to the explicit snapshot identity rather
        # than rewriting the snapshot to match stale metadata.
        resume_templates[resume_id] = template_by_key[key]

    for row in resume_rows:
        resume_id = int(row["id"])
        template_id = resume_templates[resume_id]
        data = _decode_json(
            row["data_json"],
            field=f"resume {resume_id}.data_json",
        )
        style = _decode_json(row["style_json"], field=f"resume {resume_id}.style_json")
        if not isinstance(data, dict) or not isinstance(style, dict):
            raise RuntimeError(f"resume {resume_id} JSON roots must be objects")
        try:
            if data.get("schema_version") == "canonical-resume.v1":
                canonical = CanonicalResumeDocument.model_validate(data)
                presentation = ResumePresentation.model_validate(style)
                if (
                    presentation.template_snapshot.template_key
                    != template_by_id[template_id]
                ):
                    raise RuntimeError(
                        f"resume {resume_id} template identity disagrees"
                    )
            else:
                legacy = parse_resume_snapshot(data, style)
                if legacy.style.template_key != template_by_id[template_id]:
                    raise RuntimeError(
                        f"resume {resume_id} template identity disagrees"
                    )
                canonical = convert_legacy_document(legacy.data)
                presentation = presentation_for_legacy(
                    legacy.style,
                    template_definitions[template_id],
                )
        except (TypeError, ValueError) as error:
            raise RuntimeError(f"resume {resume_id} cannot be cut over") from error
        resume_payloads[resume_id] = (
            canonical.model_dump(mode="json"),
            presentation.model_dump(mode="json"),
        )

    version_templates: dict[int, int] = {}
    version_payloads: dict[int, tuple[dict[str, object], dict[str, object]]] = {}
    version_rows = (
        connection.execute(
            sa.text(
                "SELECT id, resume_id, data_json, style_json "
                "FROM resume_versions ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
    for row in version_rows:
        version_id = int(row["id"])
        resume_id = int(row["resume_id"])
        key = _template_key(
            row["style_json"],
            field=f"resume_version {version_id}.style_json",
        )
        if key is None or key not in template_by_key:
            raise RuntimeError(
                f"resume_version {version_id} has no uniquely resolvable template identity"
            )
        version_templates[version_id] = template_by_key[key]
        if resume_id not in resume_templates:
            raise RuntimeError(
                f"resume_version {version_id} belongs to unresolved resume {resume_id}"
            )
        data = _decode_json(
            row["data_json"],
            field=f"resume_version {version_id}.data_json",
        )
        style = _decode_json(
            row["style_json"],
            field=f"resume_version {version_id}.style_json",
        )
        if not isinstance(data, dict) or not isinstance(style, dict):
            raise RuntimeError(
                f"resume_version {version_id} JSON roots must be objects"
            )
        template_id = version_templates[version_id]
        try:
            if data.get("schema_version") == "canonical-resume.v1":
                canonical = CanonicalResumeDocument.model_validate(data)
                presentation = ResumePresentation.model_validate(style)
                if (
                    presentation.template_snapshot.template_key
                    != template_by_id[template_id]
                ):
                    raise RuntimeError(
                        f"resume_version {version_id} template identity disagrees"
                    )
            else:
                legacy = parse_resume_snapshot(data, style)
                if legacy.style.template_key != template_by_id[template_id]:
                    raise RuntimeError(
                        f"resume_version {version_id} template identity disagrees"
                    )
                canonical = convert_legacy_document(legacy.data)
                presentation = presentation_for_legacy(
                    legacy.style,
                    template_definitions[template_id],
                )
        except (TypeError, ValueError) as error:
            raise RuntimeError(
                f"resume_version {version_id} cannot be cut over"
            ) from error
        version_payloads[version_id] = (
            canonical.model_dump(mode="json"),
            presentation.model_dump(mode="json"),
        )

    # A successful resume-import task should carry the same frozen template as
    # its result resume.  Failed or historical orphan tasks intentionally stay
    # NULL and are not fabricated during cutover.
    task_rows = (
        connection.execute(
            sa.text(
                "SELECT d.id, d.source_type, d.parse_status, r.id AS resume_id "
                "FROM document_parse_tasks AS d "
                "LEFT JOIN resumes AS r ON r.parse_task_id = d.id "
                "WHERE d.source_type = 'resume_import' "
                "AND d.parse_status = 'succeeded'"
            )
        )
        .mappings()
        .all()
    )
    for row in task_rows:
        resume_id = row["resume_id"]
        if resume_id is None:
            raise RuntimeError(
                f"successful import task {row['id']} has no result resume"
            )
        if int(resume_id) not in resume_templates:
            raise RuntimeError(
                f"successful import task {row['id']} has unresolved result resume"
            )
    return (
        resume_templates,
        version_templates,
        template_payloads,
        resume_payloads,
        version_payloads,
    )


def _write_cutover_payloads(
    connection: sa.engine.Connection,
    payloads: CutoverPayloads,
) -> None:
    resume_templates, version_templates, templates, resumes, versions = payloads
    statements = {
        "resume_templates": sa.text(
            "UPDATE resume_templates SET data_json=:data_json, style_json=:style_json WHERE id=:id"
        ),
        "resumes": sa.text(
            "UPDATE resumes SET template_id=:template_id, data_json=:data_json, style_json=:style_json WHERE id=:id"
        ),
        "resume_versions": sa.text(
            "UPDATE resume_versions SET template_id=:template_id, data_json=:data_json, style_json=:style_json WHERE id=:id"
        ),
    }
    for table, rows in (
        ("resume_templates", templates),
        ("resumes", resumes),
        ("resume_versions", versions),
    ):
        statement = statements[table]
        for row_id, (data, style) in rows.items():
            connection.execute(
                statement,
                {
                    "id": row_id,
                    **(
                        {"template_id": resume_templates[row_id]}
                        if table == "resumes"
                        else {"template_id": version_templates[row_id]}
                        if table == "resume_versions"
                        else {}
                    ),
                    "data_json": json.dumps(
                        data,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    "style_json": json.dumps(
                        style,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                },
            )


def _verify(connection: sa.engine.Connection) -> None:
    null_resume = connection.scalar(
        sa.text("SELECT COUNT(*) FROM resumes WHERE template_id IS NULL")
    )
    null_versions = connection.scalar(
        sa.text("SELECT COUNT(*) FROM resume_versions WHERE template_id IS NULL")
    )
    if int(null_resume or 0) or int(null_versions or 0):
        raise RuntimeError("0047 left a resume or version without a template")
    noncanonical = connection.scalar(
        sa.text(
            "SELECT "
            "(SELECT COUNT(*) FROM resume_templates WHERE JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) <> 'canonical-resume.v1' OR JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.schema_version')) <> 'template-definition.v1') + "
            "(SELECT COUNT(*) FROM resumes WHERE JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) <> 'canonical-resume.v1' OR JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.schema_version')) <> 'resume-presentation.v1') + "
            "(SELECT COUNT(*) FROM resume_versions WHERE JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) <> 'canonical-resume.v1' OR JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.schema_version')) <> 'resume-presentation.v1')"
        )
    )
    if int(noncanonical or 0):
        raise RuntimeError("0047 left a legacy resume JSON payload")


def upgrade() -> None:
    connection = op.get_bind()
    # MySQL ALTER TABLE statements can implicitly commit.  Resolve every
    # identity before executing the SQL-first file so known blockers fail before
    # the first schema change.
    payloads = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0047.up.sql")
    _write_cutover_payloads(connection, payloads)
    _verify(connection)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
