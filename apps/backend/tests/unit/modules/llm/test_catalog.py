import pytest

from linkresume.modules.llm.catalog import (
    MODEL_CAPABILITIES,
    PI_CHAT_API,
    normalize_capability,
    normalize_model_call_name,
)


def test_capability_catalog_is_closed() -> None:
    assert MODEL_CAPABILITIES == (
        "chat",
        "resume_structuring",
        "pi_agent",
        "job_image_structuring",
    )
    assert normalize_capability(" chat ") == "chat"
    with pytest.raises(ValueError):
        normalize_capability("fictional_capability")


def test_pi_reaches_one_wire_protocol() -> None:
    # Pi Service registers a provider for this api identifier.
    assert PI_CHAT_API == "openai-completions"


def test_model_call_name_accepts_vendor_slashes_and_rejects_padding() -> None:
    assert normalize_model_call_name("z-ai/glm-4.6") == "z-ai/glm-4.6"
    assert normalize_model_call_name(" moonshotai/kimi-k2 ") == "moonshotai/kimi-k2"

    with pytest.raises(ValueError):
        normalize_model_call_name("   ")
    with pytest.raises(ValueError):
        normalize_model_call_name("x" * 129)
