from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class _StringIdMixin(BaseModel):
    @field_validator("id", mode="before", check_fields=False)
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class AdminUserSummary(_StringIdMixin):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    nickname: str
    is_admin: bool
    status: int
    resume_count: int = 0
    last_login_at: datetime | None = None
    created_at: datetime


class AdminUserListResponse(BaseModel):
    items: list[AdminUserSummary]
    total: int
    page: int
    size: int


class AdminUserDetail(AdminUserSummary):
    llm_call_count: int = 0
    updated_at: datetime


class AdminStatusUpdateRequest(BaseModel):
    action: str  # "disable" | "enable"

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        if v not in ("disable", "enable"):
            raise ValueError("action must be 'disable' or 'enable'")
        return v


class AdminStatusUpdateResponse(BaseModel):
    ok: bool
    user: AdminUserSummary
    revoked_sessions: int = 0


class AdminStatsResponse(BaseModel):
    total_users: int
    active_users_7d: int
    total_resumes: int
    llm_calls_today: int = 0
    estimated_cost_month: str = "$0.00"
