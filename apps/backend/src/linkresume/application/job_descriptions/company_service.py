"""Shared company identity and its single logo pipeline.

Every company logo write goes through `set_company_logo`: callers pass
normalized WebP bytes, the image is stored under `public-company-logos/`, and
the priority admin > official > plugin is decided here. Ambiguous names never
publish a personal image.
"""
from __future__ import annotations

import hashlib
import logging
import unicodedata

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.job_descriptions.models import (
    GlobalCompany,
    GlobalCompanyLogoFingerprint,
    GlobalCompanyUnmatchedName,
)

logger = logging.getLogger(__name__)

# Different company names sharing one image before it stops being shared.
PLACEHOLDER_COMPANY_THRESHOLD = 3
# Hamming distance on the 64-bit dHash still treated as the same placeholder.
PLACEHOLDER_DISTANCE = 6
# Company names kept per image group: enough to count past the threshold and show examples.
MAX_GROUP_NAMES = 20


def normalize_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def company_candidates(db, name: str, legal_name: str | None = None):
    names = {normalize_name(value) for value in (name, legal_name) if value and value.strip()}
    # The catalog is small. Matching includes JSON aliases without adding a
    # globally unique alias constraint that would merge unrelated namesakes.
    candidates = []
    for company in db.scalars(select(GlobalCompany).order_by(GlobalCompany.id)):
        known = {normalize_name(value) for value in (company.company_name, company.normalized_name,
            company.legal_name, *(company.aliases or [])) if value}
        if names & known:
            candidates.append(company)
    return candidates


def match_company(db, name: str, legal_name: str | None = None):
    candidates = company_candidates(db, name, legal_name)
    return candidates[0] if len(candidates) == 1 else None


def apply_company_default(db, job) -> None:
    # An imported page's external image URL never becomes a shared default:
    # only uploaded, normalized bytes can (see `record_plugin_logo`).
    if job.logo_url or job.logo_sha256:
        return
    company = match_company(db, job.company_name, job.company_legal_name)
    if company is not None:
        job.logo_url = company.logo_url


def public_logo_url(digest: str) -> str:
    return f"/api/company-logos/{digest}.webp"


def _can_write(company, source: str, digest: str | None) -> bool:
    if source == "admin":
        return True
    if company.logo_source == "admin":
        return False  # An admin choice, including a cleared logo, is final.
    if source == "official":
        return company.logo_url != public_logo_url(digest)
    return company.logo_url is None  # plugin: fill a missing default only


def set_company_logo(db, storage, company_id: int, source: str, normalized: bytes | None) -> bool:
    """Apply one company logo write; `normalized=None` (admin only) clears it.

    The object is written before the row lock so lock order stays content -> row,
    matching personal uploads. Returns whether the company changed. Does not commit.
    """
    from linkresume.application.job_descriptions.logo_service import logo_dhash, store_public_logo

    if normalized is None and source != "admin":
        raise ValueError("only an admin can clear a company logo")
    digest = hashlib.sha256(normalized).hexdigest() if normalized is not None else None
    current = db.get(GlobalCompany, company_id, populate_existing=True)
    if current is None or not _can_write(current, source, digest):
        return False
    url = store_public_logo(db, storage, normalized, digest) if normalized is not None else None
    company = db.scalar(select(GlobalCompany).where(GlobalCompany.id == company_id)
        .with_for_update().execution_options(populate_existing=True))
    if company is None or not _can_write(company, source, digest):
        return False
    company.logo_url = url
    company.logo_dhash = logo_dhash(normalized) if normalized is not None else None
    company.logo_source = source
    company.lock_version += 1
    company.update_time = utc_now()
    return True


def _placeholder_match(db, dhash: str):
    from linkresume.application.job_descriptions.logo_service import dhash_distance

    for row in db.scalars(select(GlobalCompanyLogoFingerprint)
            .where(GlobalCompanyLogoFingerprint.review_status == "placeholder")):
        if dhash_distance(row.dhash, dhash) <= PLACEHOLDER_DISTANCE:
            return row
    return None


def _locked_fingerprint(db, dhash: str, digest: str):
    statement = (select(GlobalCompanyLogoFingerprint).where(GlobalCompanyLogoFingerprint.dhash == dhash)
        .with_for_update().execution_options(populate_existing=True))
    row = db.scalar(statement)
    if row is not None:
        return row
    try:
        with db.begin_nested():
            db.add(GlobalCompanyLogoFingerprint(dhash=dhash, sample_sha256=digest))
    except IntegrityError:
        pass  # A concurrent upload created the group first.
    return db.scalar(statement)


def _observe(db, storage, fingerprint, name: str, normalized: bytes, digest: str) -> None:
    from linkresume.application.job_descriptions.logo_service import store_public_logo

    names = list(fingerprint.company_names or [])
    if name in names or len(names) >= MAX_GROUP_NAMES:
        return
    fingerprint.company_names = [*names, name]
    fingerprint.company_count = len(names) + 1
    if fingerprint.review_status == "normal" and fingerprint.company_count >= PLACEHOLDER_COMPANY_THRESHOLD:
        # The fingerprint row is locked, so concurrent uploads cross the threshold once.
        # An image shared by several company names is not anyone's private upload.
        store_public_logo(db, storage, normalized, digest)
        fingerprint.sample_sha256 = digest
        fingerprint.review_status = "suspected"


def record_unmatched_name(db, name: str) -> None:
    key = normalize_name(name)
    if not key or len(key) > 200:
        return
    display = name.strip()[:200]
    now = utc_now()
    statement = (select(GlobalCompanyUnmatchedName).where(GlobalCompanyUnmatchedName.normalized_name == key)
        .with_for_update())
    row = db.scalar(statement)
    if row is None:
        try:
            with db.begin_nested():
                db.add(GlobalCompanyUnmatchedName(normalized_name=key, display_name=display, last_seen_time=now))
            return
        except IntegrityError:
            row = db.scalar(statement)
    row.hit_count += 1
    row.display_name = display
    row.last_seen_time = now


def record_plugin_logo(db, storage, job, normalized: bytes, digest: str) -> bool:
    """Observe a plugin upload and maybe publish it as the company default.

    Returns False when the image is a confirmed placeholder; the caller then keeps
    the personal job without an image. Records only company names and image hashes.
    """
    from linkresume.application.job_descriptions.logo_service import is_low_quality_logo, logo_dhash

    dhash = logo_dhash(normalized)
    if _placeholder_match(db, dhash) is not None:
        return False
    name = normalize_name(job.company_name or "")
    fingerprint = None
    if name and len(name) <= 200:
        fingerprint = _locked_fingerprint(db, dhash, digest)
        if fingerprint.review_status == "placeholder":
            return False
        _observe(db, storage, fingerprint, name, normalized, digest)
    candidates = company_candidates(db, job.company_name or "", job.company_legal_name)
    if not candidates:
        record_unmatched_name(db, job.company_name or "")
        return True
    if len(candidates) > 1 or is_low_quality_logo(normalized):
        return True
    if fingerprint is not None and fingerprint.review_status == "suspected":
        return True
    try:
        with db.begin_nested():
            set_company_logo(db, storage, candidates[0].id, "plugin", normalized)
    except Exception:
        logger.warning("Shared company logo storage unavailable")
    return True  # Sharing is optional; a user's own image must still save.


def review_fingerprint(db, fingerprint_id: int, status: str) -> dict:
    fingerprint = db.scalar(select(GlobalCompanyLogoFingerprint).where(GlobalCompanyLogoFingerprint.id == fingerprint_id)
        .with_for_update().execution_options(populate_existing=True))
    if fingerprint is None:
        raise ApiError(404, "COMPANY_LOGO_FINGERPRINT_NOT_FOUND")
    cleared = 0
    if status == "placeholder" and fingerprint.review_status != "placeholder":
        for company in db.scalars(select(GlobalCompany).where(GlobalCompany.logo_source == "plugin",
                GlobalCompany.logo_dhash == fingerprint.dhash).with_for_update()):
            company.logo_url = None
            company.logo_dhash = None
            company.logo_source = "unknown"
            company.lock_version += 1
            company.update_time = utc_now()
            cleared += 1
    fingerprint.review_status = status
    db.commit()
    return {"id": str(fingerprint.id), "status": status, "cleared_company_count": cleared}


def fingerprint_record(fingerprint) -> dict:
    # company_count stops at MAX_GROUP_NAMES; consumers show it as "20+".
    return {"id": str(fingerprint.id), "image_url": public_logo_url(fingerprint.sample_sha256),
        "company_count": fingerprint.company_count, "sample_names": list(fingerprint.company_names or [])[:5],
        "status": fingerprint.review_status}


def company_record(company):
    return {"id": str(company.id), "name": company.company_name, "aliases": company.aliases or [],
        "logo_url": company.logo_url, "logo_source": company.logo_source,
        "lock_version": str(company.lock_version)}
