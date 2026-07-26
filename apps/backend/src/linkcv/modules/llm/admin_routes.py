from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_admin
from linkcv.modules.identity.models import User
from linkcv.modules.llm.crypto import CredentialUnavailableError
from linkcv.modules.llm.dependencies import get_llm_service
from linkcv.modules.llm.models import LLMCallLog, LLMModelConfig
from linkcv.modules.llm.schemas import (
    CallLogListResponse,
    CallLogRecord,
    CallLogSummary,
    ModelConfigCreate,
    ModelConfigListResponse,
    ModelConfigPatch,
    ModelConfigRecord,
    ModelConfigResponse,
    ModelConnectionTestResponse,
)
from linkcv.modules.llm.service import LLMError, LLMService

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


def model_record(config: LLMModelConfig) -> ModelConfigRecord:
    return ModelConfigRecord(
        id=config.id,
        model=config.model_name,
        api_base=config.api_base,
        enabled=config.enabled,
        priority=config.priority,
        input_price_per_million=config.input_price_per_million,
        output_price_per_million=config.output_price_per_million,
        key_configured=config.encrypted_api_key is not None,
        created_at=as_utc(config.created_at),
        updated_at=as_utc(config.updated_at),
    )


def require_config(db: Session, config_id: int) -> LLMModelConfig:
    config = db.get(LLMModelConfig, config_id)
    if config is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    return config


def encrypt_key(service: LLMService, value: str) -> str:
    try:
        return service.encrypt_credential(value)
    except CredentialUnavailableError as error:
        raise ApiError(503, "LLM_CREDENTIALS_UNAVAILABLE") from error


@router.get("/models", response_model=ModelConfigListResponse)
def list_models(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> ModelConfigListResponse:
    configs = db.scalars(
        select(LLMModelConfig).order_by(
            LLMModelConfig.priority.asc(), LLMModelConfig.id.asc()
        )
    ).all()
    return ModelConfigListResponse(models=[model_record(config) for config in configs])


@router.post("/models", response_model=ModelConfigResponse, status_code=201)
def create_model(
    payload: ModelConfigCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ModelConfigResponse:
    del admin
    encrypted_key = None
    if payload.api_key is not None:
        encrypted_key = encrypt_key(
            service, payload.api_key.get_secret_value()
        )
    now = utc_now()
    config = LLMModelConfig(
        model_name=payload.model,
        api_base=str(payload.api_base) if payload.api_base is not None else None,
        encrypted_api_key=encrypted_key,
        enabled=payload.enabled,
        priority=payload.priority,
        input_price_per_million=payload.input_price_per_million,
        output_price_per_million=payload.output_price_per_million,
        created_at=now,
        updated_at=now,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return ModelConfigResponse(model=model_record(config))


@router.patch("/models/{config_id}", response_model=ModelConfigResponse)
def update_model(
    config_id: str,
    payload: ModelConfigPatch,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> ModelConfigResponse:
    if not payload.model_fields_set:
        raise ApiError(400, "INVALID_LLM_MODEL_CONFIG")
    parsed_config_id = parse_id(config_id)
    if parsed_config_id is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    config = require_config(db, parsed_config_id)
    fields = payload.model_fields_set
    if "model" in fields:
        assert payload.model is not None
        config.model_name = payload.model
    if "api_base" in fields:
        config.api_base = str(payload.api_base) if payload.api_base is not None else None
    if "api_key" in fields:
        config.encrypted_api_key = (
            encrypt_key(service, payload.api_key.get_secret_value())
            if payload.api_key is not None
            else None
        )
    if "enabled" in fields:
        assert payload.enabled is not None
        config.enabled = payload.enabled
    if "priority" in fields:
        assert payload.priority is not None
        config.priority = payload.priority
    if "input_price_per_million" in fields:
        config.input_price_per_million = payload.input_price_per_million
    if "output_price_per_million" in fields:
        config.output_price_per_million = payload.output_price_per_million
    config.updated_at = utc_now()
    db.commit()
    db.refresh(config)
    return ModelConfigResponse(model=model_record(config))


@router.post(
    "/models/{config_id}/test",
    response_model=ModelConnectionTestResponse,
)
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
        status = {
            "LLM_MODEL_NOT_FOUND": 404,
            "LLM_CREDENTIALS_UNAVAILABLE": 503,
        }.get(error.code, 502)
        raise ApiError(status, error.code) from error
    return ModelConnectionTestResponse(ok=True, call_id=call_id)


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
        user_id=row.user_id,
        model_config_id=row.model_config_id,
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
        created_at=as_utc(row.created_at),
    )


def query_filters(
    *,
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
                (
                    (LLMCallLog.created_at == cursor_created_at)
                    & (LLMCallLog.id < cursor_id)
                ),
            )
        )
    rows = db.scalars(
        statement.order_by(LLMCallLog.created_at.desc(), LLMCallLog.id.desc()).limit(
            limit + 1
        )
    ).all()
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = (
        encode_cursor(page[-1].created_at, page[-1].id)
        if has_more and page
        else None
    )

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
            estimated_cost_usd=(
                Decimal(summary[4]) if summary[4] is not None else None
            ),
        ),
        next_cursor=next_cursor,
    )
