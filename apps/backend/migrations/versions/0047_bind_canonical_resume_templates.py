"""Bind every persisted resume snapshot to a template identity.

Revision ID: 0047
Revises: 0046
Create Date: 2026-08-28

The schema change is deliberately limited to the four existing resume tables.
Before any DDL runs, the preflight resolves every current resume and historical
version to one existing template row.  The one supported retired identity,
``blank-cn``, gets an inactive tombstone when historical rows still refer to
it.  A row that cannot be resolved is a cutover blocker; this migration never
guesses a current template or overwrites a historical snapshot with a template
sample.
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
    blank_canonical_document,
    convert_legacy_document,
    convert_legacy_template,
    presentation_for_legacy,
)
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.domain.resume_style import default_resume_style

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
BLANK_TEMPLATE_KEY = "blank-cn"
# Template ids are unsigned in MySQL, so zero cannot be a persisted template
# id.  It is used only inside the in-memory cutover payload to mean that the
# retired blank tombstone must be materialized after preflight and before the
# SQL-first DDL runs.
TOMBSTONE_TEMPLATE_ID = 0
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
                normalized_style = _normalize_template_definition(
                    style,
                    field=f"template {template_id}.style_json",
                )
                definition = TemplateDefinition.model_validate(normalized_style)
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


def _identity_region_id(value: JsonObject, *, field: str) -> str:
    """Recover the avatar region from an older TemplateDefinition shape."""

    regions = value.get("regions")
    slots = value.get("slots")
    if not isinstance(regions, list) or not isinstance(slots, list):
        raise RuntimeError(f"{field} has no recoverable template regions/slots")
    region_ids = {
        item.get("region_id")
        for item in regions
        if isinstance(item, dict) and isinstance(item.get("region_id"), str)
    }
    explicit_candidates: set[str] = set()
    fallback_candidates: set[str] = set()
    for slot in slots:
        if not isinstance(slot, dict):
            continue
        accepts = slot.get("accepts")
        region_id = slot.get("region_id")
        if (
            isinstance(region_id, str)
            and region_id in region_ids
            and isinstance(accepts, list)
            and any(kind in {"identity", "basics", "avatar"} for kind in accepts)
        ):
            if slot.get("universal_fallback"):
                fallback_candidates.add(region_id)
            else:
                explicit_candidates.add(region_id)
    candidates = explicit_candidates or fallback_candidates
    if len(candidates) != 1:
        raise RuntimeError(
            f"{field} has no uniquely recoverable identity/avatar region"
        )
    return next(iter(candidates))


def _normalize_template_definition(value: object, *, field: str) -> JsonObject:
    """Add only the known missing field from the pre-avatar canonical shape.

    The 0046-era canonical definition had the same strict fields as the
    current contract except for ``avatar``.  The default is intentionally
    neutral; 0048 applies the official per-key avatar policy afterwards.  An
    explicitly present avatar is never repaired here, so malformed or
    contradictory values remain fail-closed.
    """

    if not isinstance(value, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    if value.get("schema_version") != "template-definition.v1":
        return value
    if "avatar" in value:
        return value
    region_id = _identity_region_id(value, field=field)
    return {
        **value,
        "avatar": {
            "visibility": "hide",
            "fallback_asset": "none",
            "size_px": 96,
            "region_id": region_id,
        },
    }


def _snapshot_parts(
    data_value: object,
    style_value: object,
    *,
    template_key: str,
    field: str,
    template_definition: TemplateDefinition | None = None,
) -> tuple[CanonicalResumeDocument, ResumePresentation, TemplateDefinition]:
    """Validate and convert one persisted snapshot without writing it.

    A canonical row already owns its template definition snapshot and must keep
    it byte-for-byte at the model level.  A legacy row gets a presentation built
    from the supplied template identity; only its legacy wrapper changes.
    """

    data = _decode_json(data_value, field=f"{field}.data_json")
    style = _decode_json(style_value, field=f"{field}.style_json")
    if not isinstance(data, dict) or not isinstance(style, dict):
        raise RuntimeError(f"{field} JSON roots must be objects")

    try:
        if data.get("schema_version") == "canonical-resume.v1":
            canonical = CanonicalResumeDocument.model_validate(data)
            snapshot = style.get("template_snapshot")
            normalized_style = dict(style)
            if isinstance(snapshot, dict):
                normalized_style["template_snapshot"] = _normalize_template_definition(
                    snapshot,
                    field=f"{field}.style_json.template_snapshot",
                )
            presentation = ResumePresentation.model_validate(normalized_style)
            snapshot_definition = presentation.template_snapshot
            if snapshot_definition.template_key != template_key:
                raise RuntimeError(f"{field} template identity disagrees")
            if (
                template_definition is not None
                and snapshot_definition.template_key != template_definition.template_key
            ):
                raise RuntimeError(f"{field} template identity disagrees")
            return canonical, presentation, snapshot_definition

        legacy = parse_resume_snapshot(data, style)
        if legacy.style.template_key != template_key:
            raise RuntimeError(f"{field} template identity disagrees")
        definition = template_definition or convert_legacy_template(
            legacy.style, template_key=template_key
        )
        return (
            convert_legacy_document(legacy.data),
            presentation_for_legacy(legacy.style, definition),
            definition,
        )
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} cannot be cut over") from error


def _retired_template_definition(
    rows: list[dict[str, object]],
    *,
    field_prefix: str,
) -> TemplateDefinition:
    """Build a neutral identity definition for the retired blank key.

    A user's historical presentation may legitimately contain different
    portable settings or template tokens.  It must be converted from its own
    snapshot, so the tombstone never borrows the first user's style.  The
    caller still passes the discovered rows to make the no-reference case
    explicit and to keep the preflight contract easy to audit.
    """

    if not rows:
        raise RuntimeError(
            f"{BLANK_TEMPLATE_KEY} has historical references but no recoverable snapshot"
        )
    try:
        return convert_legacy_template(
            default_resume_style().model_copy(
                update={"template_key": BLANK_TEMPLATE_KEY}
            ),
            template_key=BLANK_TEMPLATE_KEY,
        )
    except (TypeError, ValueError) as error:
        raise RuntimeError(
            f"{field_prefix} cannot build a retired template identity"
        ) from error


def _template_key_for_row(
    row: dict[str, object],
    *,
    template_by_id: dict[int, str],
    field: str,
) -> str:
    """Resolve a row's style identity and reject relational conflicts."""

    key = _template_key(row["style_json"], field=f"{field}.style_json")
    if key is None:
        raise RuntimeError(f"{field} has no uniquely resolvable template identity")

    relation_id = row.get("template_id")
    if relation_id is not None:
        try:
            relation_key = template_by_id[int(relation_id)]
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError(f"{field} references an unknown template id") from error
        if relation_key != key:
            raise RuntimeError(f"{field} template identity conflicts with template_id")
    return key


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

    # 0042 deliberately removed the blank catalog row.  If a later operator
    # recreated that key, it is only safe to reuse it when it is already an
    # inactive, valid tombstone; an active row would make the retired identity
    # selectable again and is therefore a cutover conflict.
    blank_template_id = template_by_key.get(BLANK_TEMPLATE_KEY)
    if blank_template_id is not None:
        blank_rows = (
            connection.execute(
                sa.text(
                    "SELECT id, is_active FROM resume_templates "
                    "WHERE `key` = :key ORDER BY id"
                ),
                {"key": BLANK_TEMPLATE_KEY},
            )
            .mappings()
            .all()
        )
        if (
            len(blank_rows) != 1
            or int(blank_rows[0].get("id", -1)) != blank_template_id
        ):
            raise RuntimeError("retired blank template identity is ambiguous")
        if int(blank_rows[0].get("is_active", 1)) != 0:
            raise RuntimeError("retired blank template must be inactive")

    resume_rows = (
        connection.execute(
            sa.text(
                "SELECT id, template_id, data_json, style_json FROM resumes ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
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

    resume_keys: dict[int, str] = {}
    version_keys: dict[int, str] = {}
    retired_rows: list[dict[str, object]] = []

    for row in resume_rows:
        resume_id = int(row["id"])
        key = _template_key_for_row(
            row,
            template_by_id=template_by_id,
            field=f"resume {resume_id}",
        )
        if key not in template_by_key and key != BLANK_TEMPLATE_KEY:
            raise RuntimeError(
                f"resume {resume_id} references unknown style template {key}"
            )
        resume_keys[resume_id] = key
        if key == BLANK_TEMPLATE_KEY and blank_template_id is None:
            retired_rows.append(row)

    for row in version_rows:
        version_id = int(row["id"])
        resume_id = int(row["resume_id"])
        key = _template_key_for_row(
            row,
            template_by_id=template_by_id,
            field=f"resume_version {version_id}",
        )
        if key not in template_by_key and key != BLANK_TEMPLATE_KEY:
            raise RuntimeError(
                f"resume_version {version_id} references unknown style template {key}"
            )
        version_keys[version_id] = key
        if resume_id not in resume_keys:
            raise RuntimeError(
                f"resume_version {version_id} belongs to unresolved resume {resume_id}"
            )
        if key == BLANK_TEMPLATE_KEY and blank_template_id is None:
            retired_rows.append(row)

    retired_definition: TemplateDefinition | None = None
    if blank_template_id is not None:
        retired_definition = template_definitions.get(blank_template_id)
        if retired_definition is None:
            raise RuntimeError("retired blank template has no valid definition")
    elif retired_rows:
        # Build the tombstone payload entirely in memory.  The actual INSERT is
        # intentionally delayed until every possible blocker above has been
        # observed by the read-only preflight; upgrade() materializes it just
        # before the SQL file so its NOT NULL DDL can see the identity.
        retired_definition = _retired_template_definition(
            retired_rows,
            field_prefix="retired blank snapshot",
        )
        template_payloads[TOMBSTONE_TEMPLATE_ID] = (
            blank_canonical_document(seed=BLANK_TEMPLATE_KEY).model_dump(mode="json"),
            retired_definition.model_dump(mode="json"),
        )

    def template_id_for_key(key: str) -> int:
        template_id = template_by_key.get(key)
        if template_id is not None:
            return template_id
        if key == BLANK_TEMPLATE_KEY and retired_definition is not None:
            return TOMBSTONE_TEMPLATE_ID
        raise RuntimeError(f"template {key} cannot be resolved")

    resume_templates = {
        resume_id: template_id_for_key(key) for resume_id, key in resume_keys.items()
    }
    version_templates = {
        version_id: template_id_for_key(key) for version_id, key in version_keys.items()
    }

    def definition_for_key(key: str) -> TemplateDefinition | None:
        # Retired rows keep each historical legacy style as its own frozen
        # presentation.  The tombstone definition is only a catalog identity,
        # never a replacement for a user's snapshot.
        if key == BLANK_TEMPLATE_KEY:
            return None
        template_id = template_by_key.get(key)
        definition = template_definitions.get(template_id) if template_id else None
        if definition is None:
            raise RuntimeError(f"template {key} has no valid definition")
        return definition

    resume_payloads: dict[int, tuple[dict[str, object], dict[str, object]]] = {}
    for row in resume_rows:
        resume_id = int(row["id"])
        key = resume_keys[resume_id]
        canonical, presentation, _ = _snapshot_parts(
            row["data_json"],
            row["style_json"],
            template_key=key,
            field=f"resume {resume_id}",
            template_definition=definition_for_key(key),
        )
        resume_payloads[resume_id] = (
            canonical.model_dump(mode="json"),
            presentation.model_dump(mode="json"),
        )

    version_payloads: dict[int, tuple[dict[str, object], dict[str, object]]] = {}
    for row in version_rows:
        version_id = int(row["id"])
        key = version_keys[version_id]
        canonical, presentation, _ = _snapshot_parts(
            row["data_json"],
            row["style_json"],
            template_key=key,
            field=f"resume_version {version_id}",
            template_definition=definition_for_key(key),
        )
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
    required_template_ids = {
        *resume_templates.values(),
        *version_templates.values(),
    }
    if TOMBSTONE_TEMPLATE_ID in required_template_ids:
        raise RuntimeError(
            "retired blank template must be materialized before 0047 SQL runs"
        )
    template_ids: dict[int, int] = {}

    if required_template_ids - {TOMBSTONE_TEMPLATE_ID}:
        rows = (
            connection.execute(
                sa.text("SELECT id, `key` FROM resume_templates ORDER BY id")
            )
            .mappings()
            .all()
        )
        by_id = {int(row["id"]): str(row["key"]) for row in rows}
        for template_id in required_template_ids - {TOMBSTONE_TEMPLATE_ID}:
            if template_id not in by_id:
                raise RuntimeError(f"template id {template_id} disappeared during 0047")
            template_ids[template_id] = template_id

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
            if table == "resume_templates" and row_id == TOMBSTONE_TEMPLATE_ID:
                continue
            if table == "resumes":
                template_id = template_ids.get(resume_templates[row_id])
                if template_id is None:
                    raise RuntimeError(
                        f"resume {row_id} has no resolved template identity"
                    )
            elif table == "resume_versions":
                template_id = template_ids.get(version_templates[row_id])
                if template_id is None:
                    raise RuntimeError(
                        f"resume_version {row_id} has no resolved template identity"
                    )
            else:
                template_id = None
            result = connection.execute(
                statement,
                {
                    "id": row_id,
                    **(
                        {"template_id": template_id}
                        if table == "resumes"
                        else {"template_id": template_id}
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
            if result.rowcount != 1:
                raise RuntimeError(f"0047 lost {table}[{row_id}] during cutover")


def _materialize_tombstone(
    connection: sa.engine.Connection,
    payloads: CutoverPayloads,
) -> CutoverPayloads:
    """Insert the validated retired identity before 0047's NOT NULL DDL.

    MySQL can implicitly commit each ALTER TABLE.  All blockers have already
    been checked by ``_preflight``; this small, deterministic INSERT is the
    only write intentionally performed before the SQL-first schema cutover so
    its foreign-key updates and NOT NULL alteration can see a valid identity.
    """

    resume_templates, version_templates, templates, resumes, versions = payloads
    if TOMBSTONE_TEMPLATE_ID not in {
        *resume_templates.values(),
        *version_templates.values(),
    }:
        return payloads
    tombstone = templates.get(TOMBSTONE_TEMPLATE_ID)
    if tombstone is None:
        raise RuntimeError("retired blank template payload is missing")
    tombstone_data, tombstone_style = tombstone
    existing = (
        connection.execute(
            sa.text(
                "SELECT id, is_active, data_json, style_json "
                "FROM resume_templates WHERE `key` = :key ORDER BY id"
            ),
            {"key": BLANK_TEMPLATE_KEY},
        )
        .mappings()
        .all()
    )
    if len(existing) > 1:
        raise RuntimeError("retired blank template identity is ambiguous")
    if existing:
        row = existing[0]
        if int(row.get("is_active", 1)) != 0:
            raise RuntimeError("retired blank template must be inactive")
        actual_data = _decode_json(
            row["data_json"], field="retired blank template.data_json"
        )
        actual_style = _decode_json(
            row["style_json"], field="retired blank template.style_json"
        )
        if actual_data != tombstone_data or actual_style != tombstone_style:
            raise RuntimeError("retired blank template tombstone conflicts")
        tombstone_id = int(row["id"])
    else:
        connection.execute(
            sa.text(
                "INSERT INTO resume_templates "
                "(`key`, name, description, data_json, style_json, is_active) "
                "VALUES (:key, :name, :description, :data_json, :style_json, 0)"
            ),
            {
                "key": BLANK_TEMPLATE_KEY,
                "name": "已退役空白模板",
                "description": "仅用于保留历史简历模板身份，不可用于新建或切换",
                "data_json": json.dumps(
                    tombstone_data,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "style_json": json.dumps(
                    tombstone_style,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            },
        )
        inserted = connection.scalar(
            sa.text("SELECT id FROM resume_templates WHERE `key` = :key"),
            {"key": BLANK_TEMPLATE_KEY},
        )
        if inserted is None:
            raise RuntimeError("retired blank template tombstone was not inserted")
        tombstone_id = int(inserted)

    def resolve(mapping: dict[int, int]) -> dict[int, int]:
        return {
            row_id: tombstone_id
            if template_id == TOMBSTONE_TEMPLATE_ID
            else template_id
            for row_id, template_id in mapping.items()
        }

    return (
        resolve(resume_templates),
        resolve(version_templates),
        templates,
        resumes,
        versions,
    )


def _verify(
    connection: sa.engine.Connection,
    payloads: CutoverPayloads | None = None,
) -> None:
    null_resume = connection.scalar(
        sa.text("SELECT COUNT(*) FROM resumes WHERE template_id IS NULL")
    )
    null_versions = connection.scalar(
        sa.text("SELECT COUNT(*) FROM resume_versions WHERE template_id IS NULL")
    )
    if int(null_resume or 0) or int(null_versions or 0):
        raise RuntimeError("0047 left a resume or version without a template")
    if payloads is not None:
        _, _, templates, _, _ = payloads
        tombstone = templates.get(TOMBSTONE_TEMPLATE_ID)
        if tombstone is not None:
            row = (
                connection.execute(
                    sa.text(
                        "SELECT is_active, data_json, style_json FROM resume_templates "
                        "WHERE `key` = :key"
                    ),
                    {"key": BLANK_TEMPLATE_KEY},
                )
                .mappings()
                .one_or_none()
            )
            if row is None or int(row["is_active"]) != 0:
                raise RuntimeError("0047 did not create an inactive blank tombstone")
            expected_data, expected_style = tombstone
            actual_data = _decode_json(
                row["data_json"], field="retired blank template.data_json"
            )
            actual_style = _decode_json(
                row["style_json"], field="retired blank template.style_json"
            )
            if actual_data != expected_data or actual_style != expected_style:
                raise RuntimeError("0047 blank tombstone verification failed")
        active_blank = connection.scalar(
            sa.text(
                "SELECT COUNT(*) FROM resume_templates "
                "WHERE `key` = :key AND is_active = 1"
            ),
            {"key": BLANK_TEMPLATE_KEY},
        )
        if int(active_blank or 0):
            raise RuntimeError("0047 left the retired blank template selectable")
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
    payloads = _materialize_tombstone(connection, payloads)
    execute_sql_file(connection, SQL_DIR / "0047.up.sql")
    _write_cutover_payloads(connection, payloads)
    _verify(connection, payloads)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
