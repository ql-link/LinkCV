from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class Credentials(BaseModel):
    email: str
    password: str


class ChangePassword(BaseModel):
    current_password: str
    new_password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str | None
    nickname: str
    is_admin: bool
    avatar_url: str | None = None

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class AuthResponse(BaseModel):
    user: UserResponse


class AuthCapabilitiesResponse(BaseModel):
    password_login_enabled: bool


class MeResponse(BaseModel):
    user: UserResponse | None


class OkResponse(BaseModel):
    ok: bool


class UserProfileResponse(BaseModel):
    """当前用户资料，头像只暴露经 /api/assets 转发的相对 URL。"""

    id: str
    email: str | None
    nickname: str
    is_admin: bool
    avatar_url: str | None = None
    wechat_status: str = "unbound"
    wechat_bound_at: datetime | None = None


class ProfileUpdateRequest(BaseModel):
    nickname: str


class WechatBindRequestResponse(BaseModel):
    ticket: str
    qrcode_data: str


class WechatBindConfirmRequest(BaseModel):
    ticket: str
    code: str


class WechatBindStatusResponse(BaseModel):
    status: str


class RecentResumeSummary(BaseModel):
    id: str
    title: str
    updated_at: datetime


class AccountProfileResponse(BaseModel):
    user: UserProfileResponse
    resume_count: int
    recent_resumes: list[RecentResumeSummary]


class AvatarUploadRequest(BaseModel):
    fileName: str = "avatar"
    dataUrl: str


class AvatarResponse(BaseModel):
    url: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class PasswordChangedResponse(BaseModel):
    ok: bool
    message: str
