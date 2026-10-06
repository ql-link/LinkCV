from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

import httpx

from linkresume.core.config import Settings
from linkresume.modules.llm.gateway import GatewayUsage
from linkresume.modules.llm.service import AgentRuntimeModel
from linkresume.modules.llm.providers import pi_api


class PiProbeError(Exception):
    def __init__(self, code: str, call_id: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.call_id = call_id


class PiProbeCoordinator:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport

    async def run_probe(
        self,
        config: AgentRuntimeModel,
        api_key: str,
    ) -> GatewayUsage:
        token = self._settings.pi_service_token
        if token is None:
            raise PiProbeError("LLM_PI_AGENT_UNAVAILABLE")
        run_id = f"pirun_{secrets.token_hex(16)}"
        nonce = secrets.token_urlsafe(24)
        payload = {
            "runId": run_id,
            "nonce": nonce,
            "model": {
                "provider": config.plan.provider_code,
                "api": pi_api(config.plan.protocol_code),
                "id": str(config.plan.route_id),
                "name": config.plan.invoke_target,
                "apiKey": api_key,
                "baseUrl": config.base_url,
            },
        }
        try:
            async with httpx.AsyncClient(
                base_url=self._settings.pi_service_base_url,
                timeout=self._settings.agent_run_timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.post(
                    "/internal/probes",
                    headers={
                        "Authorization": "Bearer "
                        + token.get_secret_value()
                    },
                    json=payload,
                )
        except httpx.TimeoutException as error:
            raise PiProbeError("LLM_PI_AGENT_TIMEOUT") from error
        except httpx.RequestError as error:
            raise PiProbeError("LLM_PI_AGENT_UNAVAILABLE") from error
        try:
            body: Any = response.json()
        except ValueError:
            body = None
        usage = body.get("usage") if isinstance(body, dict) else None
        if (
            response.status_code != 200
            or not isinstance(body, dict)
            or body.get("ok") is not True
            or body.get("runId") != run_id
            or not isinstance(body.get("toolCallId"), str)
            or not isinstance(usage, dict)
            or not isinstance(usage.get("inputTokens"), int)
            or usage["inputTokens"] < 0
            or not isinstance(usage.get("outputTokens"), int)
            or usage["outputTokens"] < 0
        ):
            raise PiProbeError("LLM_PI_AGENT_PROBE_FAILED")
        calls = usage.get("calls")
        if calls is not None:
            if not isinstance(calls, list) or not 1 <= len(calls) <= 20:
                raise PiProbeError("LLM_PI_AGENT_PROBE_FAILED")
            try:
                for call in calls:
                    if not isinstance(call, dict) or datetime.fromisoformat(call["requestStartedAt"]).tzinfo is None:
                        raise ValueError
                    for key in ("inputTokens", "outputTokens", "cacheRead", "cacheWrite"):
                        value = call.get(key)
                        if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
                            raise ValueError
            except (KeyError, TypeError, ValueError):
                raise PiProbeError("LLM_PI_AGENT_PROBE_FAILED") from None
        return GatewayUsage(
            input_tokens=usage["inputTokens"],
            output_tokens=usage["outputTokens"],
            details={"cacheRead": usage.get("cacheRead"), "cacheWrite": usage.get("cacheWrite"),
                     "usageSource": "pi", "usagePresent": usage.get("usagePresent", True), "calls": usage.get("calls")},
        )
