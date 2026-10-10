"""Bounded, preview-first historical estimates and exact supplier statement reconciliation."""
from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from drawoffer.core.database import get_db
from drawoffer.core.errors import ApiError
from drawoffer.modules.identity.dependencies import get_current_admin
from drawoffer.modules.identity.models import User
from drawoffer.modules.llm.accounting import call_basis, refresh_run_cost, store_price
from drawoffer.modules.llm.models import LLMCallLog, LLMCallCostRevision, LLMCostOperation, LLMModelRoute, LLMProviderConnection
from drawoffer.modules.llm.pricing import calculate_cost, catalog_pricing, decimal, digest, normalize_usage, utc_now
from drawoffer.modules.llm.schemas import ApiModel

router = APIRouter()


class BackfillPreview(ApiModel):
    connection_id: int = Field(alias="connectionId", gt=0)
    from_at: datetime = Field(alias="from")
    to_at: datetime = Field(alias="to")
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=64)
    price_policy: Literal["snapshot", "specified_rule"] = Field(default="snapshot", alias="pricePolicy")
    accept_current_rules: bool = Field(default=False, alias="acceptCurrentRules")
    legacy_timezone: Literal["UTC", "Asia/Shanghai"] | None = Field(default=None, alias="legacyTimezone")


class StatementPreview(ApiModel):
    connection_id: int = Field(alias="connectionId", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=64)
    csv_content: str = Field(alias="csvContent", min_length=1, max_length=5 * 1024 * 1024)


class ApplyCost(ApiModel):
    expected_digest: str = Field(alias="expectedDigest", min_length=64, max_length=64)


def _connection(db: Session, key: int) -> None:
    if db.get(LLMProviderConnection, key) is None:
        raise ApiError(404, "LLM_CONNECTION_NOT_FOUND")


def _operation(db: Session, key: str, lock=False) -> LLMCostOperation:
    query = select(LLMCostOperation).where(LLMCostOperation.operation_key == key)
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise ApiError(404, "LLM_COST_OPERATION_NOT_FOUND")
    return row


def _record(row: LLMCallCostRevision) -> dict:
    return {"id": str(row.id), "callId": row.basis_json.get("callId"), "source": row.source,
            "state": row.state, "reason": row.reason,
            "estimatedCost": str(row.estimated_cost) if row.estimated_cost is not None else None,
            "costCurrency": row.cost_currency,
            "settledCost": str(row.settled_cost) if row.settled_cost is not None else None,
            "settledCurrency": row.settled_currency, "breakdown": row.basis_json.get("breakdown", [])}


def operation_response(db: Session, operation: LLMCostOperation, cursor=0, limit=100) -> dict:
    rows = db.scalars(select(LLMCallCostRevision).where(LLMCallCostRevision.operation_id == operation.id,
        LLMCallCostRevision.id > cursor).order_by(LLMCallCostRevision.id).limit(limit + 1)).all()
    return {"operationId": operation.operation_key, "operationType": operation.operation_type, "state": operation.state, "digest": operation.source_digest,
            "summary": operation.summary_json, "scope": operation.scope_json,
            "items": [_record(r) for r in rows[:limit]],
            "nextCursor": str(rows[limit - 1].id) if len(rows) > limit else None}


def _new_operation(db, admin, kind, scope, idem):
    existing = db.scalar(select(LLMCostOperation).where(LLMCostOperation.actor_user_id == admin.id,
                                                      LLMCostOperation.idempotency_key == idem))
    if existing:
        if existing.scope_json != scope or existing.operation_type != kind:
            raise ApiError(409, "LLM_COST_IDEMPOTENCY_CONFLICT")
        return existing, False
    now = utc_now()
    row = LLMCostOperation(operation_key=str(uuid4()), operation_type=kind, idempotency_key=idem,
        actor_user_id=admin.id, state="previewed", scope_json=scope, source_digest=digest(scope),
        summary_json={}, create_time=now, update_time=now)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        raise ApiError(409, "LLM_COST_IDEMPOTENCY_CONFLICT") from None
    return row, True


def _finish_preview(db, operation, revisions):
    operation.source_digest = digest([{"key": r.calculation_key, "basis": r.basis_json} for r in revisions])
    reasons = Counter(r.reason for r in revisions if r.reason)
    operation.summary_json = {"total": len(revisions), "applicable": sum(r.state == "previewed" and r.reason is None for r in revisions),
                              "remaining": sum(r.state == "previewed" for r in revisions),
                              "reasons": dict(reasons)}
    db.commit()
    return operation_response(db, operation)


@router.post("/cost-backfills/preview")
def preview_backfill(payload: BackfillPreview, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    _connection(db, payload.connection_id)
    if (payload.from_at.tzinfo is None or payload.to_at.tzinfo is None
            or not timedelta(0) < payload.to_at - payload.from_at <= timedelta(days=31)):
        raise ApiError(422, "LLM_COST_WINDOW_INVALID")
    if payload.price_policy == "specified_rule" and not payload.accept_current_rules:
        raise ApiError(422, "LLM_COST_RULE_CONFIRMATION_REQUIRED")
    operation, fresh = _new_operation(db, admin, "backfill", payload.model_dump(mode="json", by_alias=True), payload.idempotency_key)
    if not fresh:
        return operation_response(db, operation)
    # Legacy time conversion is only performed when the operator explicitly selects the verified zone.
    legacy_from = payload.from_at.astimezone(ZoneInfo(payload.legacy_timezone)).replace(tzinfo=None) if payload.legacy_timezone else None
    legacy_to = payload.to_at.astimezone(ZoneInfo(payload.legacy_timezone)).replace(tzinfo=None) if payload.legacy_timezone else None
    from sqlalchemy import and_, or_
    time_filter = and_(LLMCallLog.request_started_at >= payload.from_at.astimezone(timezone.utc),
                       LLMCallLog.request_started_at < payload.to_at.astimezone(timezone.utc))
    if legacy_from is not None:
        time_filter = or_(time_filter, and_(LLMCallLog.request_started_at.is_(None),
                                          LLMCallLog.create_time >= legacy_from, LLMCallLog.create_time < legacy_to))
    candidate_filter = LLMCallLog.estimated_cost.is_(None)
    if payload.legacy_timezone:
        candidate_filter = or_(candidate_filter, LLMCallLog.request_started_at.is_(None))
    calls = db.execute(select(LLMCallLog, LLMModelRoute).join(LLMModelRoute, LLMModelRoute.id == LLMCallLog.route_id)
        .where(LLMModelRoute.connection_id == payload.connection_id, candidate_filter, time_filter)
        .order_by(LLMCallLog.id).limit(5001)).all()
    if len(calls) > 5000:
        raise ApiError(422, "LLM_COST_SCOPE_TOO_LARGE")
    revisions = []
    for call, route in calls:
        at = call.request_started_at
        if at is None and payload.legacy_timezone:
            at = call.create_time.replace(tzinfo=ZoneInfo(payload.legacy_timezone)).astimezone(timezone.utc)
        elif at is not None and at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        pricing = call.price_snapshot_json
        source = "historical_snapshot"
        if payload.price_policy == "specified_rule":
            pricing = catalog_pricing(route.metadata_json or {}) if route.pricing_mode == "provider" else route.pricing_json
            pricing = pricing or route.pricing_json
            source = "specified_rule"
        normalized = call.normalized_usage_json or normalize_usage(call.input_tokens, call.output_tokens, call.usage_json,
                                                                  exclusive=call.source == "pi_agent")
        if call.source == "pi_agent" and call.input_tokens == call.output_tokens == 0 and not call.upstream_request_id:
            normalized = {**normalized, "usagePresent": False}
        result = calculate_cost(normalized, pricing, at=at, protocol=call.protocol_code)
        price = store_price(db, route, pricing, update_route=False)
        preserve_estimate = call.estimated_cost is not None
        if preserve_estimate:
            source = "verified_legacy_time"
        now = utc_now()
        revision = LLMCallCostRevision(call_log_id=call.id, operation_id=operation.id, connection_id=route.connection_id,
            calculation_key=digest({"operation": operation.operation_key, "call": call.id}), source=source,
            state="previewed", reason=None if preserve_estimate else result.reason,
            price_revision_id=price.id if price else None,
            basis_json={"callId": call.call_id, "before": call_basis(call), "usage": normalized,
                        "price": pricing, "startedAt": at.isoformat() if at else None,
                        "preserveEstimate": preserve_estimate,
                        "timeBasis": call.time_basis or ("verified_legacy_" + payload.legacy_timezone if payload.legacy_timezone else "unknown"),
                        "breakdown": list(result.breakdown)}, estimated_cost=call.estimated_cost if preserve_estimate else result.amount,
            cost_currency=call.cost_currency if preserve_estimate else result.currency, create_time=now, update_time=now)
        db.add(revision)
        revisions.append(revision)
    return _finish_preview(db, operation, revisions)


@router.post("/cost-statements/preview")
def preview_statement(payload: StatementPreview, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    _connection(db, payload.connection_id)
    if len(payload.csv_content.encode()) > 5 * 1024 * 1024:
        raise ApiError(422, "LLM_COST_STATEMENT_TOO_LARGE")
    reader = csv.DictReader(io.StringIO(payload.csv_content.lstrip("\ufeff")))
    required = {"recordId", "requestId", "amount", "currency"}
    if not reader.fieldnames or len(reader.fieldnames) != 4 or set(reader.fieldnames) != required:
        raise ApiError(422, "LLM_COST_STATEMENT_COLUMNS_INVALID")
    entries = []
    for index, item in enumerate(reader):
        if index >= 5000:
            raise ApiError(422, "LLM_COST_STATEMENT_TOO_LARGE")
        if None in item or any(not isinstance(item.get(k), str) for k in required):
            raise ApiError(422, "LLM_COST_STATEMENT_ROW_INVALID")
        record, request = item["recordId"].strip(), item["requestId"].strip()
        currency = item["currency"].strip().upper()
        try:
            amount = decimal(item["amount"]).quantize(Decimal("0.0000000001"))
        except (ValueError, ArithmeticError):
            raise ApiError(422, "LLM_COST_STATEMENT_AMOUNT_INVALID") from None
        if not record or not request or max(len(record), len(request)) > 128 or len(currency) != 3 or not currency.isascii() or not currency.isalpha() or amount >= Decimal("10000000000"):
            raise ApiError(422, "LLM_COST_STATEMENT_ROW_INVALID")
        entries.append({"recordId": record, "requestId": request, "amount": str(amount), "currency": currency})
    scope = {"connectionId": payload.connection_id, "contentDigest": digest(entries)}
    operation, fresh = _new_operation(db, admin, "statement_import", scope, payload.idempotency_key)
    if not fresh:
        return operation_response(db, operation)
    revisions, seen = [], set()
    for index, entry in enumerate(entries):
        request_column = LLMCallLog.upstream_request_id
        if db.get_bind().dialect.name == "mysql":
            # Old call IDs use the database's case-insensitive default collation.
            request_column = request_column.collate("utf8mb4_0900_bin")
        matches = db.scalars(select(LLMCallLog).join(LLMModelRoute, LLMModelRoute.id == LLMCallLog.route_id)
            .where(LLMModelRoute.connection_id == payload.connection_id,
                   request_column == entry["requestId"]).limit(2)).all()
        matches = [r for r in matches if r.upstream_request_id == entry["requestId"]]
        call = matches[0] if len(matches) == 1 else None
        previous = db.scalar(select(LLMCallCostRevision).where(LLMCallCostRevision.connection_id == payload.connection_id,
            LLMCallCostRevision.provider_record_key == entry["recordId"]))
        reason = "request_not_found" if not matches else "ambiguous_request" if len(matches) > 1 else None
        if entry["recordId"] in seen:
            reason = "duplicate_statement_record"
        elif previous:
            reason = "already_reconciled" if str(previous.settled_cost) == entry["amount"] and previous.settled_currency == entry["currency"] and previous.provider_request_key == entry["requestId"] else "statement_conflict"
        elif call and call.settled_cost is not None:
            reason = "statement_conflict"
        seen.add(entry["recordId"])
        now = utc_now()
        revision = LLMCallCostRevision(call_log_id=call.id if call else None, operation_id=operation.id,
            connection_id=payload.connection_id, calculation_key=digest({"operation": operation.operation_key, "index": index}),
            source="provider_statement", state="unresolved" if reason else "previewed", reason=reason,
            basis_json={"callId": call.call_id if call else None, "before": call_basis(call) if call else None, "statement": entry},
            settled_cost=Decimal(entry["amount"]), settled_currency=entry["currency"],
            provider_request_key=entry["requestId"], create_time=now, update_time=now)
        db.add(revision)
        revisions.append(revision)
    return _finish_preview(db, operation, revisions)


@router.get("/cost-operations/{operation_id}")
def get_operation(operation_id: str, cursor: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=100),
                  db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    return operation_response(db, _operation(db, operation_id), cursor, limit)


@router.post("/cost-operations/{operation_id}/apply")
def apply_operation(operation_id: str, payload: ApplyCost, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    operation = _operation(db, operation_id, lock=True)
    if operation.source_digest != payload.expected_digest:
        raise ApiError(409, "LLM_COST_PREVIEW_CHANGED")
    if operation.operation_type == "statement_import":
        # Serialize imports for one supplier account before reserving external record IDs.
        db.scalar(select(LLMProviderConnection).where(
            LLMProviderConnection.id == operation.scope_json["connectionId"]).with_for_update())
    revisions = db.scalars(select(LLMCallCostRevision).where(LLMCallCostRevision.operation_id == operation.id,
        LLMCallCostRevision.state == "previewed").order_by(LLMCallCostRevision.id).limit(100).with_for_update()).all()
    run_ids = set()
    for revision in revisions:
        call = db.scalar(select(LLMCallLog).where(LLMCallLog.id == revision.call_log_id).with_for_update())
        if call is None or call_basis(call) != revision.basis_json["before"]:
            revision.state, revision.reason = "conflict", "call_changed_since_preview"
            continue
        if revision.source == "provider_statement":
            statement = revision.basis_json["statement"]
            other = db.scalar(select(LLMCallCostRevision.id).where(LLMCallCostRevision.connection_id == revision.connection_id,
                LLMCallCostRevision.provider_record_key == statement["recordId"]))
            if other:
                revision.state, revision.reason = "conflict", "statement_conflict"
                continue
            revision.provider_record_key = statement["recordId"]
            call.settled_cost, call.settled_currency = revision.settled_cost, revision.settled_currency
            call.cost_state, call.cost_reason = "reconciled", None
        else:
            if not revision.basis_json.get("preserveEstimate"):
                call.estimated_cost, call.cost_currency = revision.estimated_cost, revision.cost_currency
                call.cost_reason = revision.reason
                call.metering_status = "complete" if revision.estimated_cost is not None else "partial" if revision.basis_json["usage"].get("usagePresent") else "unknown"
                call.normalized_usage_json = revision.basis_json["usage"]
                call.price_revision_id = revision.price_revision_id
            call.cost_state = "reconciled" if call.settled_cost is not None else "estimated" if call.estimated_cost is not None else "unresolved"
            at = revision.basis_json.get("startedAt")
            if call.request_started_at is None and at:
                call.request_started_at = datetime.fromisoformat(at)
                call.time_basis = revision.basis_json["timeBasis"]
        call.current_cost_revision_id = revision.id
        revision.state, revision.update_time = "applied", utc_now()
        run_ids.add(call.agent_run_id)
    db.flush()
    for run_id in run_ids:
        refresh_run_cost(db, run_id)
    all_rows = db.scalars(select(LLMCallCostRevision).where(LLMCallCostRevision.operation_id == operation.id)).all()
    states = Counter(r.state for r in all_rows)
    operation.state = "running" if states["previewed"] else "partial_failed" if states["conflict"] or any(r.reason for r in all_rows) else "completed"
    operation.summary_json = {**operation.summary_json, "states": dict(states), "remaining": states["previewed"]}
    operation.update_time = utc_now()
    db.commit()
    return operation_response(db, operation)
