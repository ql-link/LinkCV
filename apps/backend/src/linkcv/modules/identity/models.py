from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
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
            "education_level IS NULL OR education_level IN "
            "('high_school', 'junior_college', 'bachelor', 'master', 'doctor')",
            name="ck_user_profiles_education_level",
        ),
        CheckConstraint(
            "years_experience IS NULL OR years_experience >= 0",
            name="ck_user_profiles_years_experience",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(candidate_cities)) = 'array'",
            name="ck_user_profiles_candidate_cities_array",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(employment_types)) = 'array'",
            name="ck_user_profiles_employment_types_array",
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
        CheckConstraint(
            "candidate_status IS NULL OR candidate_status IN "
            "('fresh_graduate', 'experienced')",
            name="ck_user_profiles_candidate_status",
        ),
        CheckConstraint(
            "graduation_year IS NULL OR graduation_year BETWEEN 1900 AND 9999",
            name="ck_user_profiles_graduation_year",
        ),
        CheckConstraint(
            "(candidate_status IS NULL AND graduation_year IS NULL) OR "
            "(candidate_status IS NOT NULL AND candidate_status = 'fresh_graduate' "
            "AND graduation_year IS NOT NULL AND years_experience IS NOT NULL "
            "AND years_experience = 0) OR "
            "(candidate_status IS NOT NULL AND candidate_status = 'experienced' "
            "AND graduation_year IS NULL)",
            name="ck_user_profiles_candidate_experience_context",
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
