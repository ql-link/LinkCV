"""Agent operation health built on the same rows as the trace list."""

from __future__ import annotations

from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from drawoffer.modules.admin_insights.window import Window, aware, day_of, day_series, percentile_95
from drawoffer.modules.agent.admin_routes import operation_rows

RUNNING = ("preflighting", "running")


def operations_in(db: Session, window: Window):
    rows = operation_rows()
    return db.execute(
        select(rows).where(rows.c.created_at >= window.start, rows.c.created_at < window.end)
    ).all()


def failures(rows) -> tuple[int, float | None]:
    failed = sum(1 for row in rows if row.status == "failed")
    rate = round(failed / len(rows), 4) if rows else None
    return failed, rate


def agent_stats(db: Session, window: Window) -> dict[str, object]:
    rows = operations_in(db, window)
    failed, rate = failures(rows)
    durations = []
    for row in rows:
        started, completed = aware(row.run_started_at), aware(row.run_completed_at)
        if started is not None and completed is not None:
            durations.append((completed - started).total_seconds() * 1000)
    stages = Counter(row.failure_stage for row in rows if row.status == "failed" and row.failure_stage)
    codes = Counter(row.error_code for row in rows if row.status == "failed" and row.error_code)

    daily: dict[object, Counter] = defaultdict(Counter)
    for row in rows:
        bucket = "running" if row.status in RUNNING else row.status
        daily[day_of(row.created_at)][bucket] += 1
    return {
        "from": window.start,
        "to": window.end,
        "operations": len(rows),
        "failed": failed,
        "failureRate": rate,
        "running": sum(1 for row in rows if row.status in RUNNING),
        "p95Ms": percentile_95(durations),
        "topFailureStage": stages.most_common(1)[0][0] if stages else None,
        "topErrorCode": codes.most_common(1)[0][0] if codes else None,
        "daily": [
            {
                "date": day.isoformat(),
                "succeeded": daily[day]["succeeded"],
                "failed": daily[day]["failed"],
                "running": daily[day]["running"],
            }
            for day in day_series(window.end, 7)
        ],
    }
