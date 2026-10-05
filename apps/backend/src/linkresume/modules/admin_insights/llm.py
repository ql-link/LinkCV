"""LLM usage, provider connection health and model health."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from linkresume.modules.admin_insights.window import (
    FINISHED,
    Window,
    costs,
    percentile_95,
    success_rate,
)
from linkresume.modules.llm.models import (
    LLMCallLog,
    LLMModel,
    LLMModelRoute,
    LLMProviderConnection,
    LLMUseCaseRoute,
)
from linkresume.modules.llm.resolver import probe_valid

GroupBy = Literal["model", "useCase", "connection"]


def call_rows(db: Session, window: Window):
    return db.execute(
        select(
            LLMCallLog.status,
            LLMCallLog.latency_ms,
            LLMCallLog.cost_currency,
            LLMCallLog.estimated_cost,
            LLMCallLog.use_case,
            LLMCallLog.create_time,
            LLMModelRoute.model_id,
            LLMModelRoute.connection_id,
        )
        .join(LLMModelRoute, LLMModelRoute.id == LLMCallLog.route_id)
        .where(LLMCallLog.create_time >= window.start, LLMCallLog.create_time < window.end)
    ).all()


def summarize(rows) -> dict[str, object]:
    finished = [row for row in rows if row.status in FINISHED]
    return {
        "calls": len(rows),
        "successRate": success_rate(
            sum(1 for row in finished if row.status == "succeeded"), len(finished)
        ),
        "p95Ms": percentile_95(row.latency_ms for row in finished),
        **costs((row.cost_currency, row.estimated_cost) for row in rows),
    }


def _labels(db: Session, group_by: GroupBy) -> dict[object, str]:
    if group_by == "model":
        return dict(db.execute(select(LLMModel.id, LLMModel.display_name)).all())
    if group_by == "connection":
        return dict(db.execute(select(LLMProviderConnection.id, LLMProviderConnection.name)).all())
    return {}


def usage(db: Session, window: Window, group_by: GroupBy) -> dict[str, object]:
    rows = call_rows(db, window)
    attribute = {"model": "model_id", "useCase": "use_case", "connection": "connection_id"}[group_by]
    grouped: dict[object, list] = defaultdict(list)
    for row in rows:
        grouped[getattr(row, attribute)].append(row)
    labels = _labels(db, group_by)
    groups = [
        {"key": str(key), "label": labels.get(key, str(key)), **summarize(items)}
        for key, items in grouped.items()
    ]
    groups.sort(key=lambda item: (-item["calls"], item["key"]))
    return {
        "from": window.start,
        "to": window.end,
        "summary": summarize(rows),
        "previous": summarize(call_rows(db, window.previous)),
        "groups": groups,
    }


def health(db: Session, window: Window) -> dict[str, object]:
    rows = call_rows(db, window)
    by_connection: dict[int, list] = defaultdict(list)
    by_model: dict[int, list] = defaultdict(list)
    for row in rows:
        by_connection[row.connection_id].append(row)
        by_model[row.model_id].append(row)

    def rate(items) -> float | None:
        finished = [row for row in items if row.status in FINISHED]
        return success_rate(sum(1 for row in finished if row.status == "succeeded"), len(finished))

    routes = db.execute(select(LLMModelRoute)).scalars().all()
    connections = db.execute(select(LLMProviderConnection)).scalars().all()
    connection_by_id = {connection.id: connection for connection in connections}
    route_by_id = {route.id: route for route in routes}
    valid_bindings: dict[int, int] = defaultdict(int)
    for binding in db.execute(select(LLMUseCaseRoute)).scalars():
        route = route_by_id.get(binding.route_id)
        connection = connection_by_id.get(route.connection_id) if route else None
        if route and connection and binding.is_enabled and probe_valid(binding, route, connection):
            valid_bindings[connection.id] += 1

    enabled_routes: dict[int, int] = defaultdict(int)
    route_count: dict[int, int] = defaultdict(int)
    for route in routes:
        route_count[route.model_id] += 1
        if route.is_enabled:
            enabled_routes[route.connection_id] += 1

    models = db.execute(select(LLMModel).order_by(LLMModel.display_name)).scalars().all()
    return {
        "connections": [
            {
                "id": str(connection.id),
                "name": connection.name,
                "providerCode": connection.provider_code,
                "enabled": bool(connection.is_enabled),
                "enabledRoutes": enabled_routes[connection.id],
                "validBindings": valid_bindings[connection.id],
                "calls24h": len(by_connection[connection.id]),
                "successRate24h": rate(by_connection[connection.id]),
            }
            for connection in sorted(connections, key=lambda item: item.name)
        ],
        "models": [
            {
                "id": str(model.id),
                "displayName": model.display_name,
                "routeCount": route_count[model.id],
                "calls24h": len(by_model[model.id]),
                "successRate24h": rate(by_model[model.id]),
            }
            for model in models
        ],
    }


HEALTH_WINDOW = timedelta(hours=24)


def cost_totals(db: Session, *filters) -> dict[str, object]:
    """Same shape as ``costs()`` but aggregated in SQL, for unbounded call sets."""
    metered = db.execute(
        select(LLMCallLog.cost_currency, func.sum(LLMCallLog.estimated_cost))
        .where(
            *filters,
            LLMCallLog.cost_currency.is_not(None),
            LLMCallLog.estimated_cost.is_not(None),
        )
        .group_by(LLMCallLog.cost_currency)
        .order_by(LLMCallLog.cost_currency)
    ).all()
    unmetered = db.scalar(
        select(func.count(LLMCallLog.id)).where(
            *filters,
            or_(LLMCallLog.cost_currency.is_(None), LLMCallLog.estimated_cost.is_(None)),
        )
    ) or 0
    return {
        "costs": [
            {"currency": currency, "amount": str(Decimal(amount))} for currency, amount in metered
        ],
        "unmeteredCallCount": unmetered,
    }


def user_totals(db: Session, user_id: int) -> tuple[int, dict[str, object]]:
    count = db.scalar(
        select(func.count(LLMCallLog.id)).where(LLMCallLog.user_id == user_id)
    ) or 0
    return count, cost_totals(db, LLMCallLog.user_id == user_id)


def calls_since(db: Session, start) -> int:
    return db.scalar(select(func.count(LLMCallLog.id)).where(LLMCallLog.create_time >= start)) or 0
