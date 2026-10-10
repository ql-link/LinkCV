from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    JSON,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkresume.core.database import Base
from linkresume.core.storage import asset_url
from linkresume.modules.identity.default_avatar import DEFAULT_AVATAR_KEY, DEFAULT_AVATAR_URL


def unsigned_bigint_type():
    return (
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite")
    )


def unsigned_int_type():
    return Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql")


def timestamp_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


def ascii_char(length: int):
    return String(length).with_variant(
        mysql.CHAR(length, charset="ascii", collation="ascii_bin"), "mysql"
    )


class User(Base):
    __tablename__ = "user"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_user"),
        UniqueConstraint("email", name="uk_user_email"),
        UniqueConstraint("wechat_openid", name="uk_user_wechat_openid"),
        CheckConstraint("status IN (0, 1)", name="ck_user_status"),
        CheckConstraint("is_admin IN (0, 1)", name="ck_user_is_admin"),
        {"comment": "用户账号"},
    )

    id: Mapped[int] = mapped_column(
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite"),
        autoincrement=True,
        comment="用户自增主键",
    )
    email: Mapped[str | None] = mapped_column(
        String(254), nullable=True, comment="规范化后的登录邮箱（微信登录用户可为空）"
    )
    contact_email: Mapped[str | None] = mapped_column(
        String(254), nullable=True, comment="联系邮箱，不验证归属，不参与登录"
    )
    deletion_requested_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True, comment="注销受理时间 UTC，非空时拒绝业务访问"
    )
    password_hash: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="密码摘要，不保存明文（微信登录用户可为空）"
    )
    nickname: Mapped[str] = mapped_column(
        String(50), nullable=False, comment="用户展示昵称"
    )
    avatar_object_key: Mapped[str | None] = mapped_column(
        String(512), nullable=True, comment="私有头像对象键"
    )
    status: Mapped[int] = mapped_column(
        SmallInteger().with_variant(mysql.TINYINT(unsigned=True), "mysql"),
        nullable=False,
        default=1,
        comment="账号状态：0 禁用，1 启用",
    )
    is_admin: Mapped[int] = mapped_column(
        SmallInteger().with_variant(mysql.TINYINT(unsigned=True), "mysql"),
        nullable=False,
        default=0,
        comment="管理员标记：0 否，1 是",
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=True,
        comment="最近一次成功登录时间（UTC）",
    )
    wechat_openid: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="微信小程序 openid，绑定后写入，全局唯一",
    )
    wechat_bound_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=True,
        comment="微信绑定时间（UTC）",
    )
    create_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )
    update_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间（UTC）",
    )

    @property
    def avatar_url(self) -> str | None:
        if self.avatar_object_key == DEFAULT_AVATAR_KEY:
            return DEFAULT_AVATAR_URL
        if not self.avatar_object_key:
            return None
        return asset_url(self.avatar_object_key)


class AccountPreference(Base):
    __tablename__ = "account_preference"
    __table_args__ = (
        UniqueConstraint("user_id", name="uk_account_preference_user_id"),
        CheckConstraint("locale IN ('zh-CN', 'en-US')", name="ck_account_preference_locale"),
        CheckConstraint(
            "is_interview_reminder_enabled IN (0, 1)",
            name="ck_account_preference_is_interview_reminder_enabled",
        ),
        {"comment": "账号界面语言与提醒偏好"},
    )
    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), primary_key=True, autoincrement=True, comment="主键",
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, comment="所属用户",
    )
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="zh-CN", server_default="zh-CN", comment="界面语言")
    is_interview_reminder_enabled: Mapped[int] = mapped_column(
        SmallInteger().with_variant(mysql.TINYINT(unsigned=True), "mysql"),
        nullable=False, default=0, server_default="0", comment="是否开启面试提醒：1 是，0 否；当前不发送通知",
    )
    create_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), comment="创建时间 UTC")
    update_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间 UTC")


class AccountDeletionJob(Base):
    __tablename__ = "account_deletion_job"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_account_deletion_job"),
        UniqueConstraint("public_id", name="uk_account_deletion_job_public"),
        UniqueConstraint("user_id", name="uk_account_deletion_job_user"),
        CheckConstraint("status IN ('pending', 'processing', 'retry_wait', 'needs_attention', 'completed')", name="ck_account_deletion_job_status"),
        CheckConstraint("phase IN ('database', 'objects', 'rag', 'complete')", name="ck_account_deletion_job_phase"),
        Index("idx_account_deletion_job_due", "status", "next_attempt_at", "id"),
        Index("idx_account_deletion_job_completed", "status", "completed_at", "id"),
        {"comment": "持久账号清理任务，不依赖已删除用户外键"},
    )
    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True, comment="清理任务主键")
    public_id: Mapped[str] = mapped_column(ascii_char(36), nullable=False, comment="公开 UUID")
    user_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="原用户 ID，无外键")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending", comment="清理状态")
    phase: Mapped[str] = mapped_column(String(16), nullable=False, default="database", server_default="database", comment="清理阶段")
    cleanup_manifest: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="受控清理目标，无个人正文")
    receipt_hash: Mapped[str] = mapped_column(ascii_char(64), nullable=False, comment="随机回执哈希")
    attempt_count: Mapped[int] = mapped_column(unsigned_int_type(), nullable=False, default=0, server_default="0", comment="失败次数")
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="有限错误码")
    next_attempt_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True, comment="下次执行 UTC")
    lease_until: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True, comment="执行租约 UTC")
    create_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), comment="受理时间 UTC")
    update_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间 UTC")
    completed_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True, comment="清理完成 UTC")


class UserProfile(Base):
    __tablename__ = "user_profile"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_user_profile"),
        UniqueConstraint("user_id", name="uk_user_profile_user_id"),
        CheckConstraint("lock_version >= 1", name="ck_user_profile_lock_version"),
        CheckConstraint("application_data IS NULL OR LOWER(JSON_TYPE(application_data)) = 'object'", name="ck_user_profile_application_data_object"),
        CheckConstraint(
            "salary_period IS NULL OR salary_period IN ('hour', 'day', 'month', 'year')",
            name="ck_user_profile_salary_period",
        ),
        CheckConstraint(
            "salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min",
            name="ck_user_profile_salary_range",
        ),
        CheckConstraint(
            "(salary_min IS NULL AND salary_max IS NULL) OR "
            "(salary_currency IS NOT NULL AND salary_period IS NOT NULL)",
            name="ck_user_profile_salary_context",
        ),
        CheckConstraint(
            "salary_currency IS NULL OR LENGTH(salary_currency) = 3",
            name="ck_user_profile_salary_currency",
        ),
        CheckConstraint(
            "education_level IS NULL OR education_level IN "
            "('high_school', 'junior_college', 'bachelor', 'master', 'doctor')",
            name="ck_user_profile_education_level",
        ),
        CheckConstraint(
            "years_experience IS NULL OR years_experience >= 0",
            name="ck_user_profile_years_experience",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(candidate_cities)) = 'array'",
            name="ck_user_profile_candidate_cities_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(employment_types)) = 'array'",
            name="ck_user_profile_employment_types_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(languages)) = 'array'",
            name="ck_user_profile_languages_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(skills)) = 'array'",
            name="ck_user_profile_skills_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(certifications)) = 'array'",
            name="ck_user_profile_certifications_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(honors)) = 'array'",
            name="ck_user_profile_honors_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(campus_experiences)) = 'array'",
            name="ck_user_profile_campus_experiences_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(school_tier)) = 'array'",
            name="ck_user_profile_school_tier_array",
        ),
        CheckConstraint(
            "candidate_status IS NULL OR candidate_status IN "
            "('fresh_graduate', 'experienced')",
            name="ck_user_profile_candidate_status",
        ),
        CheckConstraint(
            "graduation_year IS NULL OR graduation_year BETWEEN 1900 AND 9999",
            name="ck_user_profile_graduation_year",
        ),
        CheckConstraint(
            "(candidate_status IS NULL AND graduation_year IS NULL) OR "
            "(candidate_status IS NOT NULL AND candidate_status = 'fresh_graduate' "
            "AND graduation_year IS NOT NULL AND years_experience IS NOT NULL "
            "AND years_experience = 0) OR "
            "(candidate_status IS NOT NULL AND candidate_status = 'experienced' "
            "AND graduation_year IS NULL)",
            name="ck_user_profile_candidate_experience_context",
        ),
        {"comment": "用户个人画像"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="画像自增主键"
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        nullable=False,
        comment="画像所有者用户 id",
    )
    lock_version: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, default=1, comment="乐观锁版本"
    )
    candidate_cities: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="可接受工作城市字符串数组"
    )
    salary_min: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True, comment="期望薪资下限"
    )
    salary_max: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True, comment="期望薪资上限"
    )
    salary_currency: Mapped[str | None] = mapped_column(
        ascii_char(3), nullable=True, comment="期望薪资币种 ISO 4217"
    )
    salary_period: Mapped[str | None] = mapped_column(
        String(16), nullable=True, comment="计薪周期"
    )
    employment_types: Mapped[list[str]] = mapped_column(
        JSON(),
        nullable=False,
        default=list,
        comment="可接受工作性质数组：internship/full_time",
    )
    school: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="学校名称"
    )
    school_tier: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="学校层级字符串数组"
    )
    major: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="专业方向"
    )
    education_level: Mapped[str | None] = mapped_column(
        String(24), nullable=True, comment="学历层次"
    )
    years_experience: Mapped[int | None] = mapped_column(
        unsigned_int_type(), nullable=True, comment="工作年限（应届生填 0）"
    )
    candidate_status: Mapped[str | None] = mapped_column(
        String(24), nullable=True, comment="候选人类型：fresh_graduate/experienced"
    )
    graduation_year: Mapped[int | None] = mapped_column(
        SmallInteger().with_variant(mysql.SMALLINT(unsigned=True), "mysql"),
        nullable=True,
        comment="应届生毕业年份，candidate_status=fresh_graduate 时必填",
    )
    languages: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="语言能力字符串数组"
    )
    skills: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="技能字符串数组"
    )
    certifications: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="证书字符串数组"
    )
    honors: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="个人荣誉字符串数组"
    )
    campus_experiences: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="校园经历字符串数组"
    )
    application_data: Mapped[dict | None] = mapped_column(
        JSON(none_as_null=True), nullable=True,
        comment="用户确认的网申事实与简历对应关系，版本化对象，应用限制64KiB",
    )
    create_time: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(),
        comment="创建时间（UTC）",
    )
    update_time: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间（UTC）",
    )


Index(
    "idx_user_profile_user_updated",
    UserProfile.user_id,
    UserProfile.update_time.desc(),
    UserProfile.id.desc(),
)
