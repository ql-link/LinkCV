from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.application.job_pool import service
from linkresume.application.job_pool.catalog import entry_for, validate_source
from linkresume.application.job_pool.types import AcceptSync, SourceCreate, SourceUpdate
from linkresume.core.database import get_db, utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.identity.dependencies import get_current_admin, get_current_user, lock_active_user
from linkresume.modules.identity.models import User
from linkresume.modules.job_descriptions.models import GlobalCompany
from linkresume.modules.job_pool.models import GlobalJob, GlobalJobSource

router = APIRouter(prefix="/job-pool", tags=["job-pool"])
admin_router = APIRouter(prefix="/admin/job-pool", tags=["admin-job-pool"])


@router.get("")
def list_jobs(keyword: str | None = Query(None, max_length=100), company_id: str | None = Query(None, pattern=r"^[1-9][0-9]{0,19}$"),
    company_ids: list[str] | None = Query(None, max_length=200),
    city: str | None = Query(None, max_length=100), job_category: str | None = Query(None, max_length=100),
    recruitment_type: str | None = Query(None, pattern=r"^(campus|experienced|internship)$"),
    cursor: str | None = Query(None, max_length=1024), limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.list_jobs(db, user.id, keyword=keyword, company_id=company_id, company_ids=company_ids, city=city,
        job_category=job_category, recruitment_type=recruitment_type, cursor=cursor, limit=limit)


@router.get("/filters")
def filters(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    companies = db.execute(select(GlobalCompany).join(GlobalJobSource, GlobalJobSource.company_id == GlobalCompany.id).distinct().order_by(GlobalCompany.company_name))
    cities, categories = set(), set()
    for location, category in db.execute(select(GlobalJob.locations, GlobalJob.job_category).where(GlobalJob.availability_status.in_(("active", "missing")))):
        cities.update(location["cities"])
        if category:
            categories.add(category)
    from linkresume.application.job_descriptions.company_service import company_record
    return {"companies": [company_record(company) for company in companies.scalars()],
        "cities": sorted(cities), "categories": sorted(categories), "recruitment_types": ["campus", "internship", "experienced"]}


@router.get("/{job_id}")
def detail(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    identifier = service.id_value(job_id)
    row = db.execute(select(GlobalJob, GlobalCompany, GlobalJobSource)
        .join(GlobalJobSource, GlobalJobSource.id == GlobalJob.source_id)
        .join(GlobalCompany, GlobalCompany.id == GlobalJobSource.company_id).where(GlobalJob.id == identifier)).first()
    if row is None:
        raise ApiError(404, "JOB_POOL_NOT_FOUND")
    joined = service.joined_ids(db, user.id, [identifier])
    return service.serialize(*row, joined.get(identifier), detail=True)


@router.post("/{job_id}/join")
def join(job_id: str, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = service.join_job(db, user.id, job_id)
    response.status_code = 201 if result["created"] else 200
    return result


def source_record(db, row):
    company = db.get(GlobalCompany, row.company_id)
    entry = entry_for(row.adapter_key, row.tenant_key)
    return {"id": str(row.id), "company_id": str(row.company_id), "company_name": company.company_name, "company_logo_url": company.logo_url,
        "adapter_key": row.adapter_key, "tenant_key": row.tenant_key, "portal_config": row.portal_config,
        "is_enabled": bool(row.is_enabled), "sync_generation": str(row.sync_generation), "sync_status": row.sync_status,
        "next_sync_at": service.aware(row.next_sync_at), "last_complete_at": service.aware(row.last_complete_at),
        "last_sync_result": row.last_sync_result or {"schema_version": 1, "baseline_count": None}, "careers_url": entry.url,
        "supported_channels": list(entry.channels), "adapter_ready": row.adapter_key != "pending"}


@admin_router.get("/sources")
def sources(request: Request, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    rows = db.scalars(select(GlobalJobSource).order_by(GlobalJobSource.id))
    return {"items": [source_record(db, row) for row in rows], "sync_enabled": request.app.state.settings.job_pool_sync_enabled}


@admin_router.post("/sources", status_code=201)
def create_source(payload: SourceCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    lock_active_user(db, admin.id)
    company_id = service.id_value(payload.company_id, "COMPANY_NOT_FOUND")
    if db.get(GlobalCompany, company_id) is None:
        raise ApiError(404, "COMPANY_NOT_FOUND")
    config = payload.portal_config.model_dump()
    tenant = validate_source(payload.adapter_key, config)
    if payload.is_enabled and payload.adapter_key == "pending":
        raise ApiError(409, "JOB_SOURCE_ADAPTER_PENDING")
    row = GlobalJobSource(company_id=company_id, adapter_key=payload.adapter_key, tenant_key=tenant,
        portal_config=config, is_enabled=int(payload.is_enabled), next_sync_at=utc_now() if payload.is_enabled else None)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "JOB_SOURCE_EXISTS") from error
    return source_record(db, row)


@admin_router.patch("/sources/{source_id}")
def update_source(source_id: str, payload: SourceUpdate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    lock_active_user(db, admin.id)
    row = service.source_row(db, source_id, lock=True)
    if row.sync_generation != int(payload.base_generation):
        raise ApiError(409, "JOB_SOURCE_CONFLICT")
    if payload.is_enabled is None and payload.portal_config is None:
        raise ApiError(400, "JOB_SOURCE_INVALID")
    if payload.portal_config is not None:
        config = payload.portal_config.model_dump()
        if validate_source(row.adapter_key, config) != row.tenant_key:
            raise ApiError(400, "JOB_SOURCE_INVALID")
        if not set(row.portal_config["portals"]) <= set(config["portals"]):
            raise ApiError(400, "JOB_SOURCE_COVERAGE_REDUCTION")
        row.portal_config = config
    if payload.is_enabled:
        if row.adapter_key == "pending":
            raise ApiError(409, "JOB_SOURCE_ADAPTER_PENDING")
    if payload.is_enabled is not None:
        row.is_enabled = int(payload.is_enabled)
    row.sync_generation += 1
    row.sync_status = "cancelled" if row.sync_status in {"queued", "running"} else "idle"
    row.lease_until = None
    row.next_sync_at = utc_now() if row.is_enabled else None
    db.commit()
    return source_record(db, row)


@admin_router.post("/sources/{source_id}/sync")
def sync(source_id: str, request: Request, response: Response, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    lock_active_user(db, admin.id)
    row, created = service.queue_source(db, source_id, enabled=request.app.state.settings.job_pool_sync_enabled)
    response.status_code = 202 if created else 200
    return source_record(db, row)


@admin_router.post("/sources/{source_id}/sync/accept")
def accept(source_id: str, payload: AcceptSync, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    lock_active_user(db, admin.id)
    return source_record(db, service.accept(db, source_id, int(payload.expected_generation)))
