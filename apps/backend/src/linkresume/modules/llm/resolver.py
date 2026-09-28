"""Resolve a use case to an immutable provider route before an upstream request."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.modules.llm.models import (
    LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute,
)

JOB_TEXT_EXTRACTION = "job_text_extraction"
RESUME_STRUCTURING = "resume_structuring"
JOB_IMAGE_EXTRACTION = "job_image_extraction"
ASSISTANT_CONVERSATION = "assistant_conversation"
MOCK_INTERVIEW = "mock_interview"
USE_CASES = (
    JOB_TEXT_EXTRACTION, RESUME_STRUCTURING, JOB_IMAGE_EXTRACTION,
    ASSISTANT_CONVERSATION, MOCK_INTERVIEW,
)
PROBE_VERSION = 1
PROBE_MAX_AGE = timedelta(days=7)


@dataclass(frozen=True)
class RoutePlan:
    use_case: str
    route_id: int
    model_id: int
    display_name: str
    provider_code: str
    connection_id: int
    runtime_config_version: int
    target_kind: str
    invoke_target: str
    protocol_code: str
    settings: dict
    credential_ciphertext: str | None
    pricing: dict | None
    selection_source: str


def validation_fingerprint(
    binding: LLMUseCaseRoute,
    route: LLMModelRoute,
    connection: LLMProviderConnection,
) -> str:
    material = {
        "probe_version": PROBE_VERSION,
        "use_case": binding.use_case,
        "protocol_code": binding.protocol_code,
        "route_id": route.id,
        "connection_id": connection.id,
        "runtime_config_version": connection.runtime_config_version,
        "provider_code": connection.provider_code,
        "target_kind": route.target_kind,
        "invoke_target": route.invoke_target,
        "catalog_model_id": route.catalog_model_id,
        "capability_metadata": {
            key: (route.metadata_json or {}).get(key)
            for key in (
                "type", "types", "features", "endpoints", "input_modalities",
                "output_modalities", "supported_parameters", "context_length",
                "max_output", "tool_call", "schema_checked", "reasoning",
            )
        },
    }
    payload = json.dumps(material, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def probe_valid(
    binding: LLMUseCaseRoute,
    route: LLMModelRoute,
    connection: LLMProviderConnection,
    *,
    now: datetime | None = None,
) -> bool:
    if binding.validated_fingerprint != validation_fingerprint(binding, route, connection):
        return False
    if binding.validated_at is None:
        return False
    checked_at = binding.validated_at
    if checked_at.tzinfo is None:
        checked_at = checked_at.replace(tzinfo=timezone.utc)
    return (now or datetime.now(timezone.utc)) - checked_at <= PROBE_MAX_AGE


def is_effective(
    binding: LLMUseCaseRoute,
    route: LLMModelRoute,
    connection: LLMProviderConnection,
    *,
    now: datetime | None = None,
) -> bool:
    return bool(
        binding.enabled and route.enabled and connection.enabled
        and route.target_available is not False and connection.credential_ciphertext
        and probe_valid(binding, route, connection, now=now)
    )


def eligible_routes(
    db: Session,
    use_case: str,
    *,
    model_id: int | None = None,
) -> list[tuple[LLMUseCaseRoute, LLMModelRoute, LLMProviderConnection, LLMModel]]:
    if use_case not in USE_CASES:
        raise ValueError("unknown use case")
    statement = (
        select(LLMUseCaseRoute, LLMModelRoute, LLMProviderConnection, LLMModel)
        .join(LLMModelRoute, LLMModelRoute.id == LLMUseCaseRoute.route_id)
        .join(LLMProviderConnection, LLMProviderConnection.id == LLMModelRoute.connection_id)
        .join(LLMModel, LLMModel.id == LLMModelRoute.model_id)
        .where(LLMUseCaseRoute.use_case == use_case)
        .order_by(LLMUseCaseRoute.priority, LLMUseCaseRoute.route_id)
    )
    if model_id is not None:
        statement = statement.where(LLMModel.id == model_id)
    return [row for row in db.execute(statement).all() if is_effective(*row[:3])]


def resolve(
    db: Session,
    use_case: str,
    *,
    model_id: int | None = None,
) -> RoutePlan | None:
    plans = resolve_candidates(db, use_case, model_id=model_id)
    return plans[0] if plans else None


def resolve_candidates(
    db: Session,
    use_case: str,
    *,
    model_id: int | None = None,
) -> list[RoutePlan]:
    """Freeze eligible routes for one logical model in priority order."""
    rows = eligible_routes(db, use_case, model_id=model_id)
    if not rows:
        return []
    selected_model_id = model_id if model_id is not None else rows[0][3].id
    plans = []
    for binding, route, connection, model in rows:
        if model.id != selected_model_id:
            continue
        plans.append(RoutePlan(
            use_case=use_case,
            route_id=route.id,
            model_id=model.id,
            display_name=model.display_name,
            provider_code=connection.provider_code,
            connection_id=connection.id,
            runtime_config_version=connection.runtime_config_version,
            target_kind=route.target_kind,
            invoke_target=route.invoke_target,
            protocol_code=binding.protocol_code,
            settings=dict(connection.settings_json or {}),
            credential_ciphertext=connection.credential_ciphertext,
            pricing=dict(route.pricing_json) if route.pricing_json else None,
            selection_source=("fallback" if plans else ("user" if model_id is not None else "default")),
        ))
    return plans
