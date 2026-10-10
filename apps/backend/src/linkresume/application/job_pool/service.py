from __future__ import annotations

import base64
import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.mysql import match
from sqlalchemy.orm import Session, load_only

from linkresume.application.interviews.service import ensure_pending_application_for_job
from linkresume.application.job_descriptions.service import DuplicateJobDescription, create_or_resolve_job
from linkresume.application.job_pool.catalog import CATALOG, entry_for
from linkresume.application.job_pool.logos import safe_logo_url
from linkresume.application.job_pool.scope import SCOPE_VERSION
from linkresume.application.job_pool.types import JobObservation, SyncResult
from linkresume.application.resumes.service import parse_decimal_id
from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.identity.dependencies import lock_active_user
from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.job_descriptions.models import GlobalCompany, JobDescription
from linkresume.modules.job_descriptions.schemas import JobDescriptionCreateRequest
from linkresume.modules.job_pool.models import GlobalJob, GlobalJobSource


def aware(value: datetime | None):
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def id_value(value: str, code="JOB_POOL_NOT_FOUND") -> int:
    identifier = parse_decimal_id(value)
    if identifier is None:
        raise ApiError(404, code)
    return identifier


def source_row(db, source_id, *, lock=False):
    statement = select(GlobalJobSource).where(GlobalJobSource.id == id_value(str(source_id), "JOB_SOURCE_NOT_FOUND"))
    source = db.scalar(statement.with_for_update() if lock else statement)
    if source is None:
        raise ApiError(404, "JOB_SOURCE_NOT_FOUND")
    return source


def register_catalog(session_factory) -> None:
    """Idempotently create every preset company and source; existing rows are untouched."""
    from sqlalchemy.exc import IntegrityError

    for attempt in range(2):
        with session_factory() as db:
            try:
                bootstrap(db)
                return
            except IntegrityError:
                # Another instance registered the same entries concurrently; unique keys win.
                db.rollback()
                if attempt:
                    raise


def bootstrap(db: Session):
    # Serialize first-time registration without needing another table or Redis key.
    companies = list(db.scalars(select(GlobalCompany).order_by(GlobalCompany.id).with_for_update()))
    names = {row.normalized_name: row for row in companies}
    for entry in CATALOG:
        company = names.get(entry.name.casefold())
        if company is None:
            company = GlobalCompany(company_name=entry.name, normalized_name=entry.name.casefold(), website_url=entry.url)
            db.add(company)
            db.flush()
            names[entry.name.casefold()] = company
        source = db.scalar(select(GlobalJobSource).where(GlobalJobSource.adapter_key == entry.adapter, GlobalJobSource.tenant_key == entry.host))
        if source is None:
            db.add(GlobalJobSource(company_id=company.id, adapter_key=entry.adapter, tenant_key=entry.host, portal_config=entry.config(), is_enabled=0))
    db.commit()


def summary_for(source, now):
    previous = source.last_sync_result or {}
    baseline = previous.get("baseline_count")
    return {"schema_version": 1, "baseline_count": baseline, "scope_version": previous.get("scope_version"), "latest": {
        "generation": str(source.sync_generation), "baseline_count": baseline,
        "observed_count": 0, "counts": {key: 0 for key in ("created", "updated", "missing", "closed", "restored", "invalid", "filtered")},
        "is_complete": False, "is_reviewed": False, "error_code": None, "company_logo_error_code": None,
        "started_at": now.isoformat(), "finished_at": None}}


def queue_source(db, source_id, *, enabled, now=None):
    if not enabled:
        raise ApiError(409, "JOB_POOL_SYNC_DISABLED")
    source = source_row(db, source_id, lock=True)
    if not source.is_enabled:
        raise ApiError(409, "JOB_SOURCE_DISABLED")
    if source.adapter_key == "pending":
        raise ApiError(409, "JOB_SOURCE_ADAPTER_PENDING")
    now = now or utc_now()
    if source.sync_status == "queued" or (source.sync_status == "running" and aware(source.lease_until) is not None and aware(source.lease_until) > now):
        db.commit()
        return source, False
    source.sync_generation += 1
    source.sync_status = "queued"
    source.lease_until = None
    source.next_sync_at = now
    source.last_sync_result = summary_for(source, now)
    db.commit()
    return source, True


def claim_source(db, source_id, *, interval_seconds, now=None):
    source = source_row(db, source_id, lock=True)
    now = now or utc_now()
    if not source.is_enabled or source.adapter_key == "pending":
        db.rollback()
        return None
    if source.sync_status == "running" and aware(source.lease_until) and aware(source.lease_until) > now:
        db.rollback()
        return None
    if source.sync_status not in {"queued", "running"} and source.next_sync_at and aware(source.next_sync_at) > now:
        db.rollback()
        return None
    if source.sync_status != "queued":
        source.sync_generation += 1
    source.sync_status = "running"
    source.lease_until = now + timedelta(seconds=120)
    source.next_sync_at = now + timedelta(seconds=interval_seconds)
    source.last_sync_result = summary_for(source, now)
    task = (source.id, source.sync_generation, source.adapter_key, source.tenant_key, copy.deepcopy(source.portal_config))
    db.commit()
    return task


def leased_source(db, source_id, generation, now):
    source = source_row(db, source_id, lock=True)
    if (not source.is_enabled or source.sync_generation != generation or source.sync_status != "running"
            or aware(source.lease_until) is None or aware(source.lease_until) <= now):
        db.rollback()
        return None
    return source


def renew(db, source_id, generation, now=None):
    now = now or utc_now()
    source = leased_source(db, source_id, generation, now)
    if source is None:
        return False
    source.lease_until = now + timedelta(seconds=120)
    db.commit()
    return True


def write_observations(db, source_id, generation, jobs: list[JobObservation], now=None):
    now = now or utc_now()
    source = leased_source(db, source_id, generation, now)
    if source is None:
        return False
    summary = copy.deepcopy(source.last_sync_result)
    counts = summary["latest"]["counts"]
    for observed in jobs:
        job = db.scalar(select(GlobalJob).where(GlobalJob.source_id == source_id, GlobalJob.source_job_key == observed.source_job_key).with_for_update())
        values = observed.model_dump()
        if job is None:
            job = GlobalJob(source_id=source_id, **values, last_seen_at=now, last_seen_generation=generation, create_time=now, update_time=now)
            db.add(job)
            counts["created"] += 1
            db.flush()
        else:
            changed = False
            for field, value in values.items():
                before = getattr(job, field)
                if field == "published_at":
                    before = aware(before)
                if before != value:
                    setattr(job, field, value)
                    changed = True
            if changed:
                counts["updated"] += 1
            if job.availability_status != "active":
                counts["restored"] += 1
        job.last_seen_at = now
        job.last_seen_generation = generation
        job.availability_status = "active"
        job.missing_count = 0
        job.missing_since = None
        job.update_time = now
    source.last_sync_result = summary
    db.commit()
    return True


def missing_jobs(db, source, now, counts):
    # The source_id prefix of the unique identity index scopes this scan.
    rows = db.scalars(select(GlobalJob).where(GlobalJob.source_id == source.id,
        GlobalJob.last_seen_generation < source.sync_generation,
        GlobalJob.availability_status != "closed").order_by(GlobalJob.id).with_for_update())
    for job in rows:
        job.missing_count += 1
        if job.missing_since is None:
            job.missing_since = now
        if job.missing_count >= 2 and now - aware(job.missing_since) >= timedelta(hours=24):
            job.availability_status = "closed"
            counts["closed"] += 1
        elif job.availability_status != "missing":
            job.availability_status = "missing"
            counts["missing"] += 1
        job.update_time = now


def official_logo(db, storage, source, result: SyncResult) -> str | None:
    """Store the careers page artwork through the shared company logo pipeline.

    Returns an artwork error code; artwork never changes the job sync outcome.
    """
    from linkresume.application.job_descriptions.company_service import _placeholder_match, set_company_logo
    from linkresume.application.job_descriptions.logo_service import logo_dhash, normalize_logo

    if result.company_logo_bytes is None or storage is None:
        return result.company_logo_error_code
    if not safe_logo_url(entry_for(source.adapter_key, source.tenant_key, source.portal_config), result.company_logo_url):
        return "JOB_SOURCE_LOGO_NOT_FOUND"
    try:
        normalized = normalize_logo(result.company_logo_bytes)
    except ApiError:
        return "JOB_SOURCE_LOGO_INVALID"
    if _placeholder_match(db, logo_dhash(normalized)) is not None:
        return "JOB_SOURCE_LOGO_PLACEHOLDER"
    try:
        with db.begin_nested():
            set_company_logo(db, storage, source.company_id, "official", normalized)
    except Exception:
        return "JOB_SOURCE_LOGO_STORAGE_FAILED"
    return None


def finish(db, source_id, generation, result: SyncResult, now=None, storage=None):
    now = now or utc_now()
    source = leased_source(db, source_id, generation, now)
    if source is None:
        return False
    summary = copy.deepcopy(source.last_sync_result)
    latest = summary["latest"]
    logo_error = official_logo(db, storage, source, result)
    latest.update(observed_count=len(result.jobs), is_complete=result.is_complete, error_code=result.error_code,
        company_logo_error_code=logo_error, finished_at=now.isoformat())
    latest["counts"]["invalid"] = result.invalid_count
    latest["counts"]["filtered"] = result.filtered_count
    baseline = latest["baseline_count"]
    # A baseline counted under older admission rules cannot judge a drop; re-baseline once instead.
    rescoped = summary.get("scope_version") != SCOPE_VERSION
    anomaly = (not rescoped and result.is_complete and baseline is not None and baseline >= 20
        and len(result.jobs) < baseline * .5)
    source.lease_until = None
    if anomaly:
        source.sync_status = "anomalous"
        latest["error_code"] = "JOB_SOURCE_COUNT_DROP"
    elif result.is_complete:
        missing_jobs(db, source, now, latest["counts"])
        source.sync_status = "succeeded"
        source.last_complete_at = now
        summary["baseline_count"] = len(result.jobs)
        summary["scope_version"] = SCOPE_VERSION
    else:
        source.sync_status = "partial" if result.jobs else "failed"
    source.last_sync_result = summary
    db.commit()
    return True


def accept(db, source_id, generation, now=None):
    source = source_row(db, source_id, lock=True)
    latest = (source.last_sync_result or {}).get("latest", {})
    if source.sync_generation != generation or latest.get("generation") != str(generation):
        raise ApiError(409, "JOB_SYNC_STALE")
    if latest.get("is_reviewed"):
        db.commit()
        return source
    if not source.is_enabled or source.sync_status != "anomalous" or not latest.get("is_complete"):
        raise ApiError(409, "JOB_SYNC_NOT_REVIEWABLE")
    now = now or utc_now()
    summary = copy.deepcopy(source.last_sync_result)
    latest = summary["latest"]
    missing_jobs(db, source, now, latest["counts"])
    latest["is_reviewed"] = True
    source.sync_status = "succeeded"
    source.last_complete_at = now
    summary["baseline_count"] = latest["observed_count"]
    summary["scope_version"] = SCOPE_VERSION
    source.last_sync_result = summary
    db.commit()
    return source


SUMMARY_FIELDS = (GlobalJob.id, GlobalJob.source_id, GlobalJob.job_title, GlobalJob.job_category,
    GlobalJob.recruitment_channel, GlobalJob.employment_type, GlobalJob.salary_text, GlobalJob.locations,
    GlobalJob.availability_status, GlobalJob.published_at, GlobalJob.last_seen_at, GlobalJob.source_url, GlobalJob.create_time)


def joined_ids(db, user_id, ids):
    if not ids:
        return {}
    return {global_id: str(application_id) for global_id, application_id in db.execute(select(JobDescription.global_job_id, JobApplication.id)
        .join(JobApplication, and_(JobApplication.job_description_id == JobDescription.id, JobApplication.user_id == user_id))
        .where(JobDescription.user_id == user_id, JobDescription.global_job_id.in_(ids)))}


def serialize(job, company, source, joined=None, *, detail=False):
    data = {"id": str(job.id), "company": {"id": str(company.id), "name": company.company_name, "logo_url": company.logo_url},
        "title": job.job_title, "category": job.job_category, "recruitment_channel": job.recruitment_channel,
        "employment_type": job.employment_type, "salary_text": job.salary_text, "locations": job.locations,
        "availability_status": job.availability_status, "published_at": aware(job.published_at),
        "first_seen_at": aware(job.create_time), "last_seen_at": aware(job.last_seen_at), "source_url": job.source_url,
        "joined_application_id": joined, "source": {"name": company.company_name, "is_enabled": bool(source.is_enabled),
            "sync_status": source.sync_status, "last_complete_at": aware(source.last_complete_at)}}
    if detail:
        data.update(description=job.description, source_attributes=job.source_attributes)
    return data


def list_jobs(db, user_id, *, keyword=None, company_id=None, company_ids=None, city=None, job_category=None, recruitment_type=None, cursor=None, limit=20):
    keyword = keyword.strip() if keyword else ""
    city = city.strip().removesuffix("市") if city else None
    if keyword and not 2 <= len(keyword) <= 100:
        raise ApiError(400, "JOB_POOL_INVALID_QUERY")
    query = select(GlobalJob, GlobalCompany, GlobalJobSource).join(GlobalJobSource, GlobalJob.source_id == GlobalJobSource.id).join(GlobalCompany, GlobalCompany.id == GlobalJobSource.company_id)
    query = query.options(load_only(*SUMMARY_FIELDS),
        load_only(GlobalCompany.id, GlobalCompany.company_name, GlobalCompany.logo_url),
        load_only(GlobalJobSource.id, GlobalJobSource.is_enabled, GlobalJobSource.sync_status, GlobalJobSource.last_complete_at))
    query = query.where(GlobalJob.availability_status.in_(("active", "missing")))
    selected = set()
    for value in (company_ids or []) + ([company_id] if company_id else []):
        parsed = parse_decimal_id(value)
        if parsed is None:
            raise ApiError(400, "JOB_POOL_INVALID_QUERY")
        selected.add(parsed)
    selected = sorted(selected)
    if selected:
        query = query.where(GlobalCompany.id.in_(selected))
    if job_category:
        query = query.where(GlobalJob.job_category == job_category)
    if recruitment_type == "internship":
        query = query.where(GlobalJob.employment_type == "internship")
    elif recruitment_type in {"campus", "experienced"}:
        query = query.where(GlobalJob.recruitment_channel == recruitment_type)
    if city:
        if db.bind.dialect.name == "mysql":
            query = query.where(func.json_contains(func.json_extract(GlobalJob.locations, "$.cities"), json.dumps(city, ensure_ascii=False)) == 1)
        else:
            city_values = func.json_each(GlobalJob.locations, "$.cities").table_valued("value")
            query = query.where(select(1).select_from(city_values).where(city_values.c.value == city).exists())
    if keyword:
        if db.bind.dialect.name == "mysql":
            query = query.where(match(GlobalJob.job_title, GlobalJob.description, against=keyword).in_natural_language_mode())
        else:
            # SQLite is only a test substitute, not evidence of MySQL ngram behavior.
            query = query.where(or_(func.instr(GlobalJob.job_title, keyword) > 0, func.instr(GlobalJob.description, keyword) > 0))
    fingerprint = hashlib.sha256(json.dumps([keyword, [str(value) for value in selected] if company_ids else company_id, city, job_category, recruitment_type]).encode()).hexdigest()
    if cursor:
        try:
            item = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
            date = datetime.fromisoformat(item["date"])
            identifier = parse_decimal_id(item["id"])
            if item["filter"] != fingerprint or identifier is None or date.tzinfo is None or date.utcoffset() != timedelta(0):
                raise ValueError
        except (ValueError, TypeError, KeyError) as error:
            raise ApiError(400, "JOB_POOL_INVALID_CURSOR") from error
        query = query.where(or_(GlobalJob.create_time < date, and_(GlobalJob.create_time == date, GlobalJob.id < identifier)))
    rows = list(db.execute(query.order_by(GlobalJob.create_time.desc(), GlobalJob.id.desc()).limit(limit + 1)))
    page = rows[:limit]
    joined = joined_ids(db, user_id, [job.id for job, _, _ in page])
    next_cursor = None
    if len(rows) > limit:
        tail = page[-1][0]
        next_cursor = base64.urlsafe_b64encode(json.dumps({"date": aware(tail.create_time).isoformat(), "id": str(tail.id), "filter": fingerprint}).encode()).decode().rstrip("=")
    return {"items": [serialize(job, company, source, joined.get(job.id)) for job, company, source in page], "next_cursor": next_cursor}


def join_job(db, user_id, job_id):
    lock_active_user(db, user_id)
    identifier = id_value(job_id)
    source_id = db.scalar(select(GlobalJob.source_id).where(GlobalJob.id == identifier))
    if source_id is None:
        raise ApiError(404, "JOB_POOL_NOT_FOUND")
    source = source_row(db, source_id, lock=True)
    public = db.scalar(select(GlobalJob).where(GlobalJob.id == identifier).with_for_update())
    private = db.scalar(select(JobDescription).where(JobDescription.user_id == user_id, JobDescription.global_job_id == identifier).with_for_update())
    created = False
    if private is None:
        if public.availability_status == "closed":
            raise ApiError(409, "JOB_POOL_CLOSED")
        company = db.get(GlobalCompany, source.company_id)
        kind = "internship" if public.employment_type == "internship" else "campus" if public.recruitment_channel == "campus" else "full_time" if public.employment_type == "full_time" else None
        attrs = public.source_attributes
        city_text = ", ".join(public.locations["cities"])
        # Personal JDs retain their established 100-character city field. Preserve all locations in body if needed.
        work_city = city_text if len(city_text) <= 100 else next(iter(public.locations["cities"]), "")
        body = public.description if len(city_text) <= 100 else public.description + "\n\n工作地点：" + city_text
        notes = None
        if len(body) > 200_000:
            body = public.description
            notes = "工作地点：" + city_text
        payload = JobDescriptionCreateRequest(job_title=public.job_title, company_name=company.company_name,
            description=body, notes=notes, skills=[], source_type="external_import", source_url=public.source_url,
            employment_type=kind, work_city=work_city or None,
            salary_text=public.salary_text, education_requirement=attrs.get("education_requirement"),
            experience_requirement=attrs.get("experience_requirement"), logo_url=company.logo_url)
        try:
            result = create_or_resolve_job(db=db, user_id=user_id, payload=payload, commit=False)
            private, created = result.job, result.created
        except DuplicateJobDescription as duplicate:
            private = duplicate.existing
        if private.global_job_id is not None and private.global_job_id != identifier:
            raise ApiError(409, "JOB_POOL_SOURCE_CONFLICT")
        private.global_job_id = identifier
        db.flush()
    application, application_created = ensure_pending_application_for_job(db, user_id, private)
    db.commit()
    return {"job_id": str(private.id), "application_id": str(application.id), "created": created or application_created}
