"""Repair the canonical content/TemplateDefinition contract after 0047.

0047 intentionally removed the old page projection, but its legacy rich-text
reader represented section-internal ``resumeRow``/``resumeMetaRow``/
``resumeTrioRow`` containers as ordinary paragraphs.  This revision restores
only those content rows and adds the strict, template-owned avatar policy.  No
schema object is changed: every candidate JSON value is built and validated
before the first UPDATE is issued.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op

from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume import (
    CanonicalResumeDocument,
    ResumePresentation,
    TemplateAvatar,
    TemplateDefinition,
)
from linkcv.domain.resume.legacy_cutover import recompose_flattened_rows

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
TABLES = ("resume_templates", "resumes", "resume_versions")

OFFICIAL_AVATAR_POLICY: dict[str, dict[str, object]] = {
    "administrative-sidebar-cn": {
        "visibility": "show",
        "fallback_asset": "system-default",
        "size_px": 108,
    },
    "campus-professional-cn": {
        "visibility": "show",
        "fallback_asset": "system-default",
        "size_px": 82,
    },
    "civic-service-cn": {
        "visibility": "show",
        "fallback_asset": "system-default",
        "size_px": 94,
    },
    "creative-orange-cn": {
        "visibility": "show",
        "fallback_asset": "system-default",
        "size_px": 112,
    },
    "classic-technical-cn": {
        "visibility": "hide",
        "fallback_asset": "none",
    },
}

JsonObject = dict[str, Any]
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


def _object(value: object, *, field: str) -> JsonObject:
    decoded = _decode_json(value, field=field)
    if not isinstance(decoded, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    return decoded


def _template_key(style: JsonObject, *, field: str) -> str | None:
    direct = style.get("template_key")
    if isinstance(direct, str) and direct:
        return direct
    snapshot = style.get("template_snapshot")
    if isinstance(snapshot, dict):
        nested = snapshot.get("template_key")
        if isinstance(nested, str) and nested:
            return nested
    return None


def _raw_marker_present(value: object) -> bool:
    if isinstance(value, str):
        return any(
            re.match(r"^:{3,4}(?:\s|$)", line.strip()) is not None
            for line in value.splitlines()
        )
    if isinstance(value, dict):
        return any(_raw_marker_present(item) for item in value.values())
    if isinstance(value, list):
        return any(_raw_marker_present(item) for item in value)
    return False


def _identity_region_id(definition: JsonObject, *, field: str) -> str:
    regions = definition.get("regions")
    slots = definition.get("slots")
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


def _repaired_avatar(
    definition: JsonObject,
    *,
    template_key: str,
    field: str,
) -> dict[str, object]:
    region_id = _identity_region_id(definition, field=field)
    existing = definition.get("avatar")
    existing_avatar: TemplateAvatar | None = None
    if existing is not None:
        try:
            existing_avatar = TemplateAvatar.model_validate(existing)
        except (TypeError, ValueError) as error:
            raise RuntimeError(f"{field}.avatar is not a valid policy") from error
        if existing_avatar.region_id != region_id:
            raise RuntimeError(
                f"{field}.avatar region disagrees with the existing identity slot"
            )

    protected = OFFICIAL_AVATAR_POLICY.get(template_key)
    if protected is not None:
        policy: dict[str, object] = {
            **protected,
            "region_id": region_id,
            # A hidden avatar is still required to carry a deterministic size
            # for a future template switch; use the previous value when it is
            # valid, otherwise the contract's neutral default.
            "size_px": (
                existing_avatar.size_px
                if existing_avatar is not None
                else 96
            ),
        }
        policy.update(protected)
    elif existing_avatar is not None:
        policy = existing_avatar.model_dump(mode="json")
    else:
        # 0036/0038/0042 guarantee that non-official templates are inactive;
        # absence of a trustworthy policy therefore fails closed.  Hiding the
        # avatar and using no fallback is safe only after the identity region
        # above has been proven unique.
        policy = {
            "visibility": "hide",
            "fallback_asset": "none",
            "size_px": 96,
            "region_id": region_id,
        }
    try:
        return TemplateAvatar.model_validate(policy).model_dump(mode="json")
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} cannot recover a strict avatar policy") from error


def _repair_template_definition(
    value: object,
    *,
    template_key: str,
    field: str,
) -> TemplateDefinition:
    definition = _object(value, field=field)
    if definition.get("schema_version") != "template-definition.v1":
        raise RuntimeError(f"{field} is not the 0046 TemplateDefinition shape")
    candidate = copy.deepcopy(definition)
    candidate["avatar"] = _repaired_avatar(
        candidate,
        template_key=template_key,
        field=field,
    )
    try:
        result = TemplateDefinition.model_validate(candidate)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} cannot be validated after avatar repair") from error
    if result.template_key != template_key:
        raise RuntimeError(f"{field} template key disagrees with its relational key")
    return result


def _repair_document(value: object, *, field: str) -> CanonicalResumeDocument:
    payload = _object(value, field=field)
    try:
        current = CanonicalResumeDocument.model_validate(payload)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} is not canonical resume JSON") from error
    candidate = current.model_dump(mode="json")
    for section_payload, section in zip(candidate["sections"], current.sections, strict=True):
        section_payload["blocks"] = [
            block.model_dump(mode="json")
            for block in recompose_flattened_rows(
                list(section.blocks),
                seed=f"{field}:section:{section.node_id}",
            )
        ]
        for entry_payload, entry in zip(section_payload["entries"], section.entries, strict=True):
            entry_payload["blocks"] = [
                block.model_dump(mode="json")
                for block in recompose_flattened_rows(
                    list(entry.blocks),
                    seed=f"{field}:entry:{entry.node_id}",
                )
            ]
    try:
        result = CanonicalResumeDocument.model_validate(candidate)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} failed strict validation after row repair") from error
    if _raw_marker_present(result.model_dump(mode="json")):
        raise RuntimeError(f"{field} still contains a raw legacy marker")
    return result


def _repair_presentation(
    value: object,
    *,
    template_key: str,
    field: str,
) -> ResumePresentation:
    payload = _object(value, field=field)
    if payload.get("schema_version") != "resume-presentation.v1":
        raise RuntimeError(f"{field} is not the 0046 ResumePresentation shape")
    snapshot = payload.get("template_snapshot")
    if not isinstance(snapshot, dict):
        raise RuntimeError(f"{field} has no template snapshot")
    snapshot_key = snapshot.get("template_key")
    if snapshot_key != template_key:
        raise RuntimeError(f"{field} template key disagrees with its relational key")
    candidate = copy.deepcopy(payload)
    candidate["template_snapshot"] = _repair_template_definition(
        snapshot,
        template_key=template_key,
        field=f"{field}.template_snapshot",
    ).model_dump(mode="json")
    try:
        return ResumePresentation.model_validate(candidate)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} failed strict presentation validation") from error


def _template_rows(
    connection: sa.engine.Connection,
) -> tuple[dict[int, str], dict[str, int], dict[int, TemplateDefinition], dict[int, JsonPair]]:
    rows = connection.execute(
        sa.text(
            "SELECT id, `key`, data_json, style_json, is_active "
            "FROM resume_templates ORDER BY id"
        )
    ).mappings().all()
    by_id = {int(row["id"]): str(row["key"]) for row in rows}
    by_key = {key: template_id for template_id, key in by_id.items()}
    if len(by_id) != len(by_key):
        raise RuntimeError("resume template keys must be unique before 0048")
    definitions: dict[int, TemplateDefinition] = {}
    payloads: dict[int, JsonPair] = {}
    for row in rows:
        template_id = int(row["id"])
        key = str(row["key"])
        definition = _repair_template_definition(
            row["style_json"],
            template_key=key,
            field=f"resume_templates[{template_id}].style_json",
        )
        data = _repair_document(
            row["data_json"],
            field=f"resume_templates[{template_id}].data_json",
        )
        definitions[template_id] = definition
        payloads[template_id] = (
            data.model_dump(mode="json"),
            definition.model_dump(mode="json"),
        )
    return by_id, by_key, definitions, payloads


def _style_key(
    row: Any,
    *,
    template_by_id: dict[int, str],
    field: str,
) -> str:
    style = _object(row["style_json"], field=f"{field}.style_json")
    key = _template_key(style, field=f"{field}.style_json")
    if key is None:
        template_id = row.get("template_id")
        if template_id is not None and int(template_id) in template_by_id:
            key = template_by_id[int(template_id)]
    if key is None:
        raise RuntimeError(f"{field} has no uniquely resolvable template identity")
    return key


def _resume_payload(
    row: Any,
    *,
    template_by_id: dict[int, str],
    template_by_key: dict[str, int],
    field: str,
) -> tuple[int, JsonPair]:
    key = _style_key(row, template_by_id=template_by_id, field=field)
    if key not in template_by_key:
        raise RuntimeError(f"{field} references unknown template {key}")
    data = _repair_document(row["data_json"], field=f"{field}.data_json")
    style = _repair_presentation(
        row["style_json"],
        template_key=key,
        field=f"{field}.style_json",
    )
    return template_by_key[key], (
        data.model_dump(mode="json"),
        style.model_dump(mode="json"),
    )


def _preflight(connection: sa.engine.Connection) -> CutoverPayloads:
    """Build every JSON correction before executing the SQL file or UPDATE."""

    template_by_id, template_by_key, _definitions, template_payloads = _template_rows(
        connection
    )
    resume_templates: dict[int, int] = {}
    resume_payloads: dict[int, JsonPair] = {}
    resume_rows = connection.execute(
        sa.text(
            "SELECT id, template_id, data_json, style_json FROM resumes ORDER BY id"
        )
    ).mappings().all()
    for row in resume_rows:
        resume_id = int(row["id"])
        template_id, payload = _resume_payload(
            row,
            template_by_id=template_by_id,
            template_by_key=template_by_key,
            field=f"resumes[{resume_id}]",
        )
        resume_templates[resume_id] = template_id
        resume_payloads[resume_id] = payload

    version_templates: dict[int, int] = {}
    version_payloads: dict[int, JsonPair] = {}
    version_rows = connection.execute(
        sa.text(
            "SELECT id, resume_id, template_id, data_json, style_json "
            "FROM resume_versions ORDER BY id"
        )
    ).mappings().all()
    for row in version_rows:
        version_id = int(row["id"])
        resume_id = int(row["resume_id"])
        if resume_id not in resume_templates:
            raise RuntimeError(
                f"resume_versions[{version_id}] belongs to an unresolved resume {resume_id}"
            )
        template_id, payload = _resume_payload(
            row,
            template_by_id=template_by_id,
            template_by_key=template_by_key,
            field=f"resume_versions[{version_id}]",
        )
        version_templates[version_id] = template_id
        version_payloads[version_id] = payload
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
            "UPDATE resumes SET data_json=:data_json, style_json=:style_json WHERE id=:id"
        ),
        "resume_versions": sa.text(
            "UPDATE resume_versions SET data_json=:data_json, style_json=:style_json WHERE id=:id"
        ),
    }
    del resume_templates, version_templates
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
                    "data_json": json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                    "style_json": json.dumps(style, ensure_ascii=False, separators=(",", ":")),
                },
            )


def _verify(connection: sa.engine.Connection) -> None:
    template_rows = connection.execute(
        sa.text("SELECT id, `key`, data_json, style_json FROM resume_templates ORDER BY id")
    ).mappings().all()
    resume_rows = connection.execute(
        sa.text("SELECT id, data_json, style_json FROM resumes ORDER BY id")
    ).mappings().all()
    version_rows = connection.execute(
        sa.text("SELECT id, data_json, style_json FROM resume_versions ORDER BY id")
    ).mappings().all()
    for row in template_rows:
        key = str(row["key"])
        data = _repair_document(row["data_json"], field=f"resume_templates[{row['id']}].data_json")
        definition = _repair_template_definition(row["style_json"], template_key=key, field=f"resume_templates[{row['id']}].style_json")
        if _raw_marker_present(data.model_dump(mode="json")) or _raw_marker_present(definition.model_dump(mode="json")):
            raise RuntimeError("0048 left raw legacy markers in a template")
    for table, rows in (("resumes", resume_rows), ("resume_versions", version_rows)):
        for row in rows:
            field = f"{table}[{row['id']}]"
            data = _object(row["data_json"], field=f"{field}.data_json")
            style = _object(row["style_json"], field=f"{field}.style_json")
            _repair_document(data, field=f"{field}.data_json")
            key = _template_key(style, field=f"{field}.style_json")
            if key is None:
                raise RuntimeError(f"{field} has no template identity after 0048")
            _repair_presentation(style, template_key=key, field=f"{field}.style_json")
            if _raw_marker_present(data) or _raw_marker_present(style):
                raise RuntimeError(f"{field} contains a raw legacy marker after 0048")


def upgrade() -> None:
    connection = op.get_bind()
    payloads = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0048.up.sql")
    _write_cutover_payloads(connection, payloads)
    _verify(connection)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
