from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import (
    parse_decimal_id,
    parse_persisted_template_snapshot,
)
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.resume import compile_layout_plan
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import ResumeTemplate
from linkcv.modules.resumes.schemas import (
    ResumeTemplateListResponse,
    ResumeTemplateRecord,
    ResumeTemplateResponse,
)

router = APIRouter(prefix="/resume-templates", tags=["resume-templates"])


def template_record(template: ResumeTemplate) -> ResumeTemplateRecord:
    try:
        snapshot = parse_persisted_template_snapshot(
            template.data_json,
            template.style_json,
        )
    except (TypeError, ValueError) as error:
        raise ApiError(500, "TEMPLATE_SCHEMA_INVALID") from error
    return ResumeTemplateRecord(
        id=str(template.id),
        key=template.key,
        name=template.name,
        description=template.description,
        data=snapshot.data,
        style=snapshot.style,
        layout_plan=compile_layout_plan(snapshot.data, snapshot.style),
    )


@router.get("", response_model=ResumeTemplateListResponse)
def list_templates(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ResumeTemplateListResponse:
    templates = db.scalars(
        select(ResumeTemplate)
        .where(ResumeTemplate.is_active == 1)
        .order_by(ResumeTemplate.id)
    ).all()
    records: list[ResumeTemplateRecord] = []
    for template in templates:
        try:
            records.append(template_record(template))
        except ApiError:
            continue
    return ResumeTemplateListResponse(templates=records)


@router.get("/{template_id}", response_model=ResumeTemplateResponse)
def get_template(
    template_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
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
