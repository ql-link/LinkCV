from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from drawoffer.core.database import get_db
from drawoffer.modules.announcements import service
from drawoffer.modules.announcements.models import Announcement
from drawoffer.modules.announcements.schemas import (
    AdminAnnouncement,
    AdminAnnouncementListResponse,
    AdminAnnouncementResponse,
    AdminAnnouncementStatsResponse,
    AnnouncementCreateRequest,
    AnnouncementUpdateRequest,
)
from drawoffer.modules.identity.dependencies import get_current_admin
from drawoffer.modules.identity.models import User
from drawoffer.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/admin/announcements", tags=["admin-announcements"])


def _optional_id(value: int | None) -> str | None:
    return str(value) if value is not None else None


def to_admin(row: Announcement, now: datetime) -> AdminAnnouncement:
    return AdminAnnouncement(
        id=str(row.id),
        level=row.level,
        title=row.title,
        body=row.body,
        status=row.status,
        visibility=service.visibility(row, now),
        starts_at=service._aware(row.starts_at),
        ends_at=service._aware(row.ends_at),
        published_at=service._aware(row.published_at),
        unpublished_at=service._aware(row.unpublished_at),
        created_by=str(row.created_by),
        published_by=_optional_id(row.published_by),
        unpublished_by=_optional_id(row.unpublished_by),
        created_at=service._aware(row.create_time),
        updated_at=service._aware(row.update_time),
    )


def _single(row: Announcement) -> AdminAnnouncementResponse:
    return AdminAnnouncementResponse(announcement=to_admin(row, service.utcnow()))


@router.get("", response_model=AdminAnnouncementListResponse)
def list_announcements(
    status: Literal["draft", "published", "unpublished"] | None = None,
    cursor: str | None = Query(default=None, max_length=256),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> AdminAnnouncementListResponse:
    rows, next_cursor = service.list_admin(db, status, cursor, limit)
    now = service.utcnow()
    return AdminAnnouncementListResponse(
        items=[to_admin(row, now) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/stats", response_model=AdminAnnouncementStatsResponse)
def announcement_stats(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> AdminAnnouncementStatsResponse:
    result = service.stats(db)
    return AdminAnnouncementStatsResponse(
        draft=result.draft,
        published=result.published,
        unpublished=result.unpublished,
        active=result.active,
        scheduled=result.scheduled,
    )


@router.post("", response_model=AdminAnnouncementResponse, status_code=201)
def create_announcement(
    payload: AnnouncementCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> AdminAnnouncementResponse:
    row = service.create(db, admin, payload.model_dump())
    bind_audit_target(request, row.id)
    return _single(row)


@router.get("/{announcement_id}", response_model=AdminAnnouncementResponse)
def get_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> AdminAnnouncementResponse:
    return _single(service._get(db, announcement_id))


@router.patch("/{announcement_id}", response_model=AdminAnnouncementResponse)
def update_announcement(
    announcement_id: int,
    payload: AnnouncementUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> AdminAnnouncementResponse:
    fields = payload.model_dump(exclude_unset=True)
    for required in ("level", "title", "body"):
        if required in fields and fields[required] is None:
            fields.pop(required)
    row = service.update_draft(db, admin, announcement_id, fields)
    return _single(row)


@router.delete("/{announcement_id}", status_code=204)
def delete_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> Response:
    service.delete_draft(db, announcement_id)
    return Response(status_code=204)


@router.post("/{announcement_id}/publish", response_model=AdminAnnouncementResponse)
def publish_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> AdminAnnouncementResponse:
    return _single(service.publish(db, admin, announcement_id))


@router.post("/{announcement_id}/unpublish", response_model=AdminAnnouncementResponse)
def unpublish_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> AdminAnnouncementResponse:
    return _single(service.unpublish(db, admin, announcement_id))
