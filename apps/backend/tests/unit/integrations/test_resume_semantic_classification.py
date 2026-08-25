import asyncio
from types import SimpleNamespace

import pytest

from linkcv.domain.resume_document import (
    CustomItem,
    CustomSection,
    ResumeDocument,
    ResumeSections,
    RichText,
    with_default_semantics,
)
from linkcv.integrations.resume_semantic_classification import (
    classification_payload,
    classify_resume_sections,
)
from linkcv.modules.resumes.schemas import (
    SemanticClassificationModelResult,
    SemanticClassificationSuggestion,
)


def document() -> ResumeDocument:
    return with_default_semantics(
        ResumeDocument(
            sections=ResumeSections(
                custom_sections=[
                    CustomSection(
                        id="custom_growth",
                        title="成长轨迹",
                        items=[
                            CustomItem(
                                id="custom_growth_item",
                                content=RichText(
                                    content="在虚构公司负责客户运营、数据复盘和跨团队协作"
                                ),
                            )
                        ],
                    )
                ]
            ),
            semantic_sections=[],
        )
    )


def test_payload_contains_title_body_and_neighbor_context() -> None:
    payload, allowed_ids = classification_payload(document(), None)

    assert allowed_ids == {"semantic_custom_growth"}
    assert payload["sections"] == [
        {
            "section_id": "semantic_custom_growth",
            "title": "成长轨迹",
            "body": "在虚构公司负责客户运营、数据复盘和跨团队协作",
            "previous_title": "基本信息",
            "next_title": None,
        }
    ]


def test_payload_never_reclassifies_a_user_confirmed_section() -> None:
    confirmed = document()
    confirmed.semantic_sections[-1] = confirmed.semantic_sections[-1].model_copy(
        update={"semantic_kind": "activity", "semantic_source": "user"}
    )

    payload, allowed_ids = classification_payload(confirmed, None)

    assert payload == {"sections": []}
    assert allowed_ids == set()


def test_classification_keeps_model_output_scoped_to_requested_sections() -> None:
    class FakeService:
        async def structured_chat(self, *_args, **_kwargs):
            return SimpleNamespace(
                value=SemanticClassificationModelResult(
                    suggestions=[
                        SemanticClassificationSuggestion(
                            section_id="semantic_custom_growth",
                            semantic_kind="work",
                            confidence=0.91,
                            reason="正文描述了企业职责和协作成果",
                        )
                    ]
                )
            )

    result = asyncio.run(
        classify_resume_sections(
            FakeService(),  # type: ignore[arg-type]
            user_id=1,
            document=document(),
            selected_section_ids={"semantic_custom_growth"},
        )
    )

    assert result.suggestions[0].semantic_kind == "work"


def test_classification_rejects_unknown_model_section_ids() -> None:
    class FakeService:
        async def structured_chat(self, *_args, **_kwargs):
            return SimpleNamespace(
                value=SemanticClassificationModelResult(
                    suggestions=[
                        SemanticClassificationSuggestion(
                            section_id="semantic_unknown",
                            semantic_kind="work",
                            confidence=0.8,
                            reason="无效测试结果",
                        )
                    ]
                )
            )

    with pytest.raises(ValueError, match="invalid section ids"):
        asyncio.run(
            classify_resume_sections(
                FakeService(),  # type: ignore[arg-type]
                user_id=1,
                document=document(),
                selected_section_ids=None,
            )
        )
