from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.security import decode_session_token
from linkcv.modules.identity.models import User


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User | None:
    user_id = decode_session_token(
        request.cookies.get(settings.session_cookie_name),
        settings,
    )
    if user_id is None:
        return None

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or user.status != 1:
        return None
    return user


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user
