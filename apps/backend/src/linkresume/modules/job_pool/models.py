from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, Index, Integer, JSON, PrimaryKeyConstraint, String, Text, UniqueConstraint, func
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkresume.core.database import Base
from linkresume.modules.job_descriptions.models import ascii_varchar, timestamp_type, unsigned_bigint_type


def uint():
    from sqlalchemy import Integer
    return Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql")


class GlobalJobSource(Base):
    __tablename__ = "global_job_source"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_global_job_source"),
        UniqueConstraint("adapter_key", "tenant_key", name="uk_global_job_source_adapter_tenant"),
        CheckConstraint("is_enabled IN (0,1)", name="ck_global_job_source_enabled"),
        CheckConstraint("sync_status IN ('idle','queued','running','succeeded','partial','failed','anomalous','cancelled')", name="ck_global_job_source_status"),
        CheckConstraint("lower(json_type(portal_config)) = 'object'", name="ck_global_job_source_config"),
        {"comment": "企业官方招聘采集来源与最近同步状态", "mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )
    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True, comment="来源主键")
    company_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="已有企业引用")
    adapter_key: Mapped[str] = mapped_column(ascii_varchar(24), nullable=False, comment="白名单适配器")
    tenant_key: Mapped[str] = mapped_column(ascii_varchar(128), nullable=False, comment="适配器租户身份")
    portal_config: Mapped[dict] = mapped_column(JSON, nullable=False, comment="版本化门户配置")
    is_enabled: Mapped[int] = mapped_column(Integer().with_variant(mysql.TINYINT(unsigned=True), "mysql"), nullable=False, default=0, server_default="0", comment="是否启用：1是0否")
    sync_generation: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, default=0, server_default="0", comment="配置或任务变更递增的写入版本")
    sync_status: Mapped[str] = mapped_column(ascii_varchar(16), nullable=False, default="idle", server_default="idle", comment="最近同步状态")
    lease_until: Mapped[datetime | None] = mapped_column(timestamp_type(), comment="当前任务租约过期时间")
    next_sync_at: Mapped[datetime | None] = mapped_column(timestamp_type(), comment="下次同步时间")
    last_complete_at: Mapped[datetime | None] = mapped_column(timestamp_type(), comment="最近完整有效同步时间")
    last_sync_result: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), comment="最新同步摘要与有效数量基线")
    create_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")


class GlobalJob(Base):
    __tablename__ = "global_job"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_global_job"),
        UniqueConstraint("source_id", "source_job_key", name="uk_global_job_source_key"),
        Index("idx_global_job_create_time", "create_time", "id"),
        CheckConstraint("availability_status IN ('active','missing','closed')", name="ck_global_job_status"),
        CheckConstraint("recruitment_channel IN ('campus','experienced','unknown')", name="ck_global_job_channel"),
        CheckConstraint("employment_type IN ('internship','full_time','part_time','contract','unknown')", name="ck_global_job_employment"),
        CheckConstraint("length(trim(job_title)) > 0 AND length(trim(description)) > 0", name="ck_global_job_text"),
        CheckConstraint("lower(json_type(locations)) = 'object' AND lower(json_type(locations, '$.cities')) = 'array'", name="ck_global_job_locations").ddl_if(dialect="sqlite"),
        CheckConstraint("JSON_TYPE(locations) = 'OBJECT' AND JSON_TYPE(JSON_EXTRACT(locations, '$.cities')) = 'ARRAY'", name="ck_global_job_locations").ddl_if(dialect="mysql"),
        CheckConstraint("lower(json_type(source_attributes)) = 'object'", name="ck_global_job_attributes"),
        CheckConstraint("missing_count >= 0", name="ck_global_job_missing_count"),
        {"comment": "平台共享官方招聘岗位", "mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )
    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True, comment="公共岗位主键")
    source_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="采集来源引用")
    source_job_key: Mapped[str] = mapped_column(ascii_varchar(192), nullable=False, comment="原生编号或规范链接哈希身份")
    job_title: Mapped[str] = mapped_column(String(200), nullable=False, comment="岗位标题")
    job_category: Mapped[str | None] = mapped_column(String(100), comment="标准岗位类别")
    recruitment_channel: Mapped[str] = mapped_column(ascii_varchar(16), nullable=False, default="unknown", server_default="unknown", comment="campus/experienced/unknown")
    employment_type: Mapped[str] = mapped_column(ascii_varchar(16), nullable=False, default="unknown", server_default="unknown", comment="internship/full_time/part_time/contract/unknown")
    salary_text: Mapped[str | None] = mapped_column(String(128), comment="薪资原文")
    locations: Mapped[dict] = mapped_column(JSON, nullable=False, comment="标准城市数组与来源地点原文")
    description: Mapped[str] = mapped_column(Text().with_variant(mysql.LONGTEXT(), "mysql"), nullable=False, comment="完整安全岗位正文")
    source_attributes: Mapped[dict] = mapped_column(JSON, nullable=False, comment="白名单来源补充属性")
    published_at: Mapped[datetime | None] = mapped_column(timestamp_type(), comment="来源明确的发布时间")
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False, comment="官方详情与投递入口")
    availability_status: Mapped[str] = mapped_column(ascii_varchar(16), nullable=False, default="active", server_default="active", comment="active/missing/closed")
    last_seen_at: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, comment="最近有效观察时间")
    last_seen_generation: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="该来源最近观察代次")
    missing_count: Mapped[int] = mapped_column(uint(), nullable=False, default=0, server_default="0", comment="连续完整同步缺失次数")
    missing_since: Mapped[datetime | None] = mapped_column(timestamp_type(), comment="本次连续缺失起点")
    create_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), comment="创建与首次发现时间")
    update_time: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")


Index("idx_global_job_search", GlobalJob.job_title, GlobalJob.description, mysql_prefix="FULLTEXT", mysql_with_parser="ngram").ddl_if(dialect="mysql")
