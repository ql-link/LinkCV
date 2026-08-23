from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict, Field, field_validator

from linkcv.modules.llm.schemas import ChatMessage
from linkcv.modules.resumes.schemas import ResumeAiEditRequest


class ResumeAiEditDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    replacement: str = Field(strict=True, min_length=1, max_length=8_000)

    @field_validator("replacement")
    @classmethod
    def normalize_replacement(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("replacement must not be blank")
        return normalized


def build_resume_ai_edit_messages(payload: ResumeAiEditRequest) -> tuple[ChatMessage, ...]:
    system = ChatMessage(
        role="system",
        content=(
            "你是简历局部文字编辑器。只改写用户提供的选中文字，并遵守编辑指令。"
            "保留原文语言、事实、专有名词、数字和时间；除非指令明确要求，不要虚构经历、"
            "指标、技能或结果。输出应能直接替换原文，不要解释修改过程，不要添加 Markdown "
            "代码围栏。若给出上一版建议，应在它的基础上继续调整。"
        ),
    )
    edit_context = {
        "selected_text": payload.selected_text,
        "instruction": payload.instruction,
        "previous_suggestion": payload.previous_suggestion,
    }
    return system, ChatMessage(
        role="user",
        content=json.dumps(edit_context, ensure_ascii=False, separators=(",", ":")),
    )
