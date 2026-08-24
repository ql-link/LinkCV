from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from linkcv.core.database import get_db
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.notices import service
from linkcv.modules.notices.schemas import (
    NoticeListResponse,
    NoticeMarkReadResponse,
)

router = APIRouter(prefix="/notices", tags=["notices"])


@router.get("", response_model=NoticeListResponse)
def list_notices(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NoticeListResponse:
    items, unread_count = service.list_published(db, user)
    return NoticeListResponse(items=items, unread_count=unread_count)


@router.post("/mark-read", response_model=NoticeMarkReadResponse)
def mark_notices_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NoticeMarkReadResponse:
    unread_count = service.mark_read(db, user)
    return NoticeMarkReadResponse(ok=True, unread_count=unread_count)
