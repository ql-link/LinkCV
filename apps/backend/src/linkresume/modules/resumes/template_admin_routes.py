from typing import Literal

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import (
    parse_decimal_id,
    parse_persisted_template_snapshot,
)
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.domain.resume import compile_layout_plan
from linkresume.modules.identity.dependencies import get_current_admin
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import ResumeTemplate
from linkresume.modules.resumes.template_packages import (
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
    style_categories: list[str]
    use_cases: list[str]
    style_review_status: Literal["pending", "classified", "unsure"]
    sort_order: int
    data: dict | None
    style: dict | None
    layout_plan: dict | None
    active: bool
    valid: bool
    validation_error: str | None
    switchable: bool
    incompatibility_reason: str | None


class AdminTemplateListResponse(BaseModel):
    templates: list[AdminTemplateRecord]


class AdminTemplateResponse(BaseModel):
    template: AdminTemplateRecord


class AdminTemplateStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool


class AdminTemplateSortOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sort_order: int = Field(strict=True, ge=0, le=1000000)


class AdminTemplateClassificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    style_categories: list[Literal["简约", "经典", "现代", "创意"]]
    use_cases: list[Literal["实习", "校招", "社招"]]
    style_review_status: Literal["pending", "classified", "unsure"]

    @model_validator(mode="after")
    def validate_classification(self):
        if len(set(self.style_categories)) != len(self.style_categories):
            raise ValueError("duplicate style categories")
        if len(set(self.use_cases)) != len(self.use_cases):
            raise ValueError("duplicate use cases")
        if (self.style_review_status == "classified") != bool(self.style_categories):
            raise ValueError("style review status must match selected styles")
        return self


def admin_template_record(template: ResumeTemplate) -> AdminTemplateRecord:
    try:
        snapshot = parse_persisted_template_snapshot(
            template.data_json,
            template.style_json,
        )
    except (TypeError, ValueError):
        return AdminTemplateRecord(
            id=str(template.id),
            key=template.key,
            name=template.name,
            description=template.description,
            style_categories=template.style_categories_json or [],
            use_cases=template.use_cases_json or [],
            style_review_status=template.style_review_status,
            sort_order=template.sort_order,
            data=None,
            style=None,
            layout_plan=None,
            active=bool(template.is_active),
            valid=False,
            validation_error="TEMPLATE_SCHEMA_INVALID",
            switchable=False,
            incompatibility_reason="TEMPLATE_SCHEMA_INVALID",
        )
    return AdminTemplateRecord(
        id=str(template.id),
        key=template.key,
        name=template.name,
        description=template.description,
        style_categories=template.style_categories_json or [],
        use_cases=template.use_cases_json or [],
        style_review_status=template.style_review_status,
        sort_order=template.sort_order,
        data=snapshot.data.model_dump(mode="json"),
        style=snapshot.style.model_dump(mode="json"),
        layout_plan=compile_layout_plan(snapshot.data, snapshot.style).model_dump(
            mode="json"
        ),
        active=bool(template.is_active),
        valid=True,
        validation_error=None,
        switchable=True,
        incompatibility_reason=None,
    )


@router.get("", response_model=AdminTemplateListResponse)
def list_admin_templates(
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminTemplateListResponse:
    templates = db.scalars(
        select(ResumeTemplate).order_by(ResumeTemplate.sort_order, ResumeTemplate.id)
    ).all()
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
        sort_order=min(
            1000000,
            (db.scalar(select(func.max(ResumeTemplate.sort_order))) or 0) + 10,
        ),
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
            parse_persisted_template_snapshot(
                template.data_json,
                template.style_json,
            )
        except (TypeError, ValueError) as error:
            db.rollback()
            raise ApiError(400, "TEMPLATE_CONTENT_INVALID") from error
    template.is_active = 1 if payload.active else 0
    db.commit()
    db.refresh(template)
    return AdminTemplateResponse(template=admin_template_record(template))


@router.put("/{template_id}/classification", response_model=AdminTemplateResponse)
def update_admin_template_classification(
    template_id: str,
    payload: AdminTemplateClassificationRequest,
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminTemplateResponse:
    parsed_id = parse_decimal_id(template_id)
    template = (
        db.scalar(select(ResumeTemplate).where(ResumeTemplate.id == parsed_id).with_for_update())
        if parsed_id is not None
        else None
    )
    if template is None:
        raise ApiError(404, "TEMPLATE_NOT_FOUND")
    template.style_categories_json = payload.style_categories
    template.use_cases_json = payload.use_cases
    template.style_review_status = payload.style_review_status
    db.commit()
    db.refresh(template)
    return AdminTemplateResponse(template=admin_template_record(template))


@router.put("/{template_id}/sort-order", response_model=AdminTemplateResponse)
def update_admin_template_sort_order(
    template_id: str,
    payload: AdminTemplateSortOrderRequest,
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminTemplateResponse:
    parsed_id = parse_decimal_id(template_id)
    template = (
        db.scalar(select(ResumeTemplate).where(ResumeTemplate.id == parsed_id).with_for_update())
        if parsed_id is not None
        else None
    )
    if template is None:
        raise ApiError(404, "TEMPLATE_NOT_FOUND")
    template.sort_order = payload.sort_order
    db.commit()
    db.refresh(template)
    return AdminTemplateResponse(template=admin_template_record(template))
