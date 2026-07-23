import re

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.security import (
    clear_session_cookie,
    create_id,
    create_session_token,
    hash_password,
    set_session_cookie,
    verify_password,
)
from linkcv.modules.identity.dependencies import get_optional_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import (
    AuthResponse,
    Credentials,
    MeResponse,
    OkResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["identity"])
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_email(value: str) -> str:
    return value.strip().lower()


@router.get("/me", response_model=MeResponse)
def me(user: User | None = Depends(get_optional_user)) -> MeResponse:
    return MeResponse(user=UserResponse.model_validate(user) if user else None)


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: Credentials,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthResponse:
    email = normalize_email(payload.email)
    if not EMAIL_PATTERN.fullmatch(email):
        raise ApiError(400, "INVALID_EMAIL")
    if len(payload.password) < 8:
        raise ApiError(400, "WEAK_PASSWORD")
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise ApiError(409, "EMAIL_EXISTS")

    user = User(
        id=create_id("user"),
        email=email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "EMAIL_EXISTS") from error

    token = create_session_token(user.id, user.auth_version, settings)
    set_session_cookie(response, token, settings)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(
    payload: Credentials,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthResponse:
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if (
        user is None
        or user.status != "active"
        or not verify_password(
            payload.password,
            user.password_hash,
        )
    ):
        raise ApiError(401, "INVALID_CREDENTIALS")

    token = create_session_token(user.id, user.auth_version, settings)
    set_session_cookie(response, token, settings)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/logout", response_model=OkResponse)
def logout(
    response: Response,
    settings: Settings = Depends(get_settings),
) -> OkResponse:
    clear_session_cookie(response, settings)
    return OkResponse(ok=True)
