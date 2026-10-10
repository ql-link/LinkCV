"""Shared company identity. Ambiguous names never publish a personal image."""
from __future__ import annotations

import logging
import unicodedata

from minio.error import S3Error
from sqlalchemy import select, update

from linkresume.core.database import utc_now
from linkresume.modules.job_descriptions.models import GlobalCompany

logger = logging.getLogger(__name__)


def normalize_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def match_company(db, name: str, legal_name: str | None = None):
    names = {normalize_name(value) for value in (name, legal_name) if value and value.strip()}
    # The catalog is small. Matching includes JSON aliases without adding a
    # globally unique alias constraint that would merge unrelated namesakes.
    candidates = []
    for company in db.scalars(select(GlobalCompany).order_by(GlobalCompany.id)):
        known = {normalize_name(value) for value in (company.company_name, company.normalized_name,
            company.legal_name, *(company.aliases or [])) if value}
        if names & known:
            candidates.append(company)
    return candidates[0] if len(candidates) == 1 else None


def fill_logo(db, company, url: str, source: str) -> bool:
    # A conditional write protects admin choices and simultaneous imports.
    result = db.execute(update(GlobalCompany).where(GlobalCompany.id == company.id,
        GlobalCompany.logo_url.is_(None)).values(logo_url=url, logo_source=source,
        lock_version=GlobalCompany.lock_version + 1, update_time=utc_now()))
    return result.rowcount == 1


def apply_company_default(db, job) -> None:
    company = match_company(db, job.company_name, job.company_legal_name)
    if company is None:
        return
    if job.source_type == "external_import" and job.logo_url:
        from urllib.parse import urlsplit
        if urlsplit(job.logo_url).scheme == "https":
            fill_logo(db, company, job.logo_url, "plugin")
    elif not job.logo_url and not job.logo_sha256:
        job.logo_url = company.logo_url


def publish_plugin_logo(db, storage, job, normalized: bytes, digest: str) -> None:
    if job.source_type != "external_import":
        return
    matched = match_company(db, job.company_name, job.company_legal_name)
    if matched is None:
        return
    company = db.scalar(select(GlobalCompany).where(GlobalCompany.id == matched.id)
        .with_for_update().execution_options(populate_existing=True))
    # Upgrade this import's URL to immutable bytes; never replace a different
    # import's default or a manually selected/official logo.
    if company.logo_url and not (company.logo_source == "plugin" and company.logo_url == job.logo_url):
        return
    try:
        # Only normalized, matched corporate images enter this public namespace.
        # Existing private job image objects remain ownership protected.
        object_name = f"public-company-logos/{digest}.webp"
        try:
            storage.stat(object_name)
        except S3Error as error:
            if error.code not in {"NoSuchKey", "NoSuchObject"}:
                raise
            storage.put(object_name, normalized, "image/webp",
                cache_control="public, max-age=31536000, immutable")
    except Exception:
        logger.warning("Shared company logo storage unavailable")
        return  # Sharing is optional; a user's own image must still save.
    company.logo_url = f"/api/company-logos/{digest}.webp"
    company.logo_source = "plugin"
    company.lock_version += 1
    company.update_time = utc_now()


def company_record(company):
    return {"id": str(company.id), "name": company.company_name, "aliases": company.aliases or [],
        "logo_url": company.logo_url, "logo_source": company.logo_source,
        "lock_version": str(company.lock_version)}
