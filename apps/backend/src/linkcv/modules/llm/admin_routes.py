from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, case, func, or_, select, update
from sqlalchemy.orm import Session

from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_admin
from linkcv.modules.identity.models import User
from linkcv.modules.llm.catalog import (
    CHAT_ADAPTERS,
    CHAT_CAPABILITY,
    assemble_model_identifier,
    chat_model_suggestions,
    normalize_model_call_name,
)
from linkcv.modules.llm.crypto import CredentialUnavailableError
from linkcv.modules.llm.dependencies import get_llm_service
from linkcv.modules.llm.models import (
    LLMCallLog,
    LLMCapabilityBinding,
    LLMModelConfig,
)
from linkcv.modules.llm.schemas import (
    CallLogListResponse,
    CallLogRecord,
    CallLogSummary,
    ChatCapabilityResponse,
    ChatCatalogAdapter,
    ChatCatalogResponse,
    LLMCallStatus,
    ModelActivationResponse,
    ModelConfigCreate,
    ModelConfigPatch,
    ModelConfigPatchResponse,
    ModelConfigRecord,
    ModelConfigResponse,
    ModelConnectionTestResponse,
    ModelLastTest,
)
from linkcv.modules.llm.service import LLMError, LLMService, RuntimeModelConfig

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


def require_config(
    db: Session,
    config_id: int,
    *,
    lock: bool = False,
) -> LLMModelConfig:
    statement = select(LLMModelConfig).where(
        LLMModelConfig.id == config_id,
        LLMModelConfig.capability == CHAT_CAPABILITY,
        LLMModelConfig.adapter.is_not(None),
        LLMModelConfig.model_call_name.is_not(None),
    )
    if lock:
        statement = statement.with_for_update()
    config = db.scalar(statement)
    if config is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    return config


def latest_tests(
    db: Session,
    config_ids: list[int],
) -> dict[int, LLMCallLog]:
    if not config_ids:
        return {}
    latest_ids = (
        select(func.max(LLMCallLog.id).label("id"))
        .where(
            LLMCallLog.model_config_id.in_(config_ids),
            LLMCallLog.source == "connection_test",
            LLMCallLog.status.in_(("succeeded", "failed", "cancelled")),
        )
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
    active_model_id: int | None,
    last_test: LLMCallLog | None,
) -> ModelConfigRecord:
    if config.adapter is None or config.model_call_name is None:
        raise ValueError("legacy model config cannot be exposed by the Chat API")
    return ModelConfigRecord(
        id=config.id,
        capability=CHAT_CAPABILITY,
        adapter=config.adapter,
        model=config.model_call_name,
        api_base=config.api_base,
        key_configured=config.encrypted_api_key is not None,
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


def capability_response(db: Session) -> ChatCapabilityResponse:
    binding = require_binding(db)
    configs = db.scalars(
        select(LLMModelConfig)
        .where(
            LLMModelConfig.capability == CHAT_CAPABILITY,
            LLMModelConfig.adapter.is_not(None),
            LLMModelConfig.model_call_name.is_not(None),
        )
        .order_by(LLMModelConfig.id.asc())
    ).all()
    tests = latest_tests(db, [config.id for config in configs])
    records = [
        model_record(
            config,
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


def encrypt_key(service: LLMService, value: str) -> str:
    try:
        return service.encrypt_credential(value)
    except CredentialUnavailableError as error:
        raise ApiError(503, "LLM_CREDENTIALS_UNAVAILABLE") from error


def proposed_values(
    config: LLMModelConfig,
    payload: ModelConfigPatch,
    service: LLMService,
) -> tuple[str, str, str, str | None, str | None]:
    fields = payload.model_fields_set
    adapter = payload.adapter if "adapter" in fields else config.adapter
    model_call_name = payload.model if "model" in fields else config.model_call_name
    if adapter is None or model_call_name is None:
        raise ApiError(400, "INVALID_LLM_MODEL_CONFIG")
    try:
        model_call_name = normalize_model_call_name(adapter, model_call_name)
        model_name = assemble_model_identifier(adapter, model_call_name)
    except ValueError as error:
        raise ApiError(400, "INVALID_LLM_MODEL_CONFIG") from error
    api_base = (
        str(payload.api_base) if payload.api_base is not None else None
    ) if "api_base" in fields else config.api_base
    encrypted_api_key = config.encrypted_api_key
    if "api_key" in fields:
        encrypted_api_key = (
            encrypt_key(service, payload.api_key.get_secret_value())
            if payload.api_key is not None
            else None
        )
    return adapter, model_call_name, model_name, api_base, encrypted_api_key


def runtime_snapshot(
    config: LLMModelConfig,
    values: tuple[str, str, str, str | None, str | None] | None = None,
) -> RuntimeModelConfig:
    if values is None:
        runtime = RuntimeModelConfig.from_record(config)
        if runtime is None:
            raise ApiError(404, "LLM_MODEL_NOT_FOUND")
        return runtime
    adapter, model_call_name, model_name, api_base, encrypted_api_key = values
    return RuntimeModelConfig(
        id=config.id,
        capability=CHAT_CAPABILITY,
        adapter=adapter,
        model_call_name=model_call_name,
        model_name=model_name,
        api_base=api_base,
        encrypted_api_key=encrypted_api_key,
        config_version=config.config_version,
    )


def apply_values(
    config: LLMModelConfig,
    values: tuple[str, str, str, str | None, str | None],
) -> None:
    adapter, model_call_name, model_name, api_base, encrypted_api_key = values
    config.adapter = adapter
    config.model_call_name = model_call_name
    config.model_name = model_name
    config.api_base = api_base
    config.encrypted_api_key = encrypted_api_key
    config.enabled = False
    config.priority = 100
    config.input_price_per_million = None
    config.output_price_per_million = None
    config.config_version += 1
    config.updated_at = utc_now()


def raise_service_error(error: LLMError) -> None:
    status = {
        "LLM_MODEL_NOT_FOUND": 404,
        "LLM_CREDENTIALS_UNAVAILABLE": 503,
    }.get(error.code, 502)
    raise ApiError(status, error.code, {"callId": error.call_id}) from error


@router.get("/capabilities/chat", response_model=ChatCapabilityResponse)
def get_chat_capability(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ChatCapabilityResponse:
    return capability_response(db)


@router.get("/catalog/chat", response_model=ChatCatalogResponse)
def get_chat_catalog(
    _admin: User = Depends(get_current_admin),
) -> ChatCatalogResponse:
    return ChatCatalogResponse(
        capability=CHAT_CAPABILITY,
        adapters=[
            ChatCatalogAdapter(
                code=adapter.code,
                label=adapter.label,
                requires_api_key=adapter.requires_api_key,
                models=chat_model_suggestions(adapter.code),
            )
            for adapter in CHAT_ADAPTERS
        ],
    )


@router.post("/models", response_model=ModelConfigResponse, status_code=201)
def create_model(
    payload: ModelConfigCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ModelConfigResponse:
    try:
        model_call_name = normalize_model_call_name(payload.adapter, payload.model)
        model_name = assemble_model_identifier(payload.adapter, model_call_name)
    except ValueError as error:
        raise ApiError(400, "INVALID_LLM_MODEL_CONFIG") from error
    encrypted_key = (
        encrypt_key(service, payload.api_key.get_secret_value())
        if payload.api_key is not None
        else None
    )
    now = utc_now()
    config = LLMModelConfig(
        capability=CHAT_CAPABILITY,
        adapter=payload.adapter,
        model_call_name=model_call_name,
        model_name=model_name,
        api_base=str(payload.api_base) if payload.api_base is not None else None,
        encrypted_api_key=encrypted_key,
        enabled=False,
        priority=100,
        input_price_per_million=None,
        output_price_per_million=None,
        config_version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return ModelConfigResponse(
        model=model_record(config, active_model_id=None, last_test=None)
    )


@router.patch("/models/{config_id}", response_model=ModelConfigPatchResponse)
async def update_model(
    config_id: str,
    payload: ModelConfigPatch,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ModelConfigPatchResponse:
    if not payload.model_fields_set:
        raise ApiError(400, "INVALID_LLM_MODEL_CONFIG")
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")

    binding = require_binding(db, lock=True)
    config = require_config(db, parsed_config_id, lock=True)
    values = proposed_values(config, payload, service)
    base_version = config.config_version
    is_active = binding.model_config_id == config.id
    if not is_active:
        apply_values(config, values)
        db.commit()
        db.refresh(config)
        tests = latest_tests(db, [config.id])
        return ModelConfigPatchResponse(
            model=model_record(
                config,
                active_model_id=binding.model_config_id,
                last_test=tests.get(config.id),
            )
        )

    proposed = runtime_snapshot(config, values)
    db.rollback()
    try:
        validation_call_id = await service.test_runtime_config(_admin.id, proposed)
    except LLMError as error:
        raise_service_error(error)

    binding = require_binding(db, lock=True)
    config = require_config(db, parsed_config_id, lock=True)
    if binding.model_config_id != config.id or config.config_version != base_version:
        db.rollback()
        raise ApiError(
            409,
            "LLM_MODEL_CONFIG_CHANGED",
            {"callId": validation_call_id},
        )
    apply_values(config, values)
    config.enabled = True
    db.commit()
    db.refresh(config)
    tests = latest_tests(db, [config.id])
    return ModelConfigPatchResponse(
        model=model_record(
            config,
            active_model_id=config.id,
            last_test=tests.get(config.id),
        ),
        validation_call_id=validation_call_id,
    )


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


@router.post("/models/{config_id}/activate", response_model=ModelActivationResponse)
async def activate_model(
    config_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ModelActivationResponse:
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")

    require_binding(db, lock=True)
    config = require_config(db, parsed_config_id, lock=True)
    snapshot = runtime_snapshot(config)
    base_version = config.config_version
    db.rollback()
    try:
        call_id = await service.test_runtime_config(admin.id, snapshot)
    except LLMError as error:
        raise_service_error(error)

    binding = require_binding(db, lock=True)
    config = require_config(db, parsed_config_id, lock=True)
    if config.config_version != base_version:
        db.rollback()
        raise ApiError(409, "LLM_MODEL_CONFIG_CHANGED", {"callId": call_id})
    binding.model_config_id = config.id
    binding.updated_at = utc_now()
    db.execute(
        update(LLMModelConfig)
        .where(LLMModelConfig.capability == CHAT_CAPABILITY)
        .values(enabled=False)
    )
    config.enabled = True
    db.commit()
    db.refresh(config)
    tests = latest_tests(db, [config.id])
    return ModelActivationResponse(
        active_model=model_record(
            config,
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
        model=row.model_call_name,
        status=row.status,
        metering_status=row.metering_status,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        input_price_per_million=row.input_price_per_million,
        output_price_per_million=row.output_price_per_million,
        estimated_cost_usd=row.estimated_cost,
        latency_ms=row.latency_ms,
        error_code=row.error_code,
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
