from __future__ import annotations

import re

CHAT_CAPABILITY = "chat"
RESUME_STRUCTURING_CAPABILITY = "resume_structuring"
PI_AGENT_CAPABILITY = "pi_agent"
JOB_IMAGE_STRUCTURING_CAPABILITY = "job_image_structuring"
MODEL_CAPABILITIES = (
    CHAT_CAPABILITY,
    RESUME_STRUCTURING_CAPABILITY,
    PI_AGENT_CAPABILITY,
    JOB_IMAGE_STRUCTURING_CAPABILITY,
)

# The single wire protocol this project reaches. Pi Service registers a
# provider for it at runtime, so both callers share one identifier.
PI_CHAT_API = "openai-completions"

MODEL_CALL_NAME_PATTERN = re.compile(r"^\S(?:.*\S)?$", re.DOTALL)


def normalize_capability(value: str) -> str:
    normalized = value.strip()
    if normalized not in MODEL_CAPABILITIES:
        raise ValueError("unsupported model capability")
    return normalized


def normalize_model_call_name(value: str) -> str:
    """Normalize a vendor-side model identifier used in call requests."""
    normalized = value.strip()
    if not normalized:
        raise ValueError("model must not be empty")
    if not MODEL_CALL_NAME_PATTERN.fullmatch(normalized):
        raise ValueError("model must not be padded with whitespace")
    if len(normalized) > 128:
        raise ValueError("model identifier is too long")
    return normalized
