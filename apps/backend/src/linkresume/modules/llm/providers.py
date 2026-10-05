"""Server controlled provider addresses and protocol support.

Connection settings select a documented region/workspace; they cannot supply a
free-form inference URL that would receive a stored API key.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

OPENAI_CHAT = "openai_chat"
OPENAI_RESPONSES = "openai_responses"
ANTHROPIC_MESSAGES = "anthropic_messages"
GOOGLE_GENERATE = "google_generate"
ALIYUN_ASR_REALTIME = "aliyun_asr_realtime"
ALIYUN_TTS_REALTIME = "aliyun_tts_realtime"
SPEECH_PROTOCOLS = {
    "speech_to_text": frozenset({ALIYUN_ASR_REALTIME}),
    "text_to_speech": frozenset({ALIYUN_TTS_REALTIME}),
}

@dataclass(frozen=True)
class ProviderSpec:
    code: str
    label: str
    protocols: frozenset[str]
    target_kinds: frozenset[str]


PROVIDERS = {
    spec.code: spec for spec in (
        ProviderSpec("aihubmix", "AIHubMix", frozenset({OPENAI_CHAT, OPENAI_RESPONSES}), frozenset({"model"})),
        ProviderSpec("siliconflow", "硅基流动", frozenset({OPENAI_CHAT}), frozenset({"model"})),
        ProviderSpec("deepseek", "DeepSeek 直连", frozenset({OPENAI_CHAT}), frozenset({"model"})),
        ProviderSpec("volcengine", "火山方舟", frozenset({OPENAI_CHAT, OPENAI_RESPONSES}), frozenset({"model", "endpoint"})),
        ProviderSpec("aliyun", "阿里云百炼", frozenset({
            OPENAI_CHAT, ALIYUN_ASR_REALTIME, ALIYUN_TTS_REALTIME,
        }), frozenset({"model", "deployment"})),
        ProviderSpec("opencode_zen", "OpenCode Zen", frozenset({
            OPENAI_CHAT, OPENAI_RESPONSES, ANTHROPIC_MESSAGES, GOOGLE_GENERATE,
        }), frozenset({"model"})),
    )
}

_WORKSPACE = re.compile(r"^[a-zA-Z0-9-]{1,80}$")
_AIHUBMIX_BASE_URLS = {
    "primary": "https://aihubmix.com",
    "alternate": "https://api.inferera.com",
}
_ALIYUN_REGIONS = {
    "cn-beijing": "cn-beijing",
    "ap-southeast-1": "ap-southeast-1",
    "cn-hongkong": "cn-hongkong",
    "eu-central-1": "eu-central-1",
    "ap-northeast-1": "ap-northeast-1",
    "us-east-1": "us-east-1",
}


def validate_settings(provider_code: str, settings: dict | None) -> dict:
    if provider_code not in PROVIDERS:
        raise ValueError("unsupported provider")
    value = dict(settings or {})
    if provider_code == "aihubmix":
        if set(value) - {"endpoint"} or value.get("endpoint", "primary") not in _AIHUBMIX_BASE_URLS:
            raise ValueError("unsupported AIHubMix endpoint")
    elif provider_code == "aliyun":
        if set(value) - {"region", "workspace_id"}:
            raise ValueError("unsupported Aliyun setting")
        region = value.get("region")
        if region not in _ALIYUN_REGIONS:
            raise ValueError("unsupported Aliyun region")
        workspace = value.get("workspace_id")
        if workspace is not None and (
            not isinstance(workspace, str) or not _WORKSPACE.fullmatch(workspace)
        ):
            raise ValueError("invalid workspace ID")
        if region in {"cn-beijing", "eu-central-1", "ap-northeast-1", "us-east-1"} and not workspace:
            raise ValueError("workspace ID required in this region")
    elif value:
        raise ValueError("provider does not accept connection settings")
    return value


def aihubmix_base_url(settings: dict | None = None) -> str:
    value = validate_settings("aihubmix", settings)
    return _AIHUBMIX_BASE_URLS[value.get("endpoint", "primary")]


def inference_base_url(provider_code: str, settings: dict | None = None) -> str:
    if provider_code == "aihubmix":
        return f"{aihubmix_base_url(settings)}/v1"
    value = validate_settings(provider_code, settings)
    if provider_code == "siliconflow":
        return "https://api.siliconflow.cn/v1"
    if provider_code == "deepseek":
        return "https://api.deepseek.com/v1"
    if provider_code == "volcengine":
        return "https://ark.cn-beijing.volces.com/api/v3"
    if provider_code == "opencode_zen":
        return "https://opencode.ai/zen/v1"
    region = value["region"]
    workspace = value.get("workspace_id")
    if workspace:
        return f"https://{workspace}.{region}.maas.aliyuncs.com/compatible-mode/v1"
    return {
        "ap-southeast-1": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "cn-hongkong": "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
    }[region]


_DASHSCOPE_SPEECH_HOSTS = {
    "cn-beijing": "dashscope.aliyuncs.com",
    "ap-southeast-1": "dashscope-intl.aliyuncs.com",
}


def speech_ws_url(provider_code: str, settings: dict | None = None) -> str:
    """DashScope realtime speech endpoint for the connection's region."""
    if provider_code != "aliyun":
        raise ValueError("provider does not support speech")
    region = validate_settings(provider_code, settings)["region"]
    host = _DASHSCOPE_SPEECH_HOSTS.get(region)
    if host is None:
        raise ValueError("speech is unavailable in this region")
    return f"wss://{host}/api-ws/v1/inference/"


def validate_use_case_protocol(use_case: str, protocol_code: str) -> None:
    """Speech use cases take only their speech protocol; chat use cases never do."""
    speech = SPEECH_PROTOCOLS.get(use_case)
    if speech is not None:
        if protocol_code not in speech:
            raise ValueError("protocol unsupported for speech use case")
    elif use_case != "assistant_conversation" and protocol_code != OPENAI_CHAT:
        raise ValueError("protocol unsupported for use case")


def validate_route(provider_code: str, target_kind: str, protocol_code: str) -> None:
    spec = PROVIDERS.get(provider_code)
    if spec is None or target_kind not in spec.target_kinds or protocol_code not in spec.protocols:
        raise ValueError("provider route or protocol unsupported")


def pi_api(protocol_code: str) -> str:
    return {
        OPENAI_CHAT: "openai-completions",
        OPENAI_RESPONSES: "openai-responses",
        ANTHROPIC_MESSAGES: "anthropic-messages",
        GOOGLE_GENERATE: "google-generative-ai",
    }[protocol_code]
