import asyncio
import json

import pytest
from pydantic import ValidationError

from linkcv.domain.section_ir import build_section_ir
from linkcv.integrations.resume_structuring import (
    LLMResumeStructuringClient,
    ResumeStructureInvalidError,
)
from linkcv.modules.llm.catalog import RESUME_STRUCTURING_CAPABILITY
from linkcv.modules.llm.schemas import StructuredChatResult
from linkcv.modules.llm.service import LLMError


class FakeLLMService:
    def __init__(self, content: str | None = None, error_code: str | None = None) -> None:
        self.content = content
        self.error_code = error_code
        self.calls = []

    async def structured_chat(
        self,
        user_id,
        messages,
        *,
        source,
        response_model,
        capability,
    ):
        self.calls.append((user_id, messages, source, response_model, capability))
        if self.error_code is not None:
            raise LLMError(self.error_code, "llmcall_fixture")
        assert self.content is not None
        return StructuredChatResult(
            value=response_model.model_validate_json(self.content),
            call_id="llmcall_fixture",
        )


def mapping_payload(section_ir) -> str:
    decisions = []
    for index, block in enumerate(section_ir.blocks):
        if index == 0:
            semantic_kind, layout_role = "basics", "name"
        elif block.block_type == "heading":
            semantic_kind, layout_role = "skills", "section_heading"
        else:
            semantic_kind, layout_role = "skills", "body"
        decisions.append(
            {
                "source_id": block.source_id,
                "semantic_kind": semantic_kind,
                "layout_role": layout_role,
            }
        )
    return json.dumps({"decisions": decisions, "groups": []}, ensure_ascii=False)


def test_structuring_client_sends_ordered_source_layout_and_strict_schema() -> None:
    section_ir = build_section_ir("# 测试者\n\n## 技能\nPython\n- FastAPI")
    service = FakeLLMService(mapping_payload(section_ir))
    client = LLMResumeStructuringClient(service)  # type: ignore[arg-type]

    draft = asyncio.run(
        client.extract(user_id=42, section_ir=section_ir, timeout_seconds=5)
    )

    assert len(draft.decisions) == len(section_ir.blocks)
    user_id, messages, source, response_model, capability = service.calls[0]
    assert user_id == 42
    payload = json.loads(messages[1].content)
    assert set(payload) == {"document"}
    assert set(payload["document"]) == {"schema_version", "source_format", "blocks"}
    assert payload["document"]["schema_version"] == "1"
    assert payload["document"]["source_format"] == "md"
    assert [item["source_id"] for item in payload["document"]["blocks"]] == [
        block.source_id for block in section_ir.blocks
    ]
    assert set(payload["document"]["blocks"][0]) == {
        "source_id",
        "ordinal",
        "block_type",
        "markdown",
        "parent_section_id",
        "heading_level",
        "source_span",
        "list",
    }
    serialized = messages[1].content
    assert "document_heading_structure_missing" not in serialized
    assert "42" not in serialized
    assert "request_id" not in serialized
    assert "object_key" not in serialized
    assert "entry_header" in messages[0].content
    assert "技术栈或句中分隔符必须使用 body" in messages[0].content
    assert source == "resume_import"
    assert response_model.__name__ == "ResumeExtractionDraft"
    assert capability == RESUME_STRUCTURING_CAPABILITY


def test_structuring_model_boundary_rejects_typed_and_unmapped_payload() -> None:
    section_ir = build_section_ir("# 测试者")
    for content in (
        '{"basics":{"name":"测试者"}}',
        '{"decisions":[],"groups":[],"unmapped_fragments":["正文"]}',
    ):
        client = LLMResumeStructuringClient(FakeLLMService(content))  # type: ignore[arg-type]
        with pytest.raises(ValidationError):
            asyncio.run(
                client.extract(user_id=42, section_ir=section_ir, timeout_seconds=5)
            )


def test_structuring_client_rejects_incomplete_or_invalid_mapping() -> None:
    section_ir = build_section_ir("# 测试者\n正文")
    content = json.dumps(
        {
            "decisions": [
                {
                    "source_id": section_ir.blocks[0].source_id,
                    "semantic_kind": "basics",
                    "layout_role": "name",
                },
            ],
            "groups": [],
        }
    )
    client = LLMResumeStructuringClient(FakeLLMService(content))  # type: ignore[arg-type]

    with pytest.raises(ResumeStructureInvalidError):
        asyncio.run(
            client.extract(user_id=42, section_ir=section_ir, timeout_seconds=5)
        )


def test_structuring_client_rejects_model_error() -> None:
    client = LLMResumeStructuringClient(  # type: ignore[arg-type]
        FakeLLMService(error_code="LLM_RESPONSE_INVALID")
    )

    with pytest.raises(ResumeStructureInvalidError):
        asyncio.run(
            client.extract(
                user_id=42,
                section_ir=build_section_ir("# 测试者"),
                timeout_seconds=5,
            )
        )
