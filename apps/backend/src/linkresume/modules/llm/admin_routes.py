"""Administrator model governance. All write paths preserve route identity."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.core.database import get_db, utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.admin_insights.llm import cost_totals
from linkresume.modules.admin_insights.window import resolve_window
from linkresume.modules.agent.models import AgentRun, AgentSession
from linkresume.modules.identity.dependencies import get_current_admin
from linkresume.modules.identity.models import User
from linkresume.modules.llm.catalog import CATALOG_URLS, fetch_catalog
from linkresume.modules.llm.crypto import CredentialUnavailableError
from linkresume.modules.llm.dependencies import get_llm_service, get_pi_probe_coordinator
from linkresume.modules.llm.models import (
    LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute,
)
from linkresume.modules.llm.pi_probe import PiProbeCoordinator
from linkresume.modules.llm.providers import (
    PROVIDERS, validate_route, validate_settings, validate_use_case_protocol,
)
from linkresume.modules.llm.resolver import (
    USE_CASES, eligible_routes, is_effective, probe_valid,
)
from linkresume.modules.llm.schemas import (
    ConnectionCreate, ConnectionPatch, LogicalModelCreate, LogicalModelPatch,
    RouteCreate, RoutePatch, UseCaseBindingPatch, UseCaseBindingWrite,
)
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/admin/llm", tags=["llm-admin"])


def _id(value: str) -> int:
    if not value.isascii() or not value.isdecimal() or int(value) <= 0:
        raise ApiError(404, "LLM_RESOURCE_NOT_FOUND")
    return int(value)


def _connection(db: Session, value: str, *, lock: bool = False) -> LLMProviderConnection:
    statement = select(LLMProviderConnection).where(LLMProviderConnection.id == _id(value))
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        raise ApiError(404, "LLM_CONNECTION_NOT_FOUND")
    return row


def _model(db: Session, value: str) -> LLMModel:
    row = db.get(LLMModel, _id(value))
    if row is None:
        raise ApiError(404, "LLM_MODEL_NOT_FOUND")
    return row


def _route(db: Session, value: str, *, lock: bool = False) -> LLMModelRoute:
    statement = select(LLMModelRoute).where(LLMModelRoute.id == _id(value))
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        raise ApiError(404, "LLM_ROUTE_NOT_FOUND")
    return row


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "LLM_CONFLICT") from error


def _referenced_route_ids(db: Session, route_ids: list[int]) -> set[int]:
    """Routes that bindings or call/run history still point at; those are never deleted."""
    if not route_ids:
        return set()
    referenced: set[int] = set()
    for column in (LLMUseCaseRoute.route_id, LLMCallLog.route_id, AgentRun.resolved_llm_route_id):
        referenced.update(db.scalars(select(column).where(column.in_(route_ids)).distinct()))
    return referenced


def _model_referenced(db: Session, model_id: int) -> bool:
    for column in (AgentSession.selected_llm_model_id, AgentRun.resolved_llm_model_id):
        if db.scalar(select(column).where(column == model_id).limit(1)) is not None:
            return True
    return False


def _delete_routes(db: Session, routes: list[LLMModelRoute], error_code: str) -> None:
    if _referenced_route_ids(db, [route.id for route in routes]):
        raise ApiError(409, error_code)
    for route in routes:
        db.delete(route)
    # Flush child rows first so the parent delete never trips the RESTRICT foreign keys;
    # a reference written concurrently after the check is still caught by those keys.
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, error_code) from error


def _bundle(service: LLMService, row: LLMProviderConnection) -> dict[str, str]:
    if row.credential_ciphertext is None:
        raise ApiError(503, "LLM_CREDENTIALS_UNAVAILABLE")
    try:
        value = json.loads(service._cipher.decrypt(row.credential_ciphertext).plaintext)
    except (CredentialUnavailableError, ValueError, TypeError) as error:
        raise ApiError(503, "LLM_CREDENTIALS_UNAVAILABLE") from error
    if not isinstance(value, dict) or not isinstance(value.get("api_key"), str):
        raise ApiError(503, "LLM_CREDENTIALS_UNAVAILABLE")
    return value


def _connection_record(row: LLMProviderConnection) -> dict:
    return {
        "id": str(row.id),
        "providerCode": row.provider_code,
        "name": row.name,
        "settings": row.settings_json or {},
        "keyConfigured": row.credential_ciphertext is not None,
        "enabled": row.enabled,
        "runtimeConfigVersion": row.runtime_config_version,
        "catalogSyncedAt": row.catalog_synced_at,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }


def _model_record(row: LLMModel) -> dict:
    return {
        "id": str(row.id),
        "displayName": row.display_name,
        "developerName": row.developer_name,
        "userSelectable": bool(row.user_selectable),
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }


def _route_record(row: LLMModelRoute) -> dict:
    return {
        "id": str(row.id),
        "modelId": str(row.model_id),
        "connectionId": str(row.connection_id),
        "targetKind": row.target_kind,
        "invokeTarget": row.invoke_target,
        "catalogModelId": row.catalog_model_id,
        "identifierKind": row.identifier_kind,
        "origin": row.origin,
        "metadata": row.metadata_json,
        "pricing": row.pricing_json,
        "targetAvailable": row.target_available,
        "enabled": row.enabled,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }


def _binding_record(
    row: LLMUseCaseRoute, route: LLMModelRoute, connection: LLMProviderConnection,
) -> dict:
    return {
        "useCase": row.use_case,
        "routeId": str(row.route_id),
        "protocolCode": row.protocol_code,
        "priority": row.priority,
        "enabled": row.enabled,
        "validatedAt": row.validated_at,
        "effective": is_effective(row, route, connection),
    }


@router.get("/catalog")
def catalog(_: User = Depends(get_current_admin)) -> dict:
    return {
        "useCases": list(USE_CASES),
        "providers": [
            {
                "code": spec.code,
                "label": spec.label,
                "protocols": sorted(spec.protocols),
                "targetKinds": sorted(spec.target_kinds),
                "catalogSync": spec.code in CATALOG_URLS,
            }
            for spec in PROVIDERS.values()
        ],
    }


@router.get("/connections")
def connections(
    db: Session = Depends(get_db), _: User = Depends(get_current_admin),
) -> dict:
    rows = db.scalars(select(LLMProviderConnection).order_by(LLMProviderConnection.id)).all()
    return {"connections": [_connection_record(row) for row in rows]}


@router.post("/connections", status_code=201)
def create_connection(
    payload: ConnectionCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> dict:
    try:
        settings = validate_settings(payload.provider_code, payload.settings)
        bundle = {"api_key": payload.api_key.get_secret_value()}
        if not bundle["api_key"].strip():
            raise ValueError("empty API key")
        ciphertext = service.encrypt_credential(json.dumps(bundle))
    except (ValueError, CredentialUnavailableError) as error:
        raise ApiError(422, "LLM_CONNECTION_INVALID") from error
    row = LLMProviderConnection(
        provider_code=payload.provider_code,
        name=payload.name.strip(),
        credential_ciphertext=ciphertext,
        settings_json=settings,
        enabled=payload.enabled,
        runtime_config_version=1,
    )
    db.add(row)
    _commit(db)
    bind_audit_target(request, row.id)
    return {"connection": _connection_record(row)}


@router.patch("/connections/{connection_id}")
def patch_connection(
    connection_id: str,
    payload: ConnectionPatch,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> dict:
    row = _connection(db, connection_id, lock=True)
    if row.runtime_config_version != payload.base_version:
        raise ApiError(409, "LLM_CONFIG_CHANGED")
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.enabled is not None:
        row.enabled = payload.enabled
    runtime_changed = False
    if payload.settings is not None:
        try:
            settings = validate_settings(row.provider_code, payload.settings)
        except ValueError as error:
            raise ApiError(422, "LLM_CONNECTION_INVALID") from error
        if settings != (row.settings_json or {}):
            row.settings_json = settings
            row.catalog_state_json = None
            row.catalog_synced_at = None
            runtime_changed = True
    if payload.api_key is not None:
        bundle = _bundle(service, row)
        key = payload.api_key.get_secret_value()
        if not key.strip():
            raise ApiError(422, "LLM_CONNECTION_INVALID")
        if bundle.get("api_key") != key:
            bundle["api_key"] = key
            runtime_changed = True
            row.catalog_state_json = None
            row.catalog_synced_at = None
        try:
            row.credential_ciphertext = service.encrypt_credential(json.dumps(bundle))
        except CredentialUnavailableError as error:
            raise ApiError(503, "LLM_CREDENTIALS_UNAVAILABLE") from error
    if runtime_changed:
        row.runtime_config_version += 1
    row.updated_at = utc_now()
    _commit(db)
    bind_audit_target(request, row.id)
    return {"connection": _connection_record(row)}


@router.delete("/connections/{connection_id}", status_code=204)
def delete_connection(
    connection_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> None:
    row = _connection(db, connection_id, lock=True)
    # Its unused routes go with it; logical models stay, they may be served by other connections.
    routes = db.scalars(
        select(LLMModelRoute).where(LLMModelRoute.connection_id == row.id).with_for_update()
    ).all()
    _delete_routes(db, list(routes), "LLM_CONNECTION_IN_USE")
    db.delete(row)
    _commit(db)
    bind_audit_target(request, row.id)


@router.post("/connections/{connection_id}/sync")
async def sync_connection_catalog(
    connection_id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
) -> dict:
    row = _connection(db, connection_id)
    if row.provider_code not in CATALOG_URLS:
        raise ApiError(422, "LLM_CATALOG_UNSUPPORTED")
    bundle = _bundle(service, row)
    version = row.runtime_config_version
    state = row.catalog_state_json or {}
    provider_code = row.provider_code
    settings = row.settings_json
    db.rollback()  # Release the read transaction before the network request.
    try:
        result = await fetch_catalog(
            provider_code, bundle["api_key"], settings=settings, etag=state.get("etag"),
        )
    except (httpx.HTTPError, ValueError) as error:
        raise ApiError(502, "LLM_CATALOG_UNAVAILABLE") from error
    row = _connection(db, connection_id, lock=True)
    if row.runtime_config_version != version or row.provider_code != provider_code:
        raise ApiError(409, "LLM_CONFIG_CHANGED")
    if result.models is not None:
        existing = {
            item.invoke_target: item
            for item in db.scalars(
                select(LLMModelRoute).where(
                    LLMModelRoute.connection_id == row.id,
                    LLMModelRoute.target_kind == "model",
                )
            )
        }
        found: set[str] = set()
        for item in result.models:
            found.add(item.model_id)
            route = existing.get(item.model_id)
            if route is None:
                model = LLMModel(display_name=item.name, developer_name=item.developer)
                db.add(model)
                db.flush()
                route = LLMModelRoute(
                    model_id=model.id, connection_id=row.id, target_kind="model",
                    invoke_target=item.model_id, catalog_model_id=item.model_id,
                    identifier_kind="unknown", origin="catalog", enabled=False,
                )
                db.add(route)
            route.metadata_json = item.metadata
            route.pricing_json = item.pricing
            route.target_available = True
        for target, route in existing.items():
            if route.origin == "catalog" and target not in found:
                route.target_available = False
    row.catalog_state_json = {"etag": result.etag} if result.etag else None
    row.catalog_synced_at = utc_now()
    _commit(db)
    bind_audit_target(request, row.id)
    return {"synced": len(result.models) if result.models is not None else 0,
            "unchanged": result.models is None}


@router.get("/models")
def models(
    db: Session = Depends(get_db), _: User = Depends(get_current_admin),
) -> dict:
    rows = db.scalars(select(LLMModel).order_by(LLMModel.id)).all()
    return {"models": [_model_record(row) for row in rows]}


@router.post("/models", status_code=201)
def create_model(
    payload: LogicalModelCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    row = LLMModel(
        display_name=payload.display_name.strip(),
        developer_name=payload.developer_name.strip() if payload.developer_name else None,
        user_selectable=payload.user_selectable,
    )
    db.add(row)
    _commit(db)
    bind_audit_target(request, row.id)
    return {"model": _model_record(row)}


@router.patch("/models/{model_id}")
def patch_model(
    model_id: str,
    payload: LogicalModelPatch,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    row = _model(db, model_id)
    if payload.display_name is not None:
        row.display_name = payload.display_name.strip()
    if "developer_name" in payload.model_fields_set:
        row.developer_name = payload.developer_name.strip() if payload.developer_name else None
    if payload.user_selectable is not None:
        row.user_selectable = payload.user_selectable
    row.updated_at = utc_now()
    _commit(db)
    bind_audit_target(request, row.id)
    return {"model": _model_record(row)}


@router.delete("/models/{model_id}", status_code=204)
def delete_model(
    model_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> None:
    row = _model(db, model_id)
    if _model_referenced(db, row.id):
        raise ApiError(409, "LLM_MODEL_IN_USE")
    routes = db.scalars(
        select(LLMModelRoute).where(LLMModelRoute.model_id == row.id).with_for_update()
    ).all()
    _delete_routes(db, list(routes), "LLM_MODEL_IN_USE")
    db.delete(row)
    _commit(db)
    bind_audit_target(request, row.id)


@router.get("/routes")
def routes(
    db: Session = Depends(get_db), _: User = Depends(get_current_admin),
) -> dict:
    rows = db.scalars(select(LLMModelRoute).order_by(LLMModelRoute.id)).all()
    return {"routes": [_route_record(row) for row in rows]}


@router.post("/routes", status_code=201)
def create_route(
    payload: RouteCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    _model(db, str(payload.model_id))
    connection = _connection(db, str(payload.connection_id))
    try:
        if payload.target_kind not in PROVIDERS[connection.provider_code].target_kinds:
            raise ValueError
    except (KeyError, ValueError) as error:
        raise ApiError(422, "LLM_ROUTE_INVALID") from error
    if payload.enabled:
        raise ApiError(422, "LLM_PROBE_REQUIRED")
    row = LLMModelRoute(
        model_id=payload.model_id,
        connection_id=payload.connection_id,
        target_kind=payload.target_kind,
        invoke_target=payload.invoke_target.strip(),
        catalog_model_id=payload.catalog_model_id,
        identifier_kind=payload.identifier_kind,
        origin="manual",
        pricing_json=payload.pricing,
        enabled=False,
    )
    db.add(row)
    _commit(db)
    bind_audit_target(request, row.id)
    return {"route": _route_record(row)}


@router.patch("/routes/{route_id}")
def patch_route(
    route_id: str,
    payload: RoutePatch,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    row = _route(db, route_id, lock=True)
    if payload.identifier_kind is not None:
        row.identifier_kind = payload.identifier_kind
    if "pricing" in payload.model_fields_set:
        row.pricing_json = payload.pricing
    if payload.enabled is not None:
        if payload.enabled:
            bindings = db.scalars(
                select(LLMUseCaseRoute).where(LLMUseCaseRoute.route_id == row.id)
            ).all()
            connection = db.get(LLMProviderConnection, row.connection_id)
            if not any(probe_valid(item, row, connection) for item in bindings):
                raise ApiError(422, "LLM_PROBE_REQUIRED")
        row.enabled = payload.enabled
    row.updated_at = utc_now()
    _commit(db)
    bind_audit_target(request, row.id)
    return {"route": _route_record(row)}


@router.delete("/routes/{route_id}", status_code=204)
def delete_route(
    route_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> None:
    row = _route(db, route_id, lock=True)
    _delete_routes(db, [row], "LLM_ROUTE_IN_USE")
    _commit(db)
    bind_audit_target(request, row.id)


@router.get("/use-cases")
def use_cases(
    db: Session = Depends(get_db), _: User = Depends(get_current_admin),
) -> dict:
    rows = db.execute(
        select(LLMUseCaseRoute, LLMModelRoute, LLMProviderConnection)
        .join(LLMModelRoute, LLMModelRoute.id == LLMUseCaseRoute.route_id)
        .join(LLMProviderConnection, LLMProviderConnection.id == LLMModelRoute.connection_id)
        .order_by(LLMUseCaseRoute.use_case, LLMUseCaseRoute.priority)
    ).all()
    return {"bindings": [_binding_record(*row) for row in rows]}


@router.put("/use-cases/{use_case}/routes/{route_id}")
def bind_route(
    use_case: str,
    route_id: str,
    payload: UseCaseBindingWrite,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    if use_case not in USE_CASES or payload.use_case != use_case or payload.route_id != _id(route_id):
        raise ApiError(422, "LLM_USE_CASE_INVALID")
    route = _route(db, route_id)
    connection = _connection(db, str(route.connection_id))
    try:
        validate_route(connection.provider_code, route.target_kind, payload.protocol_code)
        validate_use_case_protocol(use_case, payload.protocol_code)
    except ValueError as error:
        raise ApiError(422, "LLM_ROUTE_INVALID") from error
    row = db.get(LLMUseCaseRoute, (use_case, route.id))
    if row is None:
        row = LLMUseCaseRoute(
            use_case=use_case, route_id=route.id,
            protocol_code=payload.protocol_code, priority=payload.priority, enabled=False,
        )
        db.add(row)
    else:
        if row.protocol_code != payload.protocol_code:
            row.validated_fingerprint = None
            row.validated_at = None
        row.protocol_code = payload.protocol_code
        row.priority = payload.priority
    if payload.enabled:
        if not probe_valid(row, route, connection):
            raise ApiError(422, "LLM_PROBE_REQUIRED")
    row.enabled = payload.enabled
    row.updated_at = utc_now()
    _commit(db)
    return {"binding": _binding_record(row, route, connection)}


@router.patch("/use-cases/{use_case}/routes/{route_id}")
def patch_binding(
    use_case: str,
    route_id: str,
    payload: UseCaseBindingPatch,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    route = _route(db, route_id)
    connection = _connection(db, str(route.connection_id))
    row = db.get(LLMUseCaseRoute, (use_case, route.id))
    if row is None:
        raise ApiError(404, "LLM_BINDING_NOT_FOUND")
    if payload.priority is not None:
        row.priority = payload.priority
    if payload.enabled is not None:
        if payload.enabled and not probe_valid(row, route, connection):
            raise ApiError(422, "LLM_PROBE_REQUIRED")
        row.enabled = payload.enabled
    row.updated_at = utc_now()
    _commit(db)
    return {"binding": _binding_record(row, route, connection)}


@router.delete("/use-cases/{use_case}/routes/{route_id}", status_code=204)
def unbind_route(
    use_case: str, route_id: str, request: Request,
    db: Session = Depends(get_db), _: User = Depends(get_current_admin),
) -> None:
    row = db.get(LLMUseCaseRoute, (use_case, _id(route_id)))
    if row is None:
        raise ApiError(404, "LLM_BINDING_NOT_FOUND")
    db.delete(row)
    _commit(db)


@router.post("/use-cases/{use_case}/routes/{route_id}/probe")
async def probe_binding(
    use_case: str, route_id: str, request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
    service: LLMService = Depends(get_llm_service),
    pi_probe: PiProbeCoordinator = Depends(get_pi_probe_coordinator),
) -> dict:
    try:
        call_id = await service.probe_route(
            admin.id, use_case, _id(route_id), pi_probe=pi_probe,
        )
    except LLMError as error:
        raise ApiError(422, error.code) from error
    return {"callId": call_id, "validated": True}


@router.get("/calls")
def list_calls(
    cursor: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    use_case: str | None = Query(default=None, alias="useCase", max_length=48),
    status: Literal["pending", "succeeded", "failed", "cancelled"] | None = None,
    error_code: str | None = Query(default=None, alias="errorCode", max_length=64),
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    if use_case is not None and use_case not in USE_CASES:
        raise ApiError(422, "LLM_USE_CASE_INVALID")
    filters = []
    if use_case is not None:
        filters.append(LLMCallLog.use_case == use_case)
    if status is not None:
        filters.append(LLMCallLog.status == status)
    if error_code is not None:
        filters.append(LLMCallLog.error_code == error_code)
    if from_at is not None or to_at is not None:
        window = resolve_window(from_at, to_at, default=timedelta(hours=24))
        filters.extend(
            [LLMCallLog.created_at >= window.start, LLMCallLog.created_at < window.end]
        )
    statement = (
        select(LLMCallLog).where(*filters).order_by(LLMCallLog.id.desc()).limit(limit + 1)
    )
    if cursor is not None:
        statement = statement.where(LLMCallLog.id < cursor)
    rows = db.scalars(statement).all()
    page = rows[:limit]
    totals = db.execute(
        select(
            func.count(LLMCallLog.id),
            func.sum(case((LLMCallLog.status == "succeeded", 1), else_=0)),
            func.sum(case((LLMCallLog.status == "failed", 1), else_=0)),
            func.sum(LLMCallLog.input_tokens),
            func.sum(LLMCallLog.output_tokens),
        ).where(*filters)
    ).one()
    return {
        "calls": [
            {
                "id": str(row.id), "callId": row.call_id, "useCase": row.use_case,
                "source": row.source, "userId": str(row.user_id) if row.user_id else None,
                "agentRunId": str(row.agent_run_id) if row.agent_run_id else None,
                "routeId": str(row.route_id), "protocolCode": row.protocol_code,
                "status": row.status, "meteringStatus": row.metering_status,
                "inputTokens": row.input_tokens, "outputTokens": row.output_tokens,
                "estimatedCost": str(row.estimated_cost) if row.estimated_cost is not None else None,
                "costCurrency": row.cost_currency, "errorCode": row.error_code,
                "createdAt": row.created_at,
            }
            for row in page
        ],
        "nextCursor": page[-1].id if len(rows) > limit else None,
        "summary": {
            "callCount": totals[0] or 0,
            "succeeded": int(totals[1] or 0),
            "failed": int(totals[2] or 0),
            "inputTokens": int(totals[3] or 0),
            "outputTokens": int(totals[4] or 0),
            **cost_totals(db, *filters),
        },
    }
