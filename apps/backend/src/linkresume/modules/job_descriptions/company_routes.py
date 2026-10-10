from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from minio.error import S3Error
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.job_descriptions.company_service import company_record, normalize_name
from linkresume.application.job_descriptions.logo_service import MAX_STORED_LOGO_BYTES
from linkresume.core.database import get_db, utc_now
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.modules.identity.dependencies import get_current_admin, lock_active_user
from linkresume.modules.identity.models import User
from linkresume.modules.job_descriptions.models import GlobalCompany
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


@admin_router.patch("/{company_id}")
def update_company(company_id: str, payload: CompanyUpdate, db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)):
    if not lock_active_user(db, admin.id).is_admin:
        raise ApiError(403, "FORBIDDEN")
    if not re.fullmatch(r"[1-9][0-9]{0,19}", company_id) or int(company_id) > 2**64 - 1:
        raise ApiError(404, "COMPANY_NOT_FOUND")
    company = db.scalar(select(GlobalCompany).where(GlobalCompany.id == int(company_id))
        .with_for_update().execution_options(populate_existing=True))
    if company is None:
        raise ApiError(404, "COMPANY_NOT_FOUND")
    if str(company.lock_version) != payload.base_version:
        raise ApiError(409, "COMPANY_CONFLICT")
    if "aliases" in payload.model_fields_set:
        company.aliases = payload.aliases
    if "logo_url" in payload.model_fields_set:
        company.logo_url = payload.logo_url
        company.logo_source = "admin"
    company.lock_version += 1
    company.update_time = utc_now()
    db.commit()
    return company_record(company)


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
