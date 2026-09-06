from __future__ import annotations

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
    LargeBinary,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base


def unsigned_bigint_type():
    return (
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite")
    )


def unsigned_int_type():
    return Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql")


def unsigned_smallint_type():
    return SmallInteger().with_variant(mysql.SMALLINT(unsigned=True), "mysql")


def timestamp_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


def ascii_varchar(length: int):
    return String(length).with_variant(
        mysql.VARCHAR(length, charset="ascii", collation="ascii_bin"), "mysql"
    )


def ascii_char(length: int):
    return String(length).with_variant(
        mysql.CHAR(length, charset="ascii", collation="ascii_bin"), "mysql"
    )


class JobDescription(Base):
    __tablename__ = "job_descriptions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_job_descriptions"),
        UniqueConstraint(
            "user_id",
            "source_site",
            "source_job_id",
            name="uk_job_descriptions_user_source_job",
        ),
        UniqueConstraint(
            "user_id",
            "source_url_hash",
            name="uk_job_descriptions_user_source_url",
        ),
        CheckConstraint(
            "LENGTH(TRIM(job_title)) > 0",
            name="ck_job_descriptions_job_title_not_blank",
        ),
        CheckConstraint(
            "LENGTH(TRIM(company_name)) > 0",
            name="ck_job_descriptions_company_name_not_blank",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(skills)) = 'array'",
            name="ck_job_descriptions_skills_array",
        ),
        CheckConstraint(
            "employment_type IS NULL OR employment_type IN "
            "('internship', 'campus', 'full_time')",
            name="ck_job_descriptions_employment_type",
        ),
        CheckConstraint(
            "work_mode IS NULL OR work_mode IN ('onsite', 'hybrid', 'remote')",
            name="ck_job_descriptions_work_mode",
        ),
        CheckConstraint(
            "salary_period IS NULL OR salary_period IN ('hour', 'day', 'month', 'year')",
            name="ck_job_descriptions_salary_period",
        ),
        CheckConstraint(
            "salary_min IS NULL OR salary_min >= 0",
            name="ck_job_descriptions_salary_min",
        ),
        CheckConstraint(
            "salary_max IS NULL OR salary_max >= 0",
            name="ck_job_descriptions_salary_max",
        ),
        CheckConstraint(
            "salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min",
            name="ck_job_descriptions_salary_range",
        ),
        CheckConstraint(
            "(salary_min IS NULL AND salary_max IS NULL) OR "
            "(salary_currency IS NOT NULL AND salary_period IS NOT NULL)",
            name="ck_job_descriptions_salary_context",
        ),
        CheckConstraint(
            "salary_currency IS NULL OR LENGTH(salary_currency) = 3",
            name="ck_job_descriptions_salary_currency",
        ),
        CheckConstraint(
            "salary_months_per_year IS NULL OR salary_months_per_year >= 1",
            name="ck_job_descriptions_salary_months",
        ),
        CheckConstraint(
            "source_type IN ('manual', 'external_import')",
            name="ck_job_descriptions_source_type",
        ),
        CheckConstraint(
            "(((source_url IS NULL) AND (source_url_hash IS NULL) "
            "AND (source_site IS NULL) AND (source_job_id IS NULL)) OR "
            "((source_url IS NOT NULL) AND (source_url_hash IS NOT NULL) "
            "AND (source_site IS NOT NULL))) AND "
            "((source_job_id IS NULL) OR (source_site IS NOT NULL)) AND "
            "((source_type = 'external_import' AND source_url IS NOT NULL "
            "AND source_site IS NOT NULL AND source_url_hash IS NOT NULL "
            "AND imported_at IS NOT NULL) OR "
            "(source_type = 'manual' AND imported_at IS NULL))",
            name="ck_job_descriptions_source_fields",
        ),
        CheckConstraint("lock_version >= 1", name="ck_job_descriptions_lock_version"),
        {
            "comment": "用户保存的结构化岗位描述",
            "sqlite_autoincrement": True,
        },
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="JD 自增主键"
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey("users.id", name="fk_job_descriptions_user", ondelete="RESTRICT"),
        nullable=False,
        comment="JD 所有者",
    )
    job_title: Mapped[str] = mapped_column(String(200), nullable=False, comment="岗位名称")
    company_name: Mapped[str] = mapped_column(
        String(200), nullable=False, comment="公司展示名称"
    )
    employment_type: Mapped[str | None] = mapped_column(
        String(24), nullable=True, comment="岗位类型"
    )
    description: Mapped[str] = mapped_column(
        Text().with_variant(mysql.LONGTEXT(), "mysql"),
        nullable=False,
        comment="最终结构化 Markdown JD 正文",
    )
    skills: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, default=list, comment="去空去重后的技能字符串数组"
    )
    education_requirement: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="学历要求"
    )
    experience_requirement: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="经验或在校要求"
    )
    work_schedule: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="工作或实习安排"
    )
    work_city: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="工作城市或地区"
    )
    work_address: Mapped[str | None] = mapped_column(
        String(500), nullable=True, comment="详细工作地址"
    )
    work_mode: Mapped[str | None] = mapped_column(
        String(16), nullable=True, comment="工作方式"
    )
    salary_text: Mapped[str | None] = mapped_column(
        String(128), nullable=True, comment="薪资展示原文"
    )
    salary_min: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True, comment="薪资区间下限"
    )
    salary_max: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True, comment="薪资区间上限"
    )
    salary_currency: Mapped[str | None] = mapped_column(
        ascii_char(3), nullable=True, comment="ISO 4217 币种"
    )
    salary_period: Mapped[str | None] = mapped_column(
        String(16), nullable=True, comment="计薪周期"
    )
    salary_months_per_year: Mapped[int | None] = mapped_column(
        unsigned_smallint_type(), nullable=True, comment="年薪折算月数"
    )
    company_legal_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="公司工商全称快照"
    )
    company_industry: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="行业快照"
    )
    company_size: Mapped[str | None] = mapped_column(
        String(50), nullable=True, comment="公司规模快照"
    )
    company_financing_stage: Mapped[str | None] = mapped_column(
        String(50), nullable=True, comment="融资阶段快照"
    )
    company_description: Mapped[str | None] = mapped_column(
        Text().with_variant(mysql.LONGTEXT(), "mysql"),
        nullable=True,
        comment="公司简介快照",
    )
    recruiter_name: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="招聘者展示姓名"
    )
    recruiter_title: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="招聘者职位"
    )
    source_type: Mapped[str] = mapped_column(
        String(24), nullable=False, comment="来源类型：manual 或 external_import"
    )
    source_site: Mapped[str | None] = mapped_column(
        ascii_varchar(32), nullable=True, comment="来源适配器标识"
    )
    source_job_id: Mapped[str | None] = mapped_column(
        ascii_varchar(128), nullable=True, comment="来源站点原生岗位标识"
    )
    source_url: Mapped[str | None] = mapped_column(
        String(2048), nullable=True, comment="后端规范化来源链接"
    )
    source_url_hash: Mapped[bytes | None] = mapped_column(
        LargeBinary(32).with_variant(mysql.BINARY(32), "mysql"),
        nullable=True,
        comment="规范化来源链接 SHA-256",
    )
    imported_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True, comment="外部结构化数据写入时间（UTC）"
    )
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True, comment="用户个人备注")
    lock_version: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, default=1, comment="乐观锁版本"
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), comment="创建时间（UTC）"
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间（UTC）",
    )


Index(
    "idx_job_descriptions_user_updated_id",
    JobDescription.user_id,
    JobDescription.updated_at.desc(),
    JobDescription.id.desc(),
)
