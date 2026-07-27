from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import parse_decimal_id
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.modules.resumes.models import ResumeTemplate
from linkcv.modules.resumes.schemas import (
    ResumeTemplateListResponse,
    ResumeTemplateRecord,
    ResumeTemplateResponse,
)

router = APIRouter(prefix="/resume-templates", tags=["resume-templates"])


def template_record(template: ResumeTemplate) -> ResumeTemplateRecord:
    try:
        snapshot = parse_resume_snapshot(template.data_json, template.style_json)
    except ValueError as error:
        raise ApiError(500, "TEMPLATE_SCHEMA_INVALID") from error
    return ResumeTemplateRecord(
        id=str(template.id),
        key=template.key,
        name=template.name,
        description=template.description,
        data=snapshot.data,
        style=snapshot.style,
    )


@router.get("", response_model=ResumeTemplateListResponse)
def list_templates(db: Session = Depends(get_db)) -> ResumeTemplateListResponse:
    templates = db.scalars(
        select(ResumeTemplate)
        .where(ResumeTemplate.is_active == 1)
        .order_by(ResumeTemplate.id)
    ).all()
    return ResumeTemplateListResponse(
        templates=[template_record(template) for template in templates]
    )


@router.get("/{template_id}", response_model=ResumeTemplateResponse)
def get_template(
    template_id: str,
    db: Session = Depends(get_db),
) -> ResumeTemplateResponse:
    parsed_id = parse_decimal_id(template_id)
    template = (
        db.scalar(
            select(ResumeTemplate).where(
                ResumeTemplate.id == parsed_id,
                ResumeTemplate.is_active == 1,
            )
        )
        if parsed_id is not None
        else None
    )
    if template is None:
        raise ApiError(404, "TEMPLATE_NOT_FOUND")
    return ResumeTemplateResponse(template=template_record(template))
