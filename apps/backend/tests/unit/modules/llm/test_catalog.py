import litellm
import pytest

from linkcv.modules.llm.catalog import (
    CHAT_ADAPTERS,
    assemble_model_identifier,
    chat_model_suggestions,
)


def test_deepseek_identifier_keeps_adapter_and_call_name_separate() -> None:
    assert (
        assemble_model_identifier("deepseek", "deepseek-v4-flash")
        == "deepseek/deepseek-v4-flash"
    )


@pytest.mark.parametrize(
    "adapter,model",
    [
        ("unknown", "model"),
        ("deepseek", "deepseek/deepseek-chat"),
        ("deepseek", "x" * 121),
    ],
)
def test_invalid_adapter_or_ambiguous_call_name_is_rejected(
    adapter: str,
    model: str,
) -> None:
    with pytest.raises(ValueError):
        assemble_model_identifier(adapter, model)


def test_catalog_only_returns_chat_models_for_supported_adapter(monkeypatch) -> None:
    monkeypatch.setattr(
        litellm,
        "model_cost",
        {
            "deepseek/deepseek-chat": {
                "litellm_provider": "deepseek",
                "mode": "chat",
            },
            "deepseek/deepseek-embedding": {
                "litellm_provider": "deepseek",
                "mode": "embedding",
            },
            "openai/gpt-fictional": {
                "litellm_provider": "openai",
                "mode": "chat",
            },
        },
    )

    assert chat_model_suggestions("deepseek") == ["deepseek-chat"]
    assert "deepseek" in {adapter.code for adapter in CHAT_ADAPTERS}
