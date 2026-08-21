from __future__ import annotations

from dataclasses import dataclass

import litellm

CHAT_CAPABILITY = "chat"


@dataclass(frozen=True)
class ChatAdapterDefinition:
    code: str
    label: str
    requires_api_key: bool = True


CHAT_ADAPTERS: tuple[ChatAdapterDefinition, ...] = (
    ChatAdapterDefinition("openai", "OpenAI"),
    ChatAdapterDefinition("anthropic", "Anthropic（Claude）"),
    ChatAdapterDefinition("deepseek", "DeepSeek"),
    ChatAdapterDefinition("dashscope", "阿里云百炼（千问）"),
    ChatAdapterDefinition("openrouter", "OpenRouter"),
    ChatAdapterDefinition("gemini", "Google Gemini"),
    ChatAdapterDefinition("xai", "xAI"),
    ChatAdapterDefinition("groq", "Groq"),
    ChatAdapterDefinition("mistral", "Mistral AI"),
    ChatAdapterDefinition("cohere_chat", "Cohere"),
    ChatAdapterDefinition("perplexity", "Perplexity"),
)
CHAT_ADAPTER_BY_CODE = {adapter.code: adapter for adapter in CHAT_ADAPTERS}


def normalize_adapter(value: str) -> str:
    normalized = value.strip()
    if normalized not in CHAT_ADAPTER_BY_CODE:
        raise ValueError("unsupported Chat adapter")
    return normalized


def normalize_model_call_name(adapter: str, value: str) -> str:
    normalized_adapter = normalize_adapter(adapter)
    normalized = value.strip()
    if not normalized:
        raise ValueError("model must not be empty")
    if normalized.startswith(f"{normalized_adapter}/"):
        raise ValueError("model must not repeat the adapter prefix")
    if len(f"{normalized_adapter}/{normalized}") > 128:
        raise ValueError("assembled model identifier is too long")
    return normalized


def assemble_model_identifier(adapter: str, model_call_name: str) -> str:
    normalized_adapter = normalize_adapter(adapter)
    normalized_model = normalize_model_call_name(normalized_adapter, model_call_name)
    return f"{normalized_adapter}/{normalized_model}"


def adapter_requires_api_key(adapter: str) -> bool:
    return CHAT_ADAPTER_BY_CODE[normalize_adapter(adapter)].requires_api_key


def chat_model_suggestions(adapter: str) -> list[str]:
    normalized_adapter = normalize_adapter(adapter)
    prefix = f"{normalized_adapter}/"
    suggestions: set[str] = set()
    for model_key, details in litellm.model_cost.items():
        if not isinstance(model_key, str) or not isinstance(details, dict):
            continue
        if details.get("litellm_provider") != normalized_adapter:
            continue
        if details.get("mode") != "chat":
            continue
        model_call_name = (
            model_key[len(prefix) :] if model_key.startswith(prefix) else model_key
        ).strip()
        if not model_call_name or model_call_name.startswith(prefix):
            continue
        if len(f"{prefix}{model_call_name}") <= 128:
            suggestions.add(model_call_name)
    return sorted(suggestions)
