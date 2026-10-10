from __future__ import annotations

import re
from datetime import timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from minio.error import S3Error
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.job_descriptions.company_service import (
    company_candidates,
    company_record,
    fingerprint_record,
    normalize_name,
    review_fingerprint,
    set_company_logo,
)
from linkresume.application.job_descriptions.logo_fetch import fetch_logo
from linkresume.application.job_descriptions.logo_service import MAX_LOGO_BYTES, MAX_STORED_LOGO_BYTES, normalize_logo
from linkresume.core.database import get_db, utc_now
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.modules.identity.dependencies import get_current_admin, lock_active_user
from linkresume.modules.identity.models import User
from linkresume.modules.job_descriptions.models import (
    GlobalCompany,
    GlobalCompanyLogoFingerprint,
    GlobalCompanyUnmatchedName,
)
from linkresume.modules.job_descriptions.schemas import _validate_optional_https_url

admin_router = APIRouter(prefix="/admin/companies", tags=["admin-companies"])
public_router = APIRouter(prefix="/company-logos", tags=["company-logos"])


class CompanyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_version: str = Field(pattern=r"^(0|[1-9][0-9]{0,19})$")
    aliases: list[Annotated[str, Field(min_length=1, max_length=200)]] | None = Field(default=None, max_length=30)
    logo_url: str | None = Field(default=None, max_length=2048)

    @field_validator("aliases")
    @classmethod
    def clean_aliases(cls, values):
        if values is None:
            raise ValueError("aliases must be an array")
        result, seen = [], set()
        for value in values:
            key = normalize_name(value)
            if not key:
                raise ValueError("alias cannot be blank")
            if key not in seen:
                result.append(value.strip())
                seen.add(key)
        return result

    @field_validator("logo_url")
    @classmethod
    def clean_logo(cls, value):
        # null clears the logo; a string is downloaded and stored by the server.
        if value is None:
            return None
        result = _validate_optional_https_url(value)
        if not result:
            raise ValueError("logo URL cannot be empty")
        return result

    @model_validator(mode="after")
    def require_change(self):
        if not ({"aliases", "logo_url"} & self.model_fields_set):
            raise ValueError("a changed field is required")
        return self


@admin_router.get("")
def list_companies(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return {"items": [company_record(company) for company in db.scalars(
        select(GlobalCompany).order_by(GlobalCompany.company_name, GlobalCompany.id))]}


def _company_id(company_id: str) -> int:
    if not re.fullmatch(r"[1-9][0-9]{0,19}", company_id) or int(company_id) > 2**64 - 1:
        raise ApiError(404, "COMPANY_NOT_FOUND")
    return int(company_id)


def _require_admin(db, admin) -> None:
    if not lock_active_user(db, admin.id).is_admin:
        raise ApiError(403, "FORBIDDEN")


def _limit_logo_writes(request: Request, admin: User) -> None:
    try:
        key = f"company-logo:admin:{admin.id}"
        count = request.app.state.redis.incr(key)
        if count == 1:
            request.app.state.redis.expire(key, 60)
    except Exception as error:
        raise ApiError(503, "COMPANY_LOGO_UNAVAILABLE") from error
    if count > 30:
        raise ApiError(429, "COMPANY_LOGO_RATE_LIMITED")


def _locked_company(db, company_id: int, base_version: str):
    company = db.scalar(select(GlobalCompany).where(GlobalCompany.id == company_id)
        .with_for_update().execution_options(populate_existing=True))
    if company is None:
        raise ApiError(404, "COMPANY_NOT_FOUND")
    if str(company.lock_version) != base_version:
        raise ApiError(409, "COMPANY_CONFLICT")
    return company


def _write_admin_logo(db, storage, company_id: int, base_version: str, normalized: bytes | None, aliases=None):
    # The image is fetched and normalized before any row lock; the version check
    # is repeated inside the locked write so a stale editor still gets 409.
    _locked_company(db, company_id, base_version)
    db.rollback()
    try:
        if not set_company_logo(db, storage, company_id, "admin", normalized):
            raise ApiError(404, "COMPANY_NOT_FOUND")
        company = db.get(GlobalCompany, company_id)
        if str(company.lock_version - 1) != base_version:
            raise ApiError(409, "COMPANY_CONFLICT")
        if aliases is not None:
            company.aliases = aliases
        db.commit()
    except ApiError:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise ApiError(503, "COMPANY_LOGO_SAVE_FAILED") from error
    return company_record(company)


@admin_router.patch("/{company_id}")
def update_company(company_id: str, payload: CompanyUpdate, request: Request, db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin), storage: AssetStorage = Depends(get_storage)):
    _require_admin(db, admin)
    identifier = _company_id(company_id)
    if "logo_url" in payload.model_fields_set:
        _limit_logo_writes(request, admin)
        _locked_company(db, identifier, payload.base_version)
        db.rollback()
        normalized = normalize_logo(fetch_logo(payload.logo_url)) if payload.logo_url else None
        aliases = payload.aliases if "aliases" in payload.model_fields_set else None
        return _write_admin_logo(db, storage, identifier, payload.base_version, normalized, aliases)
    company = _locked_company(db, identifier, payload.base_version)
    company.aliases = payload.aliases
    company.lock_version += 1
    company.update_time = utc_now()
    db.commit()
    return company_record(company)


@admin_router.put("/{company_id}/logo")
def upload_company_logo(company_id: str, request: Request, file: UploadFile = File(),
    base_version: str = Form(pattern=r"^(0|[1-9][0-9]{0,19})$"), db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin), storage: AssetStorage = Depends(get_storage)):
    _require_admin(db, admin)
    identifier = _company_id(company_id)
    _limit_logo_writes(request, admin)
    _locked_company(db, identifier, base_version)
    db.rollback()
    normalized = normalize_logo(file.file.read(MAX_LOGO_BYTES + 1))
    return _write_admin_logo(db, storage, identifier, base_version, normalized)


class AssignUnmatched(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    base_version: str = Field(pattern=r"^(0|[1-9][0-9]{0,19})$")


def _unmatched(db, name_id: str, *, lock=False):
    if not re.fullmatch(r"[1-9][0-9]{0,19}", name_id) or int(name_id) > 2**64 - 1:
        raise ApiError(404, "UNMATCHED_NAME_NOT_FOUND")
    statement = select(GlobalCompanyUnmatchedName).where(GlobalCompanyUnmatchedName.id == int(name_id))
    row = db.scalar(statement.with_for_update() if lock else statement)
    if row is None:
        raise ApiError(404, "UNMATCHED_NAME_NOT_FOUND")
    return row


@admin_router.get("/unmatched-names")
def list_unmatched_names(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    rows = db.scalars(select(GlobalCompanyUnmatchedName).where(GlobalCompanyUnmatchedName.is_ignored == 0)
        .order_by(GlobalCompanyUnmatchedName.hit_count.desc(), GlobalCompanyUnmatchedName.id).limit(200))
    return {"items": [{"id": str(row.id), "name": row.display_name, "hit_count": row.hit_count,
        "last_seen_at": row.last_seen_time if row.last_seen_time.tzinfo else row.last_seen_time.replace(tzinfo=timezone.utc)} for row in rows]}


@admin_router.post("/unmatched-names/{name_id}/assign")
def assign_unmatched_name(name_id: str, payload: AssignUnmatched, db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)):
    _require_admin(db, admin)
    row = _unmatched(db, name_id, lock=True)
    company = _locked_company(db, _company_id(payload.company_id), payload.base_version)
    if any(other.id != company.id for other in company_candidates(db, row.display_name)):
        raise ApiError(409, "COMPANY_ALIAS_TAKEN")
    aliases = list(company.aliases or [])
    if row.normalized_name not in {normalize_name(value) for value in (company.company_name, *aliases)}:
        if len(aliases) >= 30:
            raise ApiError(400, "COMPANY_INVALID")
        aliases.append(row.display_name)
    company.aliases = aliases
    company.lock_version += 1
    company.update_time = utc_now()
    db.delete(row)
    db.commit()
    return company_record(company)


@admin_router.post("/unmatched-names/{name_id}/ignore", status_code=204)
def ignore_unmatched_name(name_id: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    _require_admin(db, admin)
    row = _unmatched(db, name_id, lock=True)
    row.is_ignored = 1
    db.commit()
    return Response(status_code=204)


@admin_router.get("/logo-fingerprints")
def list_logo_fingerprints(status: str = Query("suspected", pattern=r"^(suspected|placeholder|allowed)$"),
    db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    rows = db.scalars(select(GlobalCompanyLogoFingerprint).where(GlobalCompanyLogoFingerprint.review_status == status)
        .order_by(GlobalCompanyLogoFingerprint.company_count.desc(), GlobalCompanyLogoFingerprint.id).limit(200))
    return {"items": [fingerprint_record(row) for row in rows]}


def _fingerprint_id(value: str) -> int:
    if not re.fullmatch(r"[1-9][0-9]{0,19}", value) or int(value) > 2**64 - 1:
        raise ApiError(404, "COMPANY_LOGO_FINGERPRINT_NOT_FOUND")
    return int(value)


@admin_router.post("/logo-fingerprints/{fingerprint_id}/mark-placeholder")
def mark_placeholder(fingerprint_id: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    _require_admin(db, admin)
    return review_fingerprint(db, _fingerprint_id(fingerprint_id), "placeholder")


@admin_router.post("/logo-fingerprints/{fingerprint_id}/allow")
def allow_fingerprint(fingerprint_id: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    _require_admin(db, admin)
    return review_fingerprint(db, _fingerprint_id(fingerprint_id), "allowed")


@public_router.get("/{filename}", response_model=None)
def read_public_logo(filename: str, request: Request, storage: AssetStorage = Depends(get_storage)):
    if not re.fullmatch(r"[0-9a-f]{64}\.webp", filename):
        raise ApiError(404, "COMPANY_LOGO_NOT_FOUND")
    etag = f'"{filename[:-5]}"'
    headers = {"Cache-Control": "public, max-age=31536000, immutable", "ETag": etag,
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"}
    try:
        remote = storage.get(f"public-company-logos/{filename}")
        try:
            matches = {value.strip().removeprefix("W/") for value in request.headers.get("if-none-match", "").split(",")}
            if etag in matches or "*" in matches:
                return Response(status_code=304, headers=headers)
            data = remote.read(MAX_STORED_LOGO_BYTES + 1)
            if not data or len(data) > MAX_STORED_LOGO_BYTES:
                raise ApiError(503, "COMPANY_LOGO_READ_FAILED")
        finally:
            remote.close()
            remote.release_conn()
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "COMPANY_LOGO_NOT_FOUND") from error
        raise ApiError(503, "COMPANY_LOGO_READ_FAILED") from error
    except ApiError:
        raise
    except Exception as error:
        raise ApiError(503, "COMPANY_LOGO_READ_FAILED") from error
    return Response(content=data, media_type="image/webp", headers=headers)
