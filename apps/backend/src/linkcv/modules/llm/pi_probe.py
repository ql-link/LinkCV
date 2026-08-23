from __future__ import annotations

import secrets
from typing import Any

import httpx

from linkcv.core.config import Settings
from linkcv.modules.llm.gateway import GatewayUsage
from linkcv.modules.llm.service import RuntimeModelConfig


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
        config: RuntimeModelConfig,
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
                "adapter": config.adapter,
                "id": str(config.id),
                "name": config.model_call_name,
                "apiKey": api_key,
                **({"baseUrl": config.api_base} if config.api_base else {}),
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
        return GatewayUsage(
            input_tokens=usage["inputTokens"],
            output_tokens=usage["outputTokens"],
        )
