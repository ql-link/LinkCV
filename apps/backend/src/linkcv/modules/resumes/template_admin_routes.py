from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import parse_decimal_id
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.modules.identity.dependencies import get_current_admin
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import ResumeTemplate
from linkcv.modules.resumes.template_packages import (
    TEMPLATE_PACKAGE_MAX_BYTES,
    parse_template_package,
)

router = APIRouter(prefix="/admin/resume-templates", tags=["admin-resume-templates"])


class AdminTemplateRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    key: str
    name: str
    description: str | None
    data: dict | None
    style: dict | None
    active: bool
    valid: bool
    validation_error: str | None


class AdminTemplateListResponse(BaseModel):
    templates: list[AdminTemplateRecord]


class AdminTemplateResponse(BaseModel):
    template: AdminTemplateRecord


class AdminTemplateStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool


def admin_template_record(template: ResumeTemplate) -> AdminTemplateRecord:
    try:
        snapshot = parse_resume_snapshot(template.data_json, template.style_json)
    except ValueError:
        return AdminTemplateRecord(
            id=str(template.id),
            key=template.key,
            name=template.name,
            description=template.description,
            data=None,
            style=None,
            active=bool(template.is_active),
            valid=False,
            validation_error="TEMPLATE_SCHEMA_INVALID",
        )
    return AdminTemplateRecord(
        id=str(template.id),
        key=template.key,
        name=template.name,
        description=template.description,
        data=snapshot.data.model_dump(mode="json"),
        style=snapshot.style.model_dump(mode="json"),
        active=bool(template.is_active),
        valid=True,
        validation_error=None,
    )


@router.get("", response_model=AdminTemplateListResponse)
def list_admin_templates(
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminTemplateListResponse:
    templates = db.scalars(select(ResumeTemplate).order_by(ResumeTemplate.id)).all()
    return AdminTemplateListResponse(
        templates=[admin_template_record(template) for template in templates]
    )


@router.post("/import", response_model=AdminTemplateResponse, status_code=201)
async def import_admin_template(
    file: UploadFile = File(...),
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminTemplateResponse:
    try:
        content = await file.read(TEMPLATE_PACKAGE_MAX_BYTES + 1)
    finally:
        await file.close()
    try:
        package = parse_template_package(content)
    except ValueError as error:
        raise ApiError(400, "INVALID_TEMPLATE_PACKAGE") from error
    template = ResumeTemplate(
        key=package.key,
        name=package.name,
        description=package.description,
        data_json=package.data.model_dump(mode="json"),
        style_json=package.style.model_dump(mode="json"),
        is_active=0,
    )
    db.add(template)
    try:
        db.commit()
        db.refresh(template)
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "TEMPLATE_KEY_CONFLICT") from error
    return AdminTemplateResponse(template=admin_template_record(template))


@router.put("/{template_id}/status", response_model=AdminTemplateResponse)
def update_admin_template_status(
    template_id: str,
    payload: AdminTemplateStatusRequest,
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminTemplateResponse:
    parsed_id = parse_decimal_id(template_id)
    template = (
        db.scalar(
            select(ResumeTemplate)
            .where(ResumeTemplate.id == parsed_id)
            .with_for_update()
        )
        if parsed_id is not None
        else None
    )
    if template is None:
        raise ApiError(404, "TEMPLATE_NOT_FOUND")
    if payload.active:
        try:
            parse_resume_snapshot(template.data_json, template.style_json)
        except ValueError as error:
            db.rollback()
            raise ApiError(400, "TEMPLATE_CONTENT_INVALID") from error
    template.is_active = 1 if payload.active else 0
    db.commit()
    db.refresh(template)
    return AdminTemplateResponse(template=admin_template_record(template))
