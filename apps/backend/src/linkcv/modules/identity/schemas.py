from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Credentials(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    # 对外 user.id 统一为字符串,避免 JavaScript/JSON 大整数精度丢失。
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    email: str
    nickname: str
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    is_admin: bool = Field(default=False, alias="isAdmin")


class AuthResponse(BaseModel):
    user: UserResponse


class MeResponse(BaseModel):
    user: UserResponse | None


class OkResponse(BaseModel):
    ok: bool


class UpdateUserRequest(BaseModel):
    nickname: str


class AvatarUploadRequest(BaseModel):
    fileName: str = "avatar"
    dataUrl: str


class AvatarResponse(BaseModel):
    avatar_url: str = Field(alias="avatarUrl")
