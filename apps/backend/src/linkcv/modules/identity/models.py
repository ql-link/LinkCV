from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
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

from linkcv.core.database import Base
from linkcv.core.storage import asset_url


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
    __tablename__ = "users"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_users"),
        UniqueConstraint("email", name="uk_users_email"),
        UniqueConstraint("wechat_openid", name="uk_users_wechat_openid"),
        CheckConstraint("status IN (0, 1)", name="ck_users_status"),
        CheckConstraint("is_admin IN (0, 1)", name="ck_users_is_admin"),
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间（UTC）",
    )

    @property
    def avatar_url(self) -> str | None:
        if not self.avatar_object_key:
            return None
        return asset_url(self.avatar_object_key)


class UserProfile(Base):
    __tablename__ = "user_profiles"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_user_profiles"),
        UniqueConstraint("user_id", name="uk_user_profiles_user_id"),
        CheckConstraint("lock_version >= 1", name="ck_user_profiles_lock_version"),
        CheckConstraint(
            "employment_type IS NULL OR employment_type IN "
            "('full_time', 'part_time', 'internship', 'contract', 'temporary')",
            name="ck_user_profiles_employment_type",
        ),
        CheckConstraint(
            "work_mode IS NULL OR work_mode IN ('onsite', 'hybrid', 'remote')",
            name="ck_user_profiles_work_mode",
        ),
        CheckConstraint(
            "salary_period IS NULL OR salary_period IN ('hour', 'day', 'month', 'year')",
            name="ck_user_profiles_salary_period",
        ),
        CheckConstraint(
            "salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min",
            name="ck_user_profiles_salary_range",
        ),
        CheckConstraint(
            "(salary_min IS NULL AND salary_max IS NULL) OR "
            "(salary_currency IS NOT NULL AND salary_period IS NOT NULL)",
            name="ck_user_profiles_salary_context",
        ),
        CheckConstraint(
            "salary_currency IS NULL OR LENGTH(salary_currency) = 3",
            name="ck_user_profiles_salary_currency",
        ),
        CheckConstraint(
            "availability IS NULL OR availability IN "
            "('immediately', 'one_week', 'two_weeks', 'one_month', 'custom')",
            name="ck_user_profiles_availability",
        ),
        CheckConstraint(
            "available_from IS NULL OR availability = 'custom'",
            name="ck_user_profiles_available_from_context",
        ),
        CheckConstraint(
            "education_level IS NULL OR education_level IN "
            "('high_school', 'junior_college', 'bachelor', 'master', 'doctor')",
            name="ck_user_profiles_education_level",
        ),
        CheckConstraint(
            "years_experience IS NULL OR years_experience >= 0",
            name="ck_user_profiles_years_experience",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(target_positions)) = 'array'",
            name="ck_user_profiles_target_positions_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(exclusions)) = 'array'",
            name="ck_user_profiles_exclusions_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(target_companies)) = 'array'",
            name="ck_user_profiles_target_companies_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(languages)) = 'array'",
            name="ck_user_profiles_languages_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(skills)) = 'array'",
            name="ck_user_profiles_skills_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(certifications)) = 'array'",
            name="ck_user_profiles_certifications_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(honors)) = 'array'",
            name="ck_user_profiles_honors_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(campus_experiences)) = 'array'",
            name="ck_user_profiles_campus_experiences_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(school_tier)) = 'array'",
            name="ck_user_profiles_school_tier_array",
        ),
        {"comment": "用户个人画像"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="画像自增主键"
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey("users.id", name="fk_user_profiles_user", ondelete="RESTRICT"),
        nullable=False,
        comment="画像所有者用户 id",
    )
    lock_version: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, default=1, comment="乐观锁版本"
    )
    work_city: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="期望工作地点"
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
    employment_type: Mapped[str | None] = mapped_column(
        String(24), nullable=True, comment="期望工作性质"
    )
    work_mode: Mapped[str | None] = mapped_column(
        String(16), nullable=True, comment="期望工作方式"
    )
    target_positions: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="职位方向字符串数组"
    )
    exclusions: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="排除条件字符串数组"
    )
    target_companies: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="目标公司字符串数组"
    )
    availability: Mapped[str | None] = mapped_column(
        String(16), nullable=True, comment="可到岗时间"
    )
    available_from: Mapped[date | None] = mapped_column(
        Date(), nullable=True, comment="自定义到岗日期，availability=custom 时填写"
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
    birth_date: Mapped[date | None] = mapped_column(
        Date(), nullable=True, comment="出生日期（UTC 日期）"
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
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(),
        comment="创建时间（UTC）",
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间（UTC）",
    )


Index(
    "idx_user_profiles_user_updated",
    UserProfile.user_id,
    UserProfile.updated_at.desc(),
    UserProfile.id.desc(),
)
