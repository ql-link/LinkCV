from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from linkresume.core.database import get_db
from linkresume.modules.announcements import service
from linkresume.modules.announcements.schemas import (
    UnreadCountResponse,
    UserAnnouncement,
    UserAnnouncementListResponse,
)
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User

router = APIRouter(prefix="/announcements", tags=["announcements"])


@router.get("", response_model=UserAnnouncementListResponse)
def list_announcements(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserAnnouncementListResponse:
    now = service.utcnow()
    rows = service.list_active(db, user, now)
    return UserAnnouncementListResponse(
        items=[
            UserAnnouncement(
                id=str(row.id),
                level=row.level,
                title=row.title,
                body=row.body,
                starts_at=service._aware(row.starts_at),
                ends_at=service._aware(row.ends_at),
                published_at=service._aware(row.published_at),
                read=read,
            )
            for row, read in rows
        ],
        unread_count=sum(1 for _, read in rows if not read),
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UnreadCountResponse:
    return UnreadCountResponse(unread_count=service.unread_count(db, user))


@router.post("/read-all", response_model=UnreadCountResponse)
def read_all(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UnreadCountResponse:
    return UnreadCountResponse(unread_count=service.mark_all_read(db, user))

