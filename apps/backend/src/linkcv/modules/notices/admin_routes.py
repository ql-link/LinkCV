from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from linkcv.core.database import get_db
from linkcv.modules.identity.dependencies import get_current_admin
from linkcv.modules.identity.models import User
from linkcv.modules.notices import service
from linkcv.modules.notices.schemas import (
    AdminNoticeItem,
    AdminNoticeListResponse,
    AdminNoticeMutationResponse,
    NoticeCreateRequest,
)
from linkcv.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/admin/notices", tags=["admin-notices"])


def _mutation_response(notice) -> AdminNoticeMutationResponse:
    return AdminNoticeMutationResponse(
        notice=AdminNoticeItem(
            id=str(notice.id),
            title=notice.title,
            content=notice.content,
            published_at=notice.published_at,
            revoked_at=notice.revoked_at,
        )
    )


@router.get("", response_model=AdminNoticeListResponse)
def list_all_notices(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminNoticeListResponse:
    return AdminNoticeListResponse(items=service.admin_list(db))


@router.post("", response_model=AdminNoticeMutationResponse)
def create_notice(
    payload: NoticeCreateRequest,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminNoticeMutationResponse:
    notice = service.admin_create(db, payload.title, payload.content)
    bind_audit_target(request, notice.id)
    return _mutation_response(notice)


@router.post("/{notice_id}/revoke", response_model=AdminNoticeMutationResponse)
def revoke_notice(
    notice_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminNoticeMutationResponse:
    return _mutation_response(service.admin_revoke(db, notice_id))


@router.post("/{notice_id}/restore", response_model=AdminNoticeMutationResponse)
def restore_notice(
    notice_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminNoticeMutationResponse:
    return _mutation_response(service.admin_restore(db, notice_id))
