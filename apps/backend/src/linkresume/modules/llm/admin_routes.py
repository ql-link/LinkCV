from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import Select, case, delete as sql_delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.core.database import get_db, utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.identity.dependencies import get_current_admin
from linkresume.modules.identity.models import User
from linkresume.modules.llm.catalog import (
    CHAT_CAPABILITY,
    MODEL_CAPABILITIES,
    PI_AGENT_CAPABILITY,
    normalize_capability,
)
from linkresume.modules.llm.crypto import CredentialUnavailableError
from linkresume.modules.llm.dependencies import get_llm_service, get_pi_probe_coordinator
from linkresume.modules.llm.models import (
    LLMCallLog,
    LLMCapabilityBinding,
    LLMModelConfig,
    LLMModelValidation,
    LLMProvider,
    LLMProviderModel,
)
from linkresume.modules.llm.provider_catalog import (
    ProviderCatalogError,
    ProviderCatalogEntry,
    fetch_provider_catalog,
    replace_provider_catalog,
)
from linkresume.modules.llm.schemas import (
    CallLogListResponse,
    CallLogRecord,
    CallLogSummary,
    ChatCapabilityResponse,
    LLMCallStatus,
    ModelActivationResponse,
    ModelConfigCreate,
    ModelConfigPatch,
    ModelConfigPatchResponse,
    ModelConfigRecord,
    ModelConfigResponse,
    ModelConnectionTestResponse,
    ModelLastTest,
    ModelBindingRequest,
    ModelBindingResponse,
    CapabilityModelConfigRecord,
    ModelCapabilityListResponse,
    ModelCapabilityRecord,
    ModelCapabilityTestRequest,
    ModelValidationResponse,
    ProviderCapabilityRef,
    ProviderCatalogSyncResponse,
    ProviderCreate,
    ProviderListResponse,
    ProviderModelListResponse,
    ProviderModelRecord,
    ProviderPatch,
    ProviderPatchResponse,
    ProviderRecord,
    ProviderRef,
    ProviderResponse,
)
from linkresume.modules.llm.service import (
    LLMError,
    LLMService,
    ModelDefinition,
    RuntimeModelConfig,
)
from linkresume.modules.llm.pi_probe import PiProbeCoordinator, PiProbeError
from linkresume.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/admin/llm", tags=["llm-admin"])


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def parse_id(value: str) -> int | None:
    if not value.isdecimal():
        return None
    parsed = int(value)
    return parsed if parsed > 0 and str(parsed) == value else None


def require_binding(db: Session, *, lock: bool = False) -> LLMCapabilityBinding:
    statement = select(LLMCapabilityBinding).where(
        LLMCapabilityBinding.capability == CHAT_CAPABILITY
    )
    if lock:
        statement = statement.with_for_update()
    binding = db.scalar(statement)
    if binding is None:
        raise ApiError(503, "LLM_CHAT_NOT_CONFIGURED")
    return binding


def require_capability_binding(
    db: Session,
    capability: str,
    *,
    lock: bool = False,
) -> LLMCapabilityBinding:
    try:
        normalized = normalize_capability(capability)
    except ValueError as error:
        raise ApiError(404, "LLM_CAPABILITY_NOT_FOUND") from error
    statement = select(LLMCapabilityBinding).where(
        LLMCapabilityBinding.capability == normalized
    )
    if lock:
        statement = statement.with_for_update()
    binding = db.scalar(statement)
    if binding is None:
        raise ApiError(503, "LLM_MODEL_NOT_CONFIGURED")
    return binding


def require_config(
    db: Session,
    config_id: int,
    *,
    lock: bool = False,
) -> LLMModelConfig:
    statement = select(LLMModelConfig).where(LLMModelConfig.id == config_id)
    if lock:
        statement = statement.with_for_update()
    config = db.scalar(statement)
    if config is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    return config


def require_capability_config(
    db: Session,
    config_id: int,
    *,
    lock: bool = False,
) -> LLMModelConfig:
    statement = select(LLMModelConfig).where(LLMModelConfig.id == config_id)
    if lock:
        statement = statement.with_for_update()
    config = db.scalar(statement)
    if config is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    return config


def require_provider(
    db: Session,
    provider_id: int,
    *,
    lock: bool = False,
) -> LLMProvider:
    statement = select(LLMProvider).where(LLMProvider.id == provider_id)
    if lock:
        statement = statement.with_for_update()
    provider = db.scalar(statement)
    if provider is None:
        raise ApiError(404, "LLM_PROVIDER_NOT_FOUND")
    return provider


def catalog_entry(
    db: Session,
    provider_id: int,
    model_id: str,
) -> LLMProviderModel | None:
    return db.scalar(
        select(LLMProviderModel).where(
            LLMProviderModel.provider_id == provider_id,
            LLMProviderModel.model_id == model_id,
        )
    )


def require_catalog_entry(
    db: Session,
    provider_id: int,
    model_id: str,
) -> LLMProviderModel:
    entry = catalog_entry(db, provider_id, model_id)
    if entry is None:
        raise ApiError(400, "LLM_PROVIDER_MODEL_UNKNOWN")
    return entry


def provider_counts(db: Session, provider_ids: list[int]) -> dict[int, int]:
    if not provider_ids:
        return {}
    rows = db.execute(
        select(LLMProviderModel.provider_id, func.count(LLMProviderModel.id))
        .where(LLMProviderModel.provider_id.in_(provider_ids))
        .group_by(LLMProviderModel.provider_id)
    ).all()
    return {provider_id: count for provider_id, count in rows}


def provider_record(
    provider: LLMProvider,
    *,
    model_count: int,
) -> ProviderRecord:
    return ProviderRecord(
        id=provider.id,
        name=provider.name,
        base_url=provider.base_url,
        key_configured=bool(provider.encrypted_api_key),
        model_catalog_url=provider.model_catalog_url,
        model_count=model_count,
        price_sync_status=provider.price_sync_status,
        price_sync_error=provider.price_sync_error,
        price_synced_at=(
            as_utc(provider.price_synced_at) if provider.price_synced_at else None
        ),
        version=provider.version,
    )


def provider_records(db: Session, providers: list[LLMProvider]) -> list[ProviderRecord]:
    counts = provider_counts(db, [provider.id for provider in providers])
    return [
        provider_record(provider, model_count=counts.get(provider.id, 0))
        for provider in providers
    ]


def affected_capability_refs(
    db: Session,
    provider_id: int,
) -> list[ProviderCapabilityRef]:
    """Capability bindings that inherit this provider's connection settings."""
    rows = db.execute(
        select(
            LLMCapabilityBinding.capability,
            LLMModelConfig.id,
            LLMModelConfig.model_call_name,
        )
        .join(LLMModelConfig, LLMModelConfig.id == LLMCapabilityBinding.model_config_id)
        .where(LLMModelConfig.provider_id == provider_id)
        .order_by(LLMCapabilityBinding.capability.asc())
    ).all()
    return [
        ProviderCapabilityRef(
            capability=capability,
            model_config_id=config_id,
            model=model_call_name,
        )
        for capability, config_id, model_call_name in rows
    ]


def latest_tests(
    db: Session,
    config_ids: list[int],
    *,
    capability: str | None = None,
) -> dict[int, LLMCallLog]:
    if not config_ids:
        return {}
    filters = [
        LLMCallLog.model_config_id.in_(config_ids),
        LLMCallLog.source == "connection_test",
        LLMCallLog.status.in_(("succeeded", "failed", "cancelled")),
    ]
    if capability is not None:
        filters.append(LLMCallLog.capability == capability)
    latest_ids = (
        select(func.max(LLMCallLog.id).label("id"))
        .where(*filters)
        .group_by(LLMCallLog.model_config_id)
    )
    rows = db.scalars(select(LLMCallLog).where(LLMCallLog.id.in_(latest_ids))).all()
    return {
        row.model_config_id: row
        for row in rows
        if row.model_config_id is not None
    }


def model_record(
    config: LLMModelConfig,
    *,
    provider: LLMProvider,
    active_model_id: int | None,
    last_test: LLMCallLog | None,
) -> ModelConfigRecord:
    return ModelConfigRecord(
        id=config.id,
        capability=CHAT_CAPABILITY,
        provider=ProviderRef(id=provider.id, name=provider.name),
        model=config.model_call_name,
        key_configured=bool(provider.encrypted_api_key),
        active=config.id == active_model_id,
        last_test=(
            ModelLastTest(
                status=last_test.status,
                call_id=last_test.call_id,
                tested_at=as_utc(last_test.created_at),
            )
            if last_test is not None and last_test.status != "pending"
            else None
        ),
        created_at=as_utc(config.created_at),
        updated_at=as_utc(config.updated_at),
    )


def all_model_configs(db: Session) -> list[LLMModelConfig]:
    return list(
        db.scalars(
            select(LLMModelConfig).order_by(LLMModelConfig.id.asc())
        ).all()
    )


def providers_by_id(db: Session) -> dict[int, LLMProvider]:
    return {provider.id: provider for provider in db.scalars(select(LLMProvider)).all()}


def capability_response(db: Session) -> ChatCapabilityResponse:
    binding = require_binding(db)
    configs = all_model_configs(db)
    providers = providers_by_id(db)
    tests = latest_tests(
        db, [config.id for config in configs], capability=CHAT_CAPABILITY
    )
    records = [
        model_record(
            config,
            provider=providers[config.provider_id],
            active_model_id=binding.model_config_id,
            last_test=tests.get(config.id),
        )
        for config in configs
    ]
    active = next((record for record in records if record.active), None)
    return ChatCapabilityResponse(
        capability=CHAT_CAPABILITY,
        active_model_id=binding.model_config_id,
        active_model=active,
        models=records,
    )


def capability_model_record(
    config: LLMModelConfig,
    *,
    provider: LLMProvider,
    active_capabilities: list[str],
    last_test: LLMCallLog | None,
) -> CapabilityModelConfigRecord:
    return CapabilityModelConfigRecord(
        id=config.id,
        provider=ProviderRef(id=provider.id, name=provider.name),
        model=config.model_call_name,
        key_configured=bool(provider.encrypted_api_key),
        config_version=config.config_version,
        active_capabilities=sorted(
            capability for capability in active_capabilities
            if capability in MODEL_CAPABILITIES
        ),
        last_test=(
            ModelLastTest(
                status=last_test.status,
                call_id=last_test.call_id,
                tested_at=as_utc(last_test.created_at),
            )
            if last_test is not None and last_test.status != "pending"
            else None
        ),
        created_at=as_utc(config.created_at),
        updated_at=as_utc(config.updated_at),
    )


def capability_list_response(db: Session) -> ModelCapabilityListResponse:
    configs = all_model_configs(db)
    providers = providers_by_id(db)
    config_ids = [config.id for config in configs]
    tests_by_capability = {
        capability: latest_tests(db, config_ids, capability=capability)
        for capability in MODEL_CAPABILITIES
    }
    bindings = db.scalars(select(LLMCapabilityBinding)).all()
    active_by_config: dict[int, list[str]] = {}
    active_by_capability: dict[str, int | None] = {}
    binding_versions: dict[str, int] = {}
    for binding in bindings:
        active_by_capability[binding.capability] = binding.model_config_id
        binding_versions[binding.capability] = binding.binding_version
        if binding.model_config_id is not None:
            active_by_config.setdefault(binding.model_config_id, []).append(
                binding.capability
            )

    capabilities = []
    for capability in MODEL_CAPABILITIES:
        active_id = active_by_capability.get(capability)
        records = [
            capability_model_record(
                config,
                provider=providers[config.provider_id],
                active_capabilities=active_by_config.get(config.id, []),
                last_test=tests_by_capability[capability].get(config.id),
            )
            for config in configs
        ]
        records_by_capability = {int(record.id): record for record in records}
        capabilities.append(
            ModelCapabilityRecord(
                capability=capability,
                active_model_id=active_id,
                binding_version=binding_versions.get(capability, 1),
                active_model=(
                    records_by_capability.get(active_id) if active_id else None
                ),
                models=records,
            )
        )
    return ModelCapabilityListResponse(capabilities=capabilities)


def validation_for_call(
    db: Session,
    *,
    config: LLMModelConfig,
    capability: str,
    call_id: str,
    user_id: int,
) -> LLMModelValidation:
    call = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
    if call is None:
        raise ApiError(500, "LLM_VALIDATION_EVIDENCE_MISSING")
    validation = LLMModelValidation(
        model_config_id=config.id,
        config_version=config.config_version,
        capability=capability,
        probe_version=1,
        runtime_version="linkresume-llm-v1",
        call_id=call_id,
        status=call.status,
        error_code=call.error_code,
        created_by_user_id=user_id,
        created_at=utc_now(),
    )
    db.add(validation)
    db.flush()
    return validation


def encrypt_key(service: LLMService, value: str) -> str:
    try:
        return service.encrypt_credential(value)
    except CredentialUnavailableError as error:
        raise ApiError(503, "LLM_CREDENTIALS_UNAVAILABLE") from error


def runtime_snapshot(
    db: Session,
    config: LLMModelConfig,
    *,
    capability: str = CHAT_CAPABILITY,
    model_call_name: str | None = None,
) -> RuntimeModelConfig:
    """Resolve the callable model from its provider and catalog entry."""
    provider = require_provider(db, config.provider_id)
    resolved = model_call_name or config.model_call_name
    entry = catalog_entry(db, provider.id, resolved)
    if entry is None and model_call_name is not None:
        raise ApiError(400, "LLM_PROVIDER_MODEL_UNKNOWN")
    return RuntimeModelConfig(
        id=config.id,
        capability=capability,
        provider_id=provider.id,
        provider_name=provider.name,
        model_call_name=resolved,
        api_base=provider.base_url,
        encrypted_api_key=provider.encrypted_api_key,
        config_version=config.config_version,
        definition=ModelDefinition.from_catalog(resolved, entry),
    )


def apply_model_call_name(config: LLMModelConfig, model_call_name: str) -> None:
    config.model_call_name = model_call_name
    config.config_version += 1
    config.updated_at = utc_now()


def raise_service_error(error: LLMError) -> None:
    status = {
        "LLM_MODEL_NOT_FOUND": 404,
        "LLM_CREDENTIALS_UNAVAILABLE": 503,
    }.get(error.code, 502)
    raise ApiError(status, error.code, {"callId": error.call_id}) from error


def raise_pi_probe_error(error: PiProbeError) -> None:
    status = {
        "LLM_PI_AGENT_UNAVAILABLE": 503,
        "LLM_PI_AGENT_TIMEOUT": 504,
    }.get(error.code, 502)
    details = {"callId": error.call_id} if error.call_id else None
    raise ApiError(status, error.code, details) from error


@router.get("/capabilities", response_model=ModelCapabilityListResponse)
def get_capabilities(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ModelCapabilityListResponse:
    """Return the capability matrix without exposing encrypted credentials."""
    return capability_list_response(db)


@router.get("/providers", response_model=ProviderListResponse)
def list_providers(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ProviderListResponse:
    """List provider connections without exposing encrypted credentials."""
    providers = list(
        db.scalars(select(LLMProvider).order_by(LLMProvider.id.asc())).all()
    )
    return ProviderListResponse(providers=provider_records(db, providers))


@router.get("/capabilities/chat", response_model=ChatCapabilityResponse)
def get_chat_capability(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ChatCapabilityResponse:
    return capability_response(db)


def provider_model_record(row: LLMProviderModel) -> ProviderModelRecord:
    return ProviderModelRecord(
        model_id=row.model_id,
        display_name=row.display_name,
        context_length=row.context_length,
        max_output=row.max_output,
        input_modalities=row.input_modalities,
        supports_reasoning=row.supports_reasoning,
        input_price_per_million=row.input_price_per_million,
        output_price_per_million=row.output_price_per_million,
    )


def encode_model_cursor(model_id: str) -> str:
    return base64.urlsafe_b64encode(model_id.encode("utf-8")).decode("ascii").rstrip("=")


def decode_model_cursor(value: str) -> str:
    try:
        padding = "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(value + padding).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise ApiError(400, "INVALID_LLM_PROVIDER_QUERY") from error
    if not decoded:
        raise ApiError(400, "INVALID_LLM_PROVIDER_QUERY")
    return decoded


@router.post("/providers", response_model=ProviderResponse, status_code=201)
def create_provider(
    payload: ProviderCreate,
    request: Request,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ProviderResponse:
    if db.scalar(
        select(LLMProvider.id).where(LLMProvider.name == payload.name)
    ) is not None:
        raise ApiError(409, "LLM_PROVIDER_NAME_TAKEN")
    now = utc_now()
    provider = LLMProvider(
        name=payload.name,
        base_url=str(payload.base_url),
        encrypted_api_key=encrypt_key(
            service, payload.api_key.get_secret_value()
        ),
        model_catalog_url=str(payload.model_catalog_url),
        price_sync_status="unknown",
        price_sync_error=None,
        price_synced_at=None,
        version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(provider)
    try:
        db.commit()
    except IntegrityError as error:
        # Only the provider name is unique on this table; a concurrent insert
        # must surface as a conflict rather than a server error.
        db.rollback()
        raise ApiError(409, "LLM_PROVIDER_NAME_TAKEN") from error
    db.refresh(provider)
    bind_audit_target(request, provider.id)
    return ProviderResponse(provider=provider_record(provider, model_count=0))


@router.patch("/providers/{provider_id}", response_model=ProviderPatchResponse)
def update_provider(
    provider_id: str,
    payload: ProviderPatch,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ProviderPatchResponse:
    parsed_provider_id = parse_id(provider_id)
    if parsed_provider_id is None:
        raise ApiError(404, "LLM_PROVIDER_NOT_FOUND")
    provider = require_provider(db, parsed_provider_id, lock=True)
    if payload.base_version != provider.version:
        db.rollback()
        raise ApiError(409, "LLM_PROVIDER_CHANGED")
    fields = payload.model_fields_set
    name = payload.name
    if "name" in fields and name is not None and name != provider.name:
        if db.scalar(
            select(LLMProvider.id).where(
                LLMProvider.name == name,
                LLMProvider.id != provider.id,
            )
        ) is not None:
            db.rollback()
            raise ApiError(409, "LLM_PROVIDER_NAME_TAKEN")
        provider.name = name
    if "base_url" in fields and payload.base_url is not None:
        provider.base_url = str(payload.base_url)
    if "model_catalog_url" in fields and payload.model_catalog_url is not None:
        provider.model_catalog_url = str(payload.model_catalog_url)
    api_key = payload.api_key
    if "api_key" in fields and api_key is not None:
        provider.encrypted_api_key = encrypt_key(
            service, api_key.get_secret_value()
        )
    provider.version += 1
    provider.updated_at = utc_now()
    affected = affected_capability_refs(db, provider.id)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "LLM_PROVIDER_NAME_TAKEN") from error
    db.refresh(provider)
    return ProviderPatchResponse(
        provider=provider_record(
            provider,
            model_count=provider_counts(db, [provider.id]).get(provider.id, 0),
        ),
        affected_capabilities=affected,
    )


@router.delete("/providers/{provider_id}", status_code=204)
def delete_provider(
    provider_id: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> None:
    parsed_provider_id = parse_id(provider_id)
    if parsed_provider_id is None:
        raise ApiError(404, "LLM_PROVIDER_NOT_FOUND")
    provider = require_provider(db, parsed_provider_id, lock=True)
    if db.scalar(
        select(LLMModelConfig.id).where(
            LLMModelConfig.provider_id == provider.id
        )
    ) is not None:
        db.rollback()
        raise ApiError(409, "LLM_PROVIDER_IN_USE")
    db.execute(
        sql_delete(LLMProviderModel).where(
            LLMProviderModel.provider_id == provider.id
        )
    )
    db.delete(provider)
    db.commit()


@router.post(
    "/providers/{provider_id}/catalog:sync",
    response_model=ProviderCatalogSyncResponse,
)
async def sync_provider_catalog(
    provider_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ProviderCatalogSyncResponse:
    parsed_provider_id = parse_id(provider_id)
    if parsed_provider_id is None:
        raise ApiError(404, "LLM_PROVIDER_NOT_FOUND")
    provider = require_provider(db, parsed_provider_id)
    try:
        api_key = await service.provider_api_key(
            provider.id, provider.encrypted_api_key
        )
    except LLMError as error:
        raise_service_error(error)
    catalog_url = provider.model_catalog_url
    timeout_seconds = request.app.state.settings.llm_timeout_seconds
    try:
        entries: tuple[ProviderCatalogEntry, ...] = await fetch_provider_catalog(
            catalog_url=catalog_url,
            api_key=api_key,
            timeout_seconds=timeout_seconds,
        )
    except ProviderCatalogError as error:
        # A failed sync must leave the previous snapshot untouched.
        provider.price_sync_status = "failed"
        provider.price_sync_error = error.code
        provider.updated_at = utc_now()
        db.commit()
        raise ApiError(502, error.code) from error

    synced_at = utc_now()
    model_count = replace_provider_catalog(
        db, provider, entries, synced_at=synced_at
    )
    provider.price_sync_status = "succeeded"
    provider.price_sync_error = None
    provider.price_synced_at = synced_at
    provider.updated_at = synced_at
    db.commit()
    return ProviderCatalogSyncResponse(
        synced_at=as_utc(synced_at),
        model_count=model_count,
    )


@router.get(
    "/providers/{provider_id}/models",
    response_model=ProviderModelListResponse,
)
def list_provider_models(
    provider_id: str,
    query: str | None = Query(default=None, max_length=128),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ProviderModelListResponse:
    parsed_provider_id = parse_id(provider_id)
    if parsed_provider_id is None:
        raise ApiError(404, "LLM_PROVIDER_NOT_FOUND")
    require_provider(db, parsed_provider_id)
    statement = select(LLMProviderModel).where(
        LLMProviderModel.provider_id == parsed_provider_id
    )
    if query is not None and query.strip():
        pattern = f"%{query.strip()}%"
        statement = statement.where(
            or_(
                LLMProviderModel.model_id.like(pattern),
                LLMProviderModel.display_name.like(pattern),
            )
        )
    if cursor is not None:
        statement = statement.where(
            LLMProviderModel.model_id > decode_model_cursor(cursor)
        )
    rows = db.scalars(
        statement.order_by(LLMProviderModel.model_id.asc()).limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    page = rows[:limit]
    return ProviderModelListResponse(
        models=[provider_model_record(row) for row in page],
        next_cursor=(
            encode_model_cursor(page[-1].model_id) if has_more and page else None
        ),
    )


@router.put(
    "/capabilities/{capability}/binding",
    response_model=ModelBindingResponse,
)
async def bind_capability(
    capability: str,
    payload: ModelBindingRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
    pi_probe: PiProbeCoordinator = Depends(get_pi_probe_coordinator),
) -> ModelBindingResponse:
    admin_id = admin.id
    try:
        normalized_capability = normalize_capability(capability)
    except ValueError as error:
        raise ApiError(404, "LLM_CAPABILITY_NOT_FOUND") from error
    parsed_config_id = parse_id(payload.model_config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    binding = require_capability_binding(db, normalized_capability, lock=True)
    expected_binding_version = payload.base_binding_version or binding.binding_version
    if expected_binding_version != binding.binding_version:
        db.rollback()
        raise ApiError(409, "LLM_BINDING_CHANGED")
    config = require_capability_config(db, parsed_config_id, lock=True)
    expected_config_version = config.config_version
    if (
        payload.base_config_version is not None
        and payload.base_config_version != expected_config_version
    ):
        db.rollback()
        raise ApiError(409, "LLM_MODEL_CONFIG_CHANGED")
    snapshot = runtime_snapshot(db, config, capability=normalized_capability)
    db.rollback()
    try:
        call_id = (
            await service.test_external_runtime_config(
                admin_id,
                snapshot,
                invoke=lambda api_key: pi_probe.run_probe(snapshot, api_key),
            )
            if normalized_capability == PI_AGENT_CAPABILITY
            else await service.test_runtime_config(admin_id, snapshot)
        )
    except PiProbeError as error:
        raise_pi_probe_error(error)
    except LLMError as error:
        raise_service_error(error)

    binding = require_capability_binding(db, normalized_capability, lock=True)
    config = require_capability_config(db, parsed_config_id, lock=True)
    if binding.binding_version != expected_binding_version:
        db.rollback()
        raise ApiError(409, "LLM_BINDING_CHANGED", {"callId": call_id})
    if config.config_version != expected_config_version:
        db.rollback()
        raise ApiError(409, "LLM_MODEL_CONFIG_CHANGED", {"callId": call_id})
    validation = validation_for_call(
        db,
        config=config,
        capability=normalized_capability,
        call_id=call_id,
        user_id=admin_id,
    )
    binding.model_config_id = config.id
    binding.validation_id = validation.id
    binding.binding_version += 1
    binding.updated_at = utc_now()
    db.commit()
    db.refresh(binding)
    records = capability_list_response(db)
    active = next(
        (
            entry.active_model
            for entry in records.capabilities
            if entry.capability == normalized_capability
        ),
        None,
    )
    if active is None:
        raise ApiError(500, "LLM_BINDING_RESPONSE_INVALID")
    return ModelBindingResponse(
        capability=normalized_capability,
        active_model_id=config.id,
        binding_version=binding.binding_version,
        validation_id=str(validation.id),
        call_id=call_id,
        active_model=active,
    )


@router.post("/models", response_model=ModelConfigResponse, status_code=201)
def create_model(
    payload: ModelConfigCreate,
    request: Request,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ModelConfigResponse:
    parsed_provider_id = parse_id(payload.provider_id)
    if parsed_provider_id is None:
        raise ApiError(404, "LLM_PROVIDER_NOT_FOUND")
    provider = require_provider(db, parsed_provider_id)
    model_call_name = payload.model
    require_catalog_entry(db, provider.id, model_call_name)
    if db.scalar(
        select(LLMModelConfig.id).where(
            LLMModelConfig.provider_id == provider.id,
            LLMModelConfig.model_call_name == model_call_name,
        )
    ) is not None:
        raise ApiError(409, "LLM_MODEL_ALREADY_EXISTS")
    now = utc_now()
    config = LLMModelConfig(
        provider_id=provider.id,
        model_call_name=model_call_name,
        config_version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    bind_audit_target(request, config.id)
    return ModelConfigResponse(
        model=model_record(
            config,
            provider=provider,
            active_model_id=None,
            last_test=None,
        )
    )


@router.patch("/models/{config_id}", response_model=ModelConfigPatchResponse)
def update_model(
    config_id: str,
    payload: ModelConfigPatch,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ModelConfigPatchResponse:
    if not payload.model_fields_set:
        raise ApiError(400, "INVALID_LLM_MODEL_CONFIG")
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")

    binding = require_binding(db, lock=True)
    config = require_config(db, parsed_config_id, lock=True)
    if db.scalar(
        select(LLMCapabilityBinding.capability).where(
            LLMCapabilityBinding.model_config_id == config.id
        )
    ) is not None:
        db.rollback()
        raise ApiError(409, "LLM_MODEL_IN_USE")
    expected_config_version = payload.base_config_version or config.config_version
    if expected_config_version != config.config_version:
        db.rollback()
        raise ApiError(409, "LLM_MODEL_CONFIG_CHANGED")
    provider = require_provider(db, config.provider_id)
    requested_model = payload.model
    if "model" in payload.model_fields_set and requested_model is not None:
        if requested_model != config.model_call_name:
            require_catalog_entry(db, provider.id, requested_model)
            if db.scalar(
                select(LLMModelConfig.id).where(
                    LLMModelConfig.provider_id == provider.id,
                    LLMModelConfig.model_call_name == requested_model,
                    LLMModelConfig.id != config.id,
                )
            ) is not None:
                db.rollback()
                raise ApiError(409, "LLM_MODEL_ALREADY_EXISTS")
            apply_model_call_name(config, requested_model)
    db.commit()
    db.refresh(config)
    tests = latest_tests(db, [config.id], capability=CHAT_CAPABILITY)
    return ModelConfigPatchResponse(
        model=model_record(
            config,
            provider=provider,
            active_model_id=binding.model_config_id,
            last_test=tests.get(config.id),
        )
    )


@router.delete("/models/{config_id}", status_code=204)
def delete_model(
    config_id: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> None:
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    # Binding writes lock a capability row before the candidate. Lock the
    # low-cardinality binding set in the same order so delete cannot race a bind.
    bindings = db.scalars(
        select(LLMCapabilityBinding)
        .order_by(LLMCapabilityBinding.capability.asc())
        .with_for_update()
    ).all()
    config = require_capability_config(db, parsed_config_id, lock=True)
    if any(binding.model_config_id == config.id for binding in bindings):
        db.rollback()
        raise ApiError(409, "LLM_MODEL_IN_USE")
    db.execute(
        sql_delete(LLMModelValidation).where(
            LLMModelValidation.model_config_id == config.id
        )
    )
    db.execute(
        update(LLMCallLog)
        .where(LLMCallLog.model_config_id == config.id)
        .values(model_config_id=None)
    )
    db.delete(config)
    db.commit()


@router.post("/models/{config_id}/test", response_model=ModelConnectionTestResponse)
async def test_model(
    config_id: str,
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ModelConnectionTestResponse:
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    try:
        call_id = await service.test_config(admin.id, parsed_config_id)
    except LLMError as error:
        raise_service_error(error)
    return ModelConnectionTestResponse(call_id=call_id)


@router.post(
    "/models/{config_id}/tests",
    response_model=ModelValidationResponse,
)
async def test_model_capability(
    config_id: str,
    payload: ModelCapabilityTestRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
    pi_probe: PiProbeCoordinator = Depends(get_pi_probe_coordinator),
) -> ModelValidationResponse:
    admin_id = admin.id
    try:
        normalized_capability = normalize_capability(payload.capability)
    except ValueError as error:
        raise ApiError(404, "LLM_CAPABILITY_NOT_FOUND") from error
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    config = require_capability_config(db, parsed_config_id, lock=True)
    expected_config_version = payload.base_config_version or config.config_version
    if expected_config_version != config.config_version:
        db.rollback()
        raise ApiError(409, "LLM_MODEL_CONFIG_CHANGED")
    snapshot = runtime_snapshot(db, config, capability=normalized_capability)
    db.rollback()
    try:
        call_id = (
            await service.test_external_runtime_config(
                admin_id,
                snapshot,
                invoke=lambda api_key: pi_probe.run_probe(snapshot, api_key),
            )
            if normalized_capability == PI_AGENT_CAPABILITY
            else await service.test_runtime_config(admin_id, snapshot)
        )
    except PiProbeError as error:
        raise_pi_probe_error(error)
    except LLMError as error:
        raise_service_error(error)
    config = require_capability_config(db, parsed_config_id, lock=True)
    if config.config_version != expected_config_version:
        db.rollback()
        raise ApiError(409, "LLM_MODEL_CONFIG_CHANGED", {"callId": call_id})
    validation = validation_for_call(
        db,
        config=config,
        capability=normalized_capability,
        call_id=call_id,
        user_id=admin_id,
    )
    db.commit()
    return ModelValidationResponse(
        capability=normalized_capability,
        validation_id=str(validation.id),
        call_id=call_id,
        config_version=config.config_version,
    )


@router.post("/models/{config_id}/activate", response_model=ModelActivationResponse)
async def activate_model(
    config_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ModelActivationResponse:
    admin_id = admin.id
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")

    require_binding(db, lock=True)
    config = require_config(db, parsed_config_id, lock=True)
    provider = require_provider(db, config.provider_id)
    snapshot = runtime_snapshot(db, config)
    base_version = config.config_version
    db.rollback()
    try:
        call_id = await service.test_runtime_config(admin_id, snapshot)
    except LLMError as error:
        raise_service_error(error)

    binding = require_binding(db, lock=True)
    config = require_config(db, parsed_config_id, lock=True)
    provider = require_provider(db, config.provider_id)
    if config.config_version != base_version:
        db.rollback()
        raise ApiError(409, "LLM_MODEL_CONFIG_CHANGED", {"callId": call_id})
    validation = validation_for_call(
        db,
        config=config,
        capability=CHAT_CAPABILITY,
        call_id=call_id,
        user_id=admin_id,
    )
    binding.model_config_id = config.id
    binding.validation_id = validation.id
    binding.binding_version += 1
    binding.updated_at = utc_now()
    db.commit()
    db.refresh(config)
    tests = latest_tests(db, [config.id], capability=CHAT_CAPABILITY)
    return ModelActivationResponse(
        active_model=model_record(
            config,
            provider=provider,
            active_model_id=config.id,
            last_test=tests.get(config.id),
        ),
        call_id=call_id,
    )


def encode_cursor(created_at: datetime, row_id: int) -> str:
    created_at = as_utc(created_at)
    payload = json.dumps(
        {"createdAt": created_at.isoformat(), "id": row_id},
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_cursor(value: str) -> tuple[datetime, int]:
    try:
        padding = "=" * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(value + padding))
        created_at = datetime.fromisoformat(payload["createdAt"])
        row_id = payload["id"]
        if created_at.tzinfo is None or not isinstance(row_id, int) or row_id < 1:
            raise ValueError
        return created_at.astimezone(timezone.utc), row_id
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ApiError(400, "INVALID_LLM_CALL_QUERY") from error


def call_record(row: LLMCallLog) -> CallLogRecord:
    return CallLogRecord(
        call_id=row.call_id,
        capability=row.capability,
        source=row.source,
        user_id=row.user_id,
        model_config_id=row.model_config_id,
        adapter=row.adapter,
        model=row.model_name,
        status=row.status,
        metering_status=row.metering_status,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        input_price_per_million=row.input_price_per_million,
        output_price_per_million=row.output_price_per_million,
        estimated_cost_usd=row.estimated_cost,
        latency_ms=row.latency_ms,
        error_code=row.error_code,
        model_config_version=row.model_config_version,
        created_at=as_utc(row.created_at),
    )


def query_filters(
    *,
    source: str | None,
    status: LLMCallStatus | None,
    call_id: str | None,
    user_id: int | None,
    model_config_id: int | None,
    from_at: datetime | None,
    to_at: datetime | None,
) -> list[object]:
    if from_at is not None and from_at.tzinfo is None:
        raise ApiError(400, "INVALID_LLM_CALL_QUERY")
    if to_at is not None and to_at.tzinfo is None:
        raise ApiError(400, "INVALID_LLM_CALL_QUERY")
    if from_at is not None:
        from_at = from_at.astimezone(timezone.utc)
    if to_at is not None:
        to_at = to_at.astimezone(timezone.utc)
    if from_at is not None and to_at is not None and from_at >= to_at:
        raise ApiError(400, "INVALID_LLM_CALL_QUERY")

    filters: list[object] = []
    if source is not None:
        filters.append(LLMCallLog.source == source)
    if status is not None:
        filters.append(LLMCallLog.status == status)
    if call_id is not None:
        filters.append(LLMCallLog.call_id == call_id)
    if user_id is not None:
        filters.append(LLMCallLog.user_id == user_id)
    if model_config_id is not None:
        filters.append(LLMCallLog.model_config_id == model_config_id)
    if from_at is not None:
        filters.append(LLMCallLog.created_at >= from_at)
    if to_at is not None:
        filters.append(LLMCallLog.created_at < to_at)
    return filters


@router.get("/calls", response_model=CallLogListResponse)
def list_calls(
    source: str | None = Query(default=None, pattern=r"^[a-z][a-z0-9_]{0,31}$"),
    status: LLMCallStatus | None = None,
    call_id: str | None = Query(default=None, alias="callId", min_length=1, max_length=40),
    user_id: int | None = Query(default=None, alias="userId", ge=1),
    model_config_id: str | None = Query(default=None, alias="modelConfigId"),
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> CallLogListResponse:
    parsed_model_config_id = None
    if model_config_id is not None:
        parsed_model_config_id = parse_id(model_config_id)
        if parsed_model_config_id is None:
            raise ApiError(400, "INVALID_LLM_CALL_QUERY")
    filters = query_filters(
        source=source,
        status=status,
        call_id=call_id,
        user_id=user_id,
        model_config_id=parsed_model_config_id,
        from_at=from_at,
        to_at=to_at,
    )
    statement: Select[tuple[LLMCallLog]] = select(LLMCallLog).where(*filters)
    if cursor is not None:
        cursor_created_at, cursor_id = decode_cursor(cursor)
        statement = statement.where(
            or_(
                LLMCallLog.created_at < cursor_created_at,
                (LLMCallLog.created_at == cursor_created_at) & (LLMCallLog.id < cursor_id),
            )
        )
    rows = db.scalars(
        statement.order_by(LLMCallLog.created_at.desc(), LLMCallLog.id.desc()).limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].created_at, page[-1].id) if has_more and page else None

    summary = db.execute(
        select(
            func.count(LLMCallLog.id),
            func.sum(case((LLMCallLog.metering_status != "complete", 1), else_=0)),
            func.sum(LLMCallLog.input_tokens),
            func.sum(LLMCallLog.output_tokens),
            func.sum(LLMCallLog.estimated_cost),
        ).where(*filters)
    ).one()
    return CallLogListResponse(
        calls=[call_record(row) for row in page],
        summary=CallLogSummary(
            call_count=summary[0] or 0,
            incomplete_metering_count=summary[1] or 0,
            input_tokens=summary[2],
            output_tokens=summary[3],
            estimated_cost_usd=Decimal(summary[4]) if summary[4] is not None else None,
        ),
        next_cursor=next_cursor,
    )
