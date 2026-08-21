import asyncio
import json

import pytest

from linkcv.domain.section_ir import build_section_ir
from linkcv.integrations.resume_structuring import (
    LLMResumeStructuringClient,
    ResumeStructureInvalidError,
)
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
    ):
        self.calls.append((user_id, messages, source, response_model))
        if self.error_code is not None:
            raise LLMError(self.error_code, "llmcall_fixture")
        assert self.content is not None
        return StructuredChatResult(
            value=response_model.model_validate_json(self.content),
            call_id="llmcall_fixture",
        )


def test_structuring_client_sends_only_section_content_and_strict_schema() -> None:
    service = FakeLLMService('{"basics":{"name":"张三"}}')
    client = LLMResumeStructuringClient(service)  # type: ignore[arg-type]
    section_ir = build_section_ir("# 张三\n\n## 技能\nPython")
    section_ir.warnings.append("document_heading_structure_missing")

    draft = asyncio.run(
        client.extract(user_id=42, section_ir=section_ir, timeout_seconds=5)
    )

    assert draft.basics.name == "张三"
    user_id, messages, source, response_model = service.calls[0]
    assert user_id == 42
    payload = json.loads(messages[1].content)
    assert set(payload) == {"document"}
    assert set(payload["document"]) == {"preamble", "sections"}
    assert set(payload["document"]["sections"][0]) == {
        "heading",
        "kind",
        "markdown",
    }
    serialized = messages[1].content
    assert "document_heading_structure_missing" not in serialized
    assert "42" not in serialized
    assert "request_id" not in serialized
    assert "object_key" not in serialized
    assert source == "resume_import"
    assert response_model.__name__ == "ResumeExtractionDraft"


def test_structuring_client_rejects_invalid_model_output() -> None:
    client = LLMResumeStructuringClient(  # type: ignore[arg-type]
        FakeLLMService(error_code="LLM_RESPONSE_INVALID")
    )

    with pytest.raises(ResumeStructureInvalidError):
        asyncio.run(
            client.extract(
                user_id=42,
                section_ir=build_section_ir("# 张三"),
                timeout_seconds=5,
            )
        )
