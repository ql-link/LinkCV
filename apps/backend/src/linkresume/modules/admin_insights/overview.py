"""Overview metrics and alerts derived from existing records on every request.

Alerts are not persisted: they disappear as soon as the underlying data recovers.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from linkresume.modules.admin_insights import agent, content, llm
from linkresume.modules.admin_insights.window import (
    FINISHED,
    Window,
    day_of,
    day_series,
    delta,
    percentile_95,
    primary_cost,
    success_rate,
)
from linkresume.modules.identity.models import User
from linkresume.modules.llm.models import LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute
from linkresume.modules.llm.resolver import ASSISTANT_CONVERSATION, probe_valid

# Alert thresholds (confirmed in LOCAL-20260928-admin-insights D3).
AGENT_MIN_FAILURES = 3
AGENT_MIN_FAILURE_RATE = 0.10
LLM_MIN_CALLS = 20
LLM_MIN_SUCCESS_RATE = 0.98
ALERT_WINDOW = timedelta(hours=1)


def _users(db: Session, window: Window) -> tuple[int, int]:
    active = db.scalar(
        select(func.count(User.id)).where(
            User.last_login_at >= window.start, User.last_login_at < window.end, User.status == 1
        )
    ) or 0
    created = db.scalar(
        select(func.count(User.id)).where(User.create_time >= window.start, User.create_time < window.end)
    ) or 0
    return active, created


def _invalid_conversation_bindings(db: Session, now: datetime) -> list[str]:
    rows = db.execute(
        select(LLMUseCaseRoute, LLMModelRoute, LLMProviderConnection)
        .join(LLMModelRoute, LLMModelRoute.id == LLMUseCaseRoute.route_id)
        .join(LLMProviderConnection, LLMProviderConnection.id == LLMModelRoute.connection_id)
        .where(
            LLMUseCaseRoute.use_case == ASSISTANT_CONVERSATION,
            LLMUseCaseRoute.is_enabled.is_(True),
            LLMModelRoute.is_enabled.is_(True),
            LLMProviderConnection.is_enabled.is_(True),
        )
    ).all()
    return [
        connection.name
        for binding, route, connection in rows
        if not probe_valid(binding, route, connection, now=now)
    ]


def alerts(db: Session, now: datetime) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    invalid = _invalid_conversation_bindings(db, now)
    if invalid:
        found.append({
            "type": "llm_binding_invalid",
            "severity": "critical",
            "title": "对话能力 probe 失效",
            "description": f"{len(invalid)} 条已启用的对话渠道验证已失效：{'、'.join(sorted(set(invalid)))}",
            "target": "models/capabilities",
        })

    recent = Window(now - ALERT_WINDOW, now)
    failed, rate = agent.failures(agent.operations_in(db, recent))
    if failed >= AGENT_MIN_FAILURES and rate is not None and rate >= AGENT_MIN_FAILURE_RATE:
        found.append({
            "type": "agent_failures",
            "severity": "warning",
            "title": "Agent 失败率升高",
            "description": f"过去 1 小时失败 {failed} 次，失败率 {rate:.0%}",
            "target": "security/agent-trace",
        })

    calls = [row for row in llm.call_rows(db, recent) if row.status in FINISHED]
    succeeded = sum(1 for row in calls if row.status == "succeeded")
    llm_rate = success_rate(succeeded, len(calls))
    if len(calls) >= LLM_MIN_CALLS and llm_rate is not None and llm_rate < LLM_MIN_SUCCESS_RATE:
        found.append({
            "type": "llm_success_rate",
            "severity": "warning",
            "title": "LLM 成功率偏低",
            "description": f"过去 1 小时 {len(calls)} 次调用，成功率 {llm_rate:.1%}",
            "target": "models/usage",
        })

    pending = content.pending_review_count(db)
    if pending:
        found.append({
            "type": "template_review",
            "severity": "info",
            "title": "模板待复核",
            "description": f"{pending} 套启用模板的分类待讨论",
            "target": "content/templates/classification",
        })
    return found


def overview(db: Session, now: datetime) -> dict[str, object]:
    week = Window(now - timedelta(days=7), now)
    today = Window(now.replace(hour=0, minute=0, second=0, microsecond=0), now)
    yesterday = Window(today.start - timedelta(days=1), now - timedelta(days=1))

    active, created = _users(db, week)
    active_prev, created_prev = _users(db, week.previous)
    calls_today = len(llm.call_rows(db, today))
    calls_yesterday = len(llm.call_rows(db, yesterday))
    cost_week = llm.summarize(llm.call_rows(db, week))
    cost_prev = llm.summarize(llm.call_rows(db, week.previous))
    cost_summary = {"costs": cost_week["costs"], "unmeteredCallCount": cost_week["unmeteredCallCount"]}

    trend_window = Window(today.start - timedelta(days=13), now)
    per_day: dict[object, list] = defaultdict(list)
    for row in llm.call_rows(db, trend_window):
        per_day[day_of(row.create_time)].append(row)
    trend = []
    for day in day_series(now, 14):
        rows = per_day[day]
        finished = [row for row in rows if row.status in FINISHED]
        trend.append({
            "date": day.isoformat(),
            "calls": len(rows),
            "successRate": success_rate(
                sum(1 for row in finished if row.status == "succeeded"), len(finished)
            ),
            "p95Ms": percentile_95(row.latency_ms for row in finished),
        })

    return {
        "metrics": {
            "activeUsers7d": active,
            "newUsers7d": created,
            "callsToday": calls_today,
            "cost7d": cost_summary,
        },
        "deltas": {
            "activeUsers7d": delta(active, active_prev),
            "newUsers7d": delta(created, created_prev),
            "callsToday": delta(calls_today, calls_yesterday),
            "cost7d": delta(primary_cost(cost_week), primary_cost(cost_prev)),
        },
        "trend": trend,
        "alerts": alerts(db, now),
    }
