"""Append-only cost evidence and compatible call/run projections."""
from datetime import timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from drawoffer.modules.llm.models import LLMCallLog, LLMCallCostRevision, LLMModelRoute, LLMPriceRevision
from drawoffer.modules.llm.pricing import calculate_cost, digest, normalize_usage, utc_now


def store_price(db: Session, route: LLMModelRoute, pricing: dict | None, *, update_route=True) -> LLMPriceRevision | None:
    if not pricing:
        return None
    rule = {k: v for k, v in pricing.items() if k not in ("observedAt", "checked_at")}
    key = digest(rule)
    revision = db.scalar(select(LLMPriceRevision).where(LLMPriceRevision.route_id == route.id, LLMPriceRevision.rule_hash == key))
    if revision is None:
        now = utc_now()
        revision = LLMPriceRevision(route_id=route.id, rule_hash=key, rule_json=pricing,
                                    source=str(pricing.get("source", "manual"))[:32], observed_at=now,
                                    create_time=now, update_time=now)
        try:
            with db.begin_nested():
                db.add(revision)
                db.flush()
        except IntegrityError:
            revision = db.scalar(select(LLMPriceRevision).where(LLMPriceRevision.route_id == route.id, LLMPriceRevision.rule_hash == key))
            if revision is None:
                raise
    if update_route:
        route.current_price_revision_id = revision.id
    return revision


def call_basis(row: LLMCallLog) -> dict:
    return {"status": row.status, "usage": row.normalized_usage_json, "rawUsage": row.usage_json,
            "input": row.input_tokens, "output": row.output_tokens, "price": row.price_snapshot_json,
            "startedAt": row.request_started_at.isoformat() if row.request_started_at else None,
            "timeBasis": row.time_basis, "estimate": str(row.estimated_cost) if row.estimated_cost is not None else None,
            "currency": row.cost_currency, "settled": str(row.settled_cost) if row.settled_cost is not None else None,
            "settledCurrency": row.settled_currency, "currentRevisionId": row.current_cost_revision_id}


def record_runtime_cost(db: Session, row: LLMCallLog) -> None:
    before = call_basis(row)
    at = row.request_started_at
    if at is not None and at.tzinfo is None and row.time_basis == "explicit_utc":
        at = at.replace(tzinfo=timezone.utc)
    result = calculate_cost(row.normalized_usage_json, row.price_snapshot_json, at=at, protocol=row.protocol_code)
    row.estimated_cost, row.cost_currency = result.amount, result.currency
    row.cost_state = "reconciled" if row.settled_cost is not None else "estimated" if result.amount is not None else "unresolved"
    row.cost_reason = result.reason
    row.metering_status = "complete" if result.amount is not None else "partial" if row.normalized_usage_json and row.normalized_usage_json.get("usagePresent") else "unknown"
    db.flush()
    route = db.get(LLMModelRoute, row.route_id)
    key = digest({"runtimeCallId": row.call_id, "status": row.status, "usage": row.normalized_usage_json,
                  "price": row.price_snapshot_json, "error": row.error_code})
    existing = db.scalar(select(LLMCallCostRevision).where(LLMCallCostRevision.calculation_key == key))
    if existing:
        row.current_cost_revision_id = existing.id
        return
    now = utc_now()
    revision = LLMCallCostRevision(call_log_id=row.id, connection_id=route.connection_id,
        calculation_key=key, source="runtime",
        state="applied" if result.amount is not None else "unresolved", reason=result.reason,
        price_revision_id=row.price_revision_id, basis_json={"before": before, "breakdown": list(result.breakdown)},
        estimated_cost=result.amount, cost_currency=result.currency, create_time=now, update_time=now)
    db.add(revision)
    db.flush()
    row.current_cost_revision_id = revision.id


def refresh_run_cost(db: Session, run_id: int | None) -> None:
    if run_id is None:
        return
    from drawoffer.modules.agent.models import AgentRun
    run = db.get(AgentRun, run_id)
    if run is None:
        return
    calls = db.scalars(select(LLMCallLog).where(LLMCallLog.agent_run_id == run_id)).all()
    currencies = {c.cost_currency for c in calls if c.estimated_cost is not None}
    complete = bool(calls) and all(c.estimated_cost is not None and c.cost_currency for c in calls) and len(currencies) == 1
    run.estimated_cost = sum((c.estimated_cost for c in calls), Decimal(0)) if complete else None
    run.cost_currency = next(iter(currencies)) if complete else None
