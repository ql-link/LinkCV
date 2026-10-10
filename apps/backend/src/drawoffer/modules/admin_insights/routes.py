"""Read-only admin insight endpoints; every route requires an administrator."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from drawoffer.core.database import get_db
from drawoffer.core.errors import ApiError
from drawoffer.modules.admin_insights import agent, content, funnel, llm, overview
from drawoffer.modules.admin_insights.window import resolve_window, utcnow
from drawoffer.modules.identity.dependencies import get_current_admin, get_settings
from drawoffer.modules.identity.models import User
from drawoffer.modules.observability.loki import LokiUnavailableError

router = APIRouter(prefix="/admin/insights", tags=["admin-insights"])

HEATMAP_DAYS = 7
HEATMAP_STEP = timedelta(hours=3)


@router.get("/overview")
def get_overview(
    db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)
) -> dict:
    return overview.overview(db, utcnow())


@router.get("/users")
def get_users(db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)) -> dict:
    return content.user_stats(db, utcnow())


@router.get("/templates")
def get_templates(
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> dict:
    return content.template_stats(db, utcnow(), limit)


@router.get("/job-imports")
def get_job_imports(
    db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)
) -> dict:
    return content.job_import_stats(db, utcnow())


@router.get("/llm-usage")
def get_llm_usage(
    group_by: Literal["model", "useCase", "connection"] = Query(default="model", alias="groupBy"),
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> dict:
    window = resolve_window(from_at, to_at, default=timedelta(hours=24))
    return llm.usage(db, window, group_by)


@router.get("/llm-health")
def get_llm_health(
    db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)
) -> dict:
    now = utcnow()
    return llm.health(db, resolve_window(None, now, default=llm.HEALTH_WINDOW))


@router.get("/agent")
def get_agent(
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> dict:
    return agent.agent_stats(db, resolve_window(from_at, to_at, default=timedelta(days=7)))


@router.get("/funnel")
def get_funnel(
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> dict:
    return funnel.funnel(db, resolve_window(from_at, to_at, default=timedelta(days=30)))


@router.get("/log-heatmap")
def get_log_heatmap(
    request: Request,
    _admin: User = Depends(get_current_admin),
    settings=Depends(get_settings),
) -> dict:
    client = request.app.state.loki_client
    if client is None:
        raise ApiError(503, "LOG_QUERY_UNAVAILABLE")
    step = int(HEATMAP_STEP.total_seconds())
    now = utcnow()
    # Align buckets to the 3-hour grid so repeated requests return stable boundaries.
    end = datetime.fromtimestamp((int(now.timestamp()) // step + 1) * step, UTC)
    start = end - timedelta(days=HEATMAP_DAYS)
    try:
        counts = client.query_level_buckets(
            environment=settings.app_environment,
            start=start + HEATMAP_STEP,
            end=end,
            step_seconds=step,
        )
    except LokiUnavailableError as error:
        raise ApiError(503, "LOG_QUERY_UNAVAILABLE") from error
    buckets = []
    bucket_start = start
    while bucket_start < end:
        bucket_end = int((bucket_start + HEATMAP_STEP).timestamp())
        values = counts.get(bucket_end, {})
        buckets.append({
            "start": bucket_start,
            "error": values.get("ERROR", 0) + values.get("CRITICAL", 0),
            "warn": values.get("WARNING", 0),
        })
        bucket_start += HEATMAP_STEP
    return {"buckets": buckets}
