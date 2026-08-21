"""Admin-only routes for user management and system overview."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session
import redis as redis_lib

from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.core.security import revoke_user_sessions
from linkcv.modules.identity.admin_schemas import (
    AdminStatsResponse,
    AdminStatusUpdateRequest,
    AdminStatusUpdateResponse,
    AdminUserDetail,
    AdminUserListResponse,
    AdminUserSummary,
)
from linkcv.modules.identity.dependencies import get_current_admin
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume

router = APIRouter(prefix="/auth/admin", tags=["admin"])


@router.get("/users")
def list_users(
    page: int = 1,
    size: int = 20,
    q: str = "",
    status: str = "",
    role: str = "",
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUserListResponse:
    """List users with search, filter, and pagination.

    - q: search keyword (matches id, email, nickname)
    - status: "enabled" | "disabled" | ""
    - role: "admin" | "user" | ""
    """
    # Clamp pagination
    if page < 1:
        page = 1
    if size < 1:
        size = 20
    if size > 100:
        size = 100

    # Build base query
    base = select(User)

    # Search filter
    if q.strip():
        like = f"%{q.strip()}%"
        base = base.where(
            User.email.ilike(like)
            | User.nickname.ilike(like)
            | cast(User.id, String).ilike(like)
        )

    # Status filter
    if status == "enabled":
        base = base.where(User.status == 1)
    elif status == "disabled":
        base = base.where(User.status == 0)

    # Role filter
    if role == "admin":
        base = base.where(User.is_admin == 1)
    elif role == "user":
        base = base.where(User.is_admin == 0)

    # Count total
    total = db.scalar(select(func.count()).select_from(base.subquery()))

    # Fetch page
    offset = (page - 1) * size
    rows = db.scalars(
        base.order_by(User.id.desc()).offset(offset).limit(size)
    ).all()

    # Enrich with resume counts
    user_ids = [u.id for u in rows]
    if user_ids:
        count_rows = db.execute(
            select(Resume.user_id, func.count(Resume.id).label("cnt")).where(
                Resume.user_id.in_(user_ids)
            ).group_by(Resume.user_id)
        ).all()
        resume_counts = {r.user_id: r.cnt for r in count_rows}
    else:
        resume_counts = {}

    items = [
        AdminUserSummary(
            id=u.id,
            email=u.email,
            nickname=u.nickname,
            is_admin=bool(u.is_admin),
            status=u.status,
            resume_count=resume_counts.get(u.id, 0),
            last_login_at=u.last_login_at,
            created_at=u.created_at,
        )
        for u in rows
    ]

    return AdminUserListResponse(items=items, total=total, page=page, size=size)


@router.get("/users/{user_id}")
def get_user_detail(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminUserDetail:
    """Get detailed info for a single user."""
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ApiError(404, "USER_NOT_FOUND")

    resume_count = db.scalar(
        select(func.count(Resume.id)).where(Resume.user_id == user_id)
    ) or 0

    return AdminUserDetail(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        is_admin=bool(user.is_admin),
        status=user.status,
        resume_count=resume_count,
        llm_call_count=0,  # Placeholder - no LLM call log table yet
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    body: AdminStatusUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
    redis_client: "redis_lib.Redis" = Depends(get_redis),
) -> AdminStatusUpdateResponse:
    """Enable or disable a user account.

    Protections:
    - Cannot disable your own account.
    - Cannot disable the last remaining admin account.
    - On disable, all active Redis sessions for that user are revoked immediately.
    """
    if user_id == admin.id:
        raise ApiError(422, "CANNOT_SELF_DISABLE")

    target = db.scalar(select(User).where(User.id == user_id))
    if target is None:
        raise ApiError(404, "USER_NOT_FOUND")

    new_status = 1 if body.action == "enable" else 0

    # Protect the last admin from being disabled
    if new_status == 0 and target.is_admin:
        admin_count = db.scalar(
            select(func.count(User.id)).where(User.is_admin == 1, User.status == 1)
        ) or 0
        if admin_count <= 1:
            raise ApiError(422, "CANNOT_DISABLE_LAST_ADMIN")

    target.status = new_status
    db.flush()

    # Revoke all sessions if disabling
    revoked = 0
    if new_status == 0:
        revoked = revoke_user_sessions(redis_client, target.id)

    db.commit()

    return AdminStatusUpdateResponse(
        ok=True,
        revoked_sessions=revoked,
        user=AdminUserSummary(
            id=target.id,
            email=target.email,
            nickname=target.nickname,
            is_admin=bool(target.is_admin),
            status=target.status,
            resume_count=0,
            last_login_at=target.last_login_at,
            created_at=target.created_at,
        ),
    )


@router.get("/stats")
def admin_stats(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AdminStatsResponse:
    """Aggregated overview statistics for the admin dashboard."""
    total_users = db.scalar(select(func.count(User.id))) or 0

    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active_users_7d = db.scalar(
        select(func.count(User.id)).where(
            User.last_login_at >= seven_days_ago,
            User.status == 1,
        )
    ) or 0

    total_resumes = db.scalar(select(func.count(Resume.id))) or 0

    return AdminStatsResponse(
        total_users=total_users,
        active_users_7d=active_users_7d,
        total_resumes=total_resumes,
        llm_calls_today=0,
        estimated_cost_month="$0.00",
    )
