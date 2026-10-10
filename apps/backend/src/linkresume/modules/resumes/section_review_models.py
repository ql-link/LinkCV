"""Persisted results of the editor's section focus review (revision 0118)."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, Index, PrimaryKeyConstraint, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from linkresume.core.database import Base
from linkresume.modules.resumes.models import (
    timestamp_type,
    unsigned_bigint_type,
    unsigned_int_type,
    unsigned_tinyint_type,
)

SECTION_REVIEW_ITEM_KINDS = ("missing", "wording", "structure", "ask", "draft")
SECTION_REVIEW_ITEM_STATUSES = ("todo", "asking", "pending", "done", "skipped")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class ResumeSectionReview(Base):
    """The latest focus analysis of one paragraph of a resume."""

    __tablename__ = "resume_section_review"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_resume_section_review"),
        UniqueConstraint("resume_id", "unit_id", name="uk_resume_section_review_unit"),
        CheckConstraint(
            "LOWER(JSON_TYPE(context_ids_json)) = 'array'",
            name="ck_resume_section_review_context_ids",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(base_lines_json)) = 'object'",
            name="ck_resume_section_review_base_lines",
        ),
        {"comment": "简历段落聚焦的最新一次分析，每段一行"},
    )

    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True, comment="主键")
    user_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="所属用户 ID")
    resume_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="所属简历 ID")
    unit_id: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="段落节点 ID（编辑器 node_id）"
    )
    analysis_no: Mapped[int] = mapped_column(
        unsigned_int_type(),
        nullable=False,
        default=1,
        server_default="1",
        comment="第几次分析，重新分析时加一",
    )
    reference_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="参照：general 或 method 写作法则"
    )
    job_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(), nullable=True, comment="参照的目标岗位 ID，无则为空"
    )
    intent: Mapped[str] = mapped_column(
        String(300), nullable=False, default="", server_default="", comment="用户填写的突出方向"
    )
    context_ids_json: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, comment="参考段落 ID 数组，至多 6 个"
    )
    base_lines_json: Mapped[dict[str, str]] = mapped_column(
        JSON(), nullable=False, comment="分析时各句原文：line_id 到文本"
    )
    result_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="分析结果：参照名、推断方向、是否内容太少、起草问题与批注"
    )
    create_time: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), comment="创建时间 UTC"
    )
    update_time: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间 UTC",
    )


class ResumeSectionReviewItem(Base):
    """One note, user request or draft inside a paragraph's focus analysis."""

    __tablename__ = "resume_section_review_item"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_resume_section_review_item"),
        CheckConstraint(_in("kind", SECTION_REVIEW_ITEM_KINDS), name="ck_resume_section_review_item_kind"),
        CheckConstraint(
            _in("status", SECTION_REVIEW_ITEM_STATUSES), name="ck_resume_section_review_item_status"
        ),
        CheckConstraint(
            "(status = 'done') = (edit_json IS NOT NULL)", name="ck_resume_section_review_item_edit"
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(answers_json)) = 'array'", name="ck_resume_section_review_item_answers"
        ),
        {"comment": "简历段落聚焦中的一条批注、自定义要求或起草"},
    )

    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True, comment="主键")
    user_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="所属用户 ID")
    resume_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False, comment="所属简历 ID")
    review_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, comment="所属段落分析 ID"
    )
    note_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="对应分析结果中的批注 ID；自定义要求和起草为空"
    )
    kind: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        comment="类型：missing 缺信息 / wording 表达 / structure 结构 / ask 自定义要求 / draft 起草",
    )
    line_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="作用的句子节点 ID，整段批注为空"
    )
    instruction: Mapped[str] = mapped_column(
        String(300), nullable=False, default="", server_default="", comment="用户自定义要求原话"
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        comment="状态：todo 未处理 / asking 追问中 / pending 待确认 / done 已采用 / skipped 已跳过",
    )
    question_index: Mapped[int] = mapped_column(
        unsigned_tinyint_type(),
        nullable=False,
        default=0,
        server_default="0",
        comment="当前追问序号，从 0 开始",
    )
    answers_json: Mapped[list[str]] = mapped_column(
        JSON(), nullable=False, comment="用户回答，按追问顺序的字符串数组，至多 3 个"
    )
    # none_as_null: Python None must be SQL NULL, not the JSON value null.
    draft_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(none_as_null=True), nullable=True, comment="候选：variants、missing、base_text、line_id"
    )
    selected_index: Mapped[int] = mapped_column(
        unsigned_tinyint_type(),
        nullable=False,
        default=0,
        server_default="0",
        comment="选中的候选序号",
    )
    edit_json: Mapped[dict[str, str] | None] = mapped_column(
        JSON(none_as_null=True), nullable=True, comment="已采用改动：line_id、before、after，仅 done 时非空"
    )
    create_time: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), comment="创建时间 UTC"
    )
    update_time: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间 UTC",
    )


Index("idx_resume_section_review_user", ResumeSectionReview.user_id)
Index(
    "idx_resume_section_review_item_resume",
    ResumeSectionReviewItem.resume_id,
    ResumeSectionReviewItem.review_id,
    ResumeSectionReviewItem.id,
)
Index("idx_resume_section_review_item_user", ResumeSectionReviewItem.user_id)
