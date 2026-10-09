import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

from linkresume.modules.job_descriptions.schemas import (
    SalaryPeriod,
)


EmploymentType = Literal["internship", "full_time"]
CandidateStatus = Literal["fresh_graduate", "experienced"]
EducationLevel = Literal[
    "high_school", "junior_college", "bachelor", "master", "doctor"
]
SchoolTier = Literal["project_985", "project_211", "double_first_class"]
ProfileStringItem = Annotated[str, Field(max_length=100)]


_SCHOOL_TIER_VALUES = {
    "project_985",
    "project_211",
    "double_first_class",
}
_OPTIONAL_TEXT_FIELDS = (
    "school",
    "major",
)


def _normalize_string_array(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        if len(normalized) > 100:
            raise ValueError("list item is too long")
        seen.add(normalized)
        result.append(normalized)
    return result


def _normalize_school_tier(values: list[str]) -> list[str]:
    normalized = _normalize_string_array(values)
    invalid = [value for value in normalized if value not in _SCHOOL_TIER_VALUES]
    if invalid:
        raise ValueError(
            "school_tier must be one of: project_985, project_211, double_first_class"
        )
    return normalized


def _normalize_employment_types(values: list[EmploymentType]) -> list[EmploymentType]:
    result: list[EmploymentType] = []
    seen: set[EmploymentType] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _validate_profile_salary(
    salary_min: Decimal | None,
    salary_max: Decimal | None,
    currency: str | None,
    period: SalaryPeriod | None,
) -> None:
    if salary_min is not None and salary_max is not None and salary_max < salary_min:
        raise ValueError("salary_max must not be less than salary_min")
    if (salary_min is not None or salary_max is not None) and (
        currency is None or period is None
    ):
        raise ValueError("numeric salary requires currency and period")


def _as_utc(value: object) -> object:
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


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
    wechat_login_enabled: bool


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
    contact_email: str | None = None
    registered_at: datetime | None = None

    @field_validator("registered_at", mode="before")
    @classmethod
    def registered_at_utc(cls, value: object) -> object:
        return _as_utc(value)


class AccountCapabilities(BaseModel):
    auth_mode: Literal["password", "wechat", "unavailable"]
    can_change_password: bool
    can_delete_account: bool
    deletion_confirmation_method: Literal["password", "wechat"] | None


class CurrentSessionResponse(BaseModel):
    device_label: str


class AccountPreferencesResponse(BaseModel):
    locale: Literal["zh-CN", "en-US"] = "zh-CN"
    interview_reminder_enabled: bool = False
    notifications_available: Literal[False] = False


class ContactEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str | None


class ContactEmailResponse(BaseModel):
    contact_email: str | None


class WechatActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["delete_account"]


class WechatActionPoll(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene: str = Field(min_length=1, max_length=32)
    poll_token: str = Field(min_length=1, max_length=128)


class WechatActionConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene: str = Field(min_length=1, max_length=32)
    code: str = Field(min_length=1, max_length=128)


class PasswordDeletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["password"]
    current_password: str = Field(min_length=1, max_length=512)
    confirmation: str = Field(max_length=32)


class WechatDeletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["wechat"]
    action_token: str = Field(min_length=1, max_length=128)
    confirmation: str = Field(max_length=32)


AccountDeletionRequest = Annotated[
    PasswordDeletionRequest | WechatDeletionRequest, Field(discriminator="method")
]


class AccountDeletionStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str = Field(min_length=36, max_length=36)
    receipt_token: str = Field(min_length=1, max_length=128)


class ProfileUpdateRequest(BaseModel):
    nickname: str


class MiniProgramProfileResponse(BaseModel):
    """小程序专用资料视图；头像只暴露小程序专用只读 URL。"""

    nickname: str
    avatar_url: str | None = None


class MiniProgramProfileUpdateRequest(BaseModel):
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


class UserProfileBase(BaseModel):
    """用户画像可编辑字段集合，请求体与响应共用。"""

    model_config = ConfigDict(extra="forbid")

    candidate_cities: list[ProfileStringItem] = Field(
        default_factory=list, max_length=20
    )
    salary_min: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )
    salary_max: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )
    salary_currency: str | None = Field(default=None, max_length=3)
    salary_period: SalaryPeriod | None = None
    employment_types: list[EmploymentType] = Field(
        default_factory=list, max_length=2
    )
    school: str | None = Field(default=None, max_length=255)
    school_tier: list[ProfileStringItem] = Field(default_factory=list, max_length=10)
    major: str | None = Field(default=None, max_length=100)
    education_level: EducationLevel | None = None
    years_experience: int | None = Field(default=None, ge=0, le=4_294_967_295)
    candidate_status: CandidateStatus | None = None
    graduation_year: int | None = Field(default=None, ge=1900, le=9999)
    languages: list[ProfileStringItem] = Field(default_factory=list, max_length=100)
    skills: list[ProfileStringItem] = Field(default_factory=list, max_length=100)
    certifications: list[ProfileStringItem] = Field(
        default_factory=list, max_length=100
    )
    honors: list[ProfileStringItem] = Field(default_factory=list, max_length=100)
    campus_experiences: list[ProfileStringItem] = Field(
        default_factory=list, max_length=100
    )

    @field_validator(*_OPTIONAL_TEXT_FIELDS)
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator(
        "candidate_cities",
        "languages",
        "skills",
        "certifications",
        "honors",
        "campus_experiences",
    )
    @classmethod
    def normalize_string_arrays(cls, values: list[str]) -> list[str]:
        return _normalize_string_array(values)

    @field_validator("employment_types")
    @classmethod
    def normalize_employment_types(
        cls, values: list[EmploymentType]
    ) -> list[EmploymentType]:
        return _normalize_employment_types(values)

    @field_validator("school_tier")
    @classmethod
    def normalize_school_tier(cls, values: list[str]) -> list[str]:
        return _normalize_school_tier(values)

    @field_validator("salary_currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", normalized):
            raise ValueError("salary currency must be a three-letter ASCII code")
        return normalized

    @model_validator(mode="after")
    def validate_user_profile(self) -> "UserProfileBase":
        _validate_profile_salary(
            self.salary_min,
            self.salary_max,
            self.salary_currency,
            self.salary_period,
        )
        if self.candidate_status is None:
            if self.graduation_year is not None:
                raise ValueError(
                    "graduation_year requires candidate_status to be selected"
                )
        elif self.candidate_status == "fresh_graduate":
            if self.graduation_year is None:
                raise ValueError(
                    "fresh_graduate requires graduation_year"
                )
            if self.years_experience != 0:
                raise ValueError(
                    "fresh_graduate requires years_experience = 0"
                )
        elif self.graduation_year is not None:
            raise ValueError(
                "experienced candidates cannot provide graduation_year"
            )
        return self


class UserProfileData(UserProfileBase):
    """画像响应，附带乐观锁版本与时间戳。"""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    lock_version: int
    created_at: datetime | None = Field(default=None, validation_alias=AliasChoices("create_time", "created_at"))
    updated_at: datetime | None = Field(default=None, validation_alias=AliasChoices("update_time", "updated_at"))

    @model_validator(mode="before")
    @classmethod
    def remove_redundant_legacy_education_tag(cls, value: object) -> object:
        """旧记录可能把已保存的学历标签重复放入院校层次；只修正读取视图。"""
        education_labels = {
            "high_school": "高中及以下",
            "junior_college": "大专",
            "bachelor": "本科",
            "master": "硕士",
            "doctor": "博士",
        }
        education = value.get("education_level") if isinstance(value, dict) else getattr(value, "education_level", None)
        tiers = value.get("school_tier") if isinstance(value, dict) else getattr(value, "school_tier", None)
        label = education_labels.get(education)
        if not label or not isinstance(tiers, list) or label not in tiers:
            return value
        # ORM 时间列已改名，响应字段名仍保留原有 API 契约。
        attribute_names = {"created_at": "create_time", "updated_at": "update_time"}
        fields = dict(value) if isinstance(value, dict) else {
            name: getattr(value, attribute_names.get(name, name))
            for name in cls.model_fields
        }
        fields["school_tier"] = [tier for tier in tiers if tier != label]
        return fields

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def normalize_timestamps(cls, value: object) -> object:
        return _as_utc(value)


class UserProfileUpdateRequest(UserProfileBase):
    """画像整体替换写入请求，携带基版本号用于乐观锁。"""

    base_lock_version: int = Field(ge=1)


class AccountProfileResponse(BaseModel):
    user: UserProfileResponse
    resume_count: int
    recent_resumes: list[RecentResumeSummary]
    current_session: CurrentSessionResponse
    capabilities: AccountCapabilities


class AvatarUploadRequest(BaseModel):
    fileName: str = "avatar"
    dataUrl: str


class AvatarResponse(BaseModel):
    url: str


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str
    new_password: str
    confirm_password: str


class PasswordChangedResponse(BaseModel):
    ok: bool
    message: str
