import json
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation

import httpx
from pydantic import ValidationError
from sqlalchemy import func, select

from linkcv.core.database import utc_now
from linkcv.core.errors import ApiError
from linkcv.modules.agent.models import AgentMessage, AgentRun, AgentSession
from linkcv.modules.agent.schemas import AgentClarification, AgentContextMaterial


RUN_PHASE_LABELS = {
    "loading_context": "正在读取所选资料…",
    "comparing_context": "正在分析简历与岗位要求…",
    "drafting": "正在整理建议…",
}
_VISIBLE_EVENTS = {
    "run.started",
    "run.phase",
    "assistant.delta",
    "clarification.requested",
    "proposal.created",
    "run.completed",
    "run.cancelled",
    "run.failed",
}
_LEGACY_TOOL_EVENTS = {"tool.started", "tool.completed"}


def sse_event(event_type: str, data: dict[str, object]) -> bytes:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


async def stream_pi_run(
    app,
    run_public_id: str,
    content: str,
    selection_context=None,
    context_materials: list[AgentContextMaterial] | None = None,
) -> AsyncIterator[bytes]:
    settings = app.state.settings
    token = settings.pi_service_token
    if not settings.agent_enabled or token is None:
        yield sse_event(
            "run.failed", {"runId": run_public_id, "error": "AGENT_UNAVAILABLE"}
        )
        _finalize(app, run_public_id, "failed", error_code="AGENT_UNAVAILABLE")
        return

    assistant_parts: list[str] = []
    clarification: AgentClarification | None = None
    final_status = "failed"
    final_error: str | None = "AGENT_UPSTREAM_FAILED"
    terminal_received = False
    final_input_tokens: int | None = None
    final_output_tokens: int | None = None
    final_estimated_cost: Decimal | None = None
    url = f"{settings.pi_service_base_url}/internal/agent/runs"
    headers = {"Authorization": f"Bearer {token.get_secret_value()}"}
    timeout = httpx.Timeout(settings.agent_run_timeout_seconds, connect=5.0)
    history = _conversation_history(app, run_public_id)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                url,
                headers=headers,
                json={
                    "runId": run_public_id,
                    "content": content,
                    "history": history,
                    **(
                        {
                            "selectionContext": selection_context.model_dump(
                                mode="json", by_alias=True
                            )
                        }
                        if selection_context is not None
                        else {}
                    ),
                    **(
                        {
                            "contextMaterials": [
                                item.model_dump(mode="json")
                                if isinstance(item, AgentContextMaterial)
                                else item
                                for item in (context_materials or [])
                            ]
                        }
                        if context_materials
                        else {}
                    ),
                },
            ) as response:
                if response.status_code != 200:
                    error = (
                        "AGENT_MODEL_UNAVAILABLE"
                        if response.status_code == 503
                        else "AGENT_UPSTREAM_FAILED"
                    )
                    yield sse_event(
                        "run.failed", {"runId": run_public_id, "error": error}
                    )
                    final_error = error
                    return
                event_name: str | None = None
                async for line in response.aiter_lines():
                    if line.startswith("event: "):
                        event_name = line[7:]
                    elif line.startswith("data: "):
                        raw = line[6:]
                        try:
                            payload = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(payload, dict):
                            continue
                        if event_name == "assistant.delta" and isinstance(
                            payload.get("delta"), str
                        ):
                            assistant_parts.append(payload["delta"])
                        if event_name == "clarification.requested":
                            if clarification is not None:
                                final_status = "failed"
                                final_error = "AGENT_CLARIFICATION_INVALID"
                                terminal_received = True
                                yield sse_event(
                                    "run.failed",
                                    {"runId": run_public_id, "error": final_error},
                                )
                                break
                            try:
                                clarification = AgentClarification.model_validate(
                                    payload.get("clarification")
                                )
                            except ValidationError:
                                final_status = "failed"
                                final_error = "AGENT_CLARIFICATION_INVALID"
                                terminal_received = True
                                yield sse_event(
                                    "run.failed",
                                    {"runId": run_public_id, "error": final_error},
                                )
                                break
                        if event_name == "run.completed":
                            terminal_received = True
                            final_status, final_error = "succeeded", None
                            (
                                final_input_tokens,
                                final_output_tokens,
                                final_estimated_cost,
                            ) = _safe_usage(payload.get("usage"))
                        elif event_name == "run.cancelled":
                            terminal_received = True
                            final_status, final_error = "cancelled", None
                        elif event_name == "run.failed":
                            terminal_received = True
                            final_status = "failed"
                            value = payload.get("error")
                            final_error = (
                                value if isinstance(value, str) else final_error
                            )
                        if event_name not in _VISIBLE_EVENTS and not (
                            context_materials is None
                            and event_name in _LEGACY_TOOL_EVENTS
                        ):
                            continue
                        if event_name == "run.phase":
                            payload = _safe_phase_payload(
                                run_public_id, payload, len(context_materials or [])
                            )
                        yield sse_event(event_name, payload)
                    elif not line:
                        event_name = None
                if not terminal_received:
                    final_status = "failed"
                    final_error = "AGENT_UPSTREAM_FAILED"
                    yield sse_event(
                        "run.failed",
                        {"runId": run_public_id, "error": final_error},
                    )
    except httpx.TimeoutException:
        final_error = "AGENT_TIMEOUT"
        yield sse_event("run.failed", {"runId": run_public_id, "error": final_error})
    except httpx.HTTPError:
        final_error = "AGENT_UNAVAILABLE"
        yield sse_event("run.failed", {"runId": run_public_id, "error": final_error})
    finally:
        _finalize(
            app,
            run_public_id,
            final_status,
            error_code=final_error,
            assistant_content="".join(assistant_parts).strip() or None,
            clarification=(
                clarification.model_dump(mode="json", exclude_none=True)
                if clarification
                else None
            ),
            input_tokens=final_input_tokens,
            output_tokens=final_output_tokens,
            estimated_cost=final_estimated_cost,
        )


def _safe_phase_payload(
    run_public_id: str, payload: dict[str, object], fallback_count: int
) -> dict[str, object]:
    phase = payload.get("phase")
    phase_name = (
        phase if isinstance(phase, str) and phase in RUN_PHASE_LABELS else "unknown"
    )
    raw_count = payload.get("referencedContextCount", fallback_count)
    context_count = (
        raw_count
        if isinstance(raw_count, int)
        and not isinstance(raw_count, bool)
        and 0 <= raw_count <= 10
        else fallback_count
    )
    return {
        "runId": run_public_id,
        "phase": phase_name,
        "label": RUN_PHASE_LABELS.get(phase_name, "AI 正在处理…"),
        "referencedContextCount": context_count,
    }


async def cancel_pi_run(app, run_public_id: str) -> None:
    settings = app.state.settings
    token = settings.pi_service_token
    if not settings.agent_enabled or token is None:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{settings.pi_service_base_url}/internal/agent/runs/{run_public_id}/cancel",
                headers={"Authorization": f"Bearer {token.get_secret_value()}"},
            )
    except httpx.HTTPError:
        # Cancellation is best-effort. The database state remains authoritative and
        # the streaming connection closing also aborts the Pi-side session.
        return


async def check_pi_readiness(app) -> None:
    settings = app.state.settings
    token = settings.pi_service_token
    if not settings.agent_enabled or token is None:
        raise ApiError(503, "AGENT_NOT_READY")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{settings.pi_service_base_url}/internal/agent/readiness",
                headers={"Authorization": f"Bearer {token.get_secret_value()}"},
            )
        payload = response.json() if response.status_code == 200 else None
        if not isinstance(payload, dict) or payload.get("ready") is not True:
            raise ApiError(503, "AGENT_NOT_READY")
    except (httpx.HTTPError, ValueError, TypeError) as error:
        raise ApiError(503, "AGENT_NOT_READY") from error


def _conversation_history(app, run_public_id: str) -> list[dict[str, str]]:
    with app.state.session_factory() as db:
        run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_public_id))
        if run is None:
            return []
        messages = db.scalars(
            select(AgentMessage)
            .where(AgentMessage.session_id == run.session_id)
            .order_by(AgentMessage.sequence_no.desc())
            .limit(41)
        ).all()
        remaining = 24_000
        history: list[dict[str, str]] = []
        for message in messages:
            if message.run_id == run.id:
                continue
            value = message.content.strip()
            if not value or remaining <= 0:
                continue
            value = value[-remaining:]
            remaining -= len(value)
            history.append({"role": message.role, "content": value})
        history.reverse()
        return history


def _finalize(
    app,
    run_public_id: str,
    status: str,
    *,
    error_code: str | None,
    assistant_content: str | None = None,
    clarification: dict[str, object] | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    estimated_cost: Decimal | None = None,
) -> None:
    with app.state.session_factory() as db:
        row = db.execute(
            select(AgentRun, AgentSession)
            .join(AgentSession, AgentSession.id == AgentRun.session_id)
            .where(AgentRun.public_id == run_public_id)
            .with_for_update()
        ).one_or_none()
        if row is None:
            return
        run, session = row
        if run.status != "running":
            return
        run.status = status
        run.error_code = error_code
        run.input_tokens = input_tokens if status == "succeeded" else None
        run.output_tokens = output_tokens if status == "succeeded" else None
        run.estimated_cost = estimated_cost if status == "succeeded" else None
        run.completed_at = utc_now()
        if status == "succeeded" and (assistant_content or clarification):
            sequence_no = (
                int(
                    db.scalar(
                        select(
                            func.coalesce(func.max(AgentMessage.sequence_no), 0)
                        ).where(AgentMessage.session_id == session.id)
                    )
                    or 0
                )
                + 1
            )
            db.add(
                AgentMessage(
                    session_id=session.id,
                    run_id=run.id,
                    sequence_no=sequence_no,
                    role="assistant",
                    message_type="clarification" if clarification else "text",
                    content=assistant_content or _clarification_text(clarification),
                    metadata_json=clarification,
                )
            )
            session.last_message_at = utc_now()
        db.commit()


def _clarification_text(value: dict[str, object] | None) -> str:
    if value is None:
        return "需要补充信息后才能继续。"
    questions = value.get("questions")
    if not isinstance(questions, list):
        return "需要补充信息后才能继续。"
    lines = ["继续前需要确认："]
    for index, question in enumerate(questions, start=1):
        if not isinstance(question, dict):
            continue
        prompt = question.get("question")
        if isinstance(prompt, str):
            lines.append(f"{index}. {prompt}")
        options = question.get("options")
        if isinstance(options, list):
            labels = [
                item.get("label")
                for item in options
                if isinstance(item, dict) and isinstance(item.get("label"), str)
            ]
            if labels:
                lines.append("   选项：" + " / ".join(labels) + " / 其他")
    return "\n".join(lines)


def _safe_usage(value: object) -> tuple[int | None, int | None, Decimal | None]:
    if not isinstance(value, dict):
        return None, None, None
    input_tokens = value.get("inputTokens")
    output_tokens = value.get("outputTokens")
    if (
        not isinstance(input_tokens, int)
        or isinstance(input_tokens, bool)
        or input_tokens < 0
        or not isinstance(output_tokens, int)
        or isinstance(output_tokens, bool)
        or output_tokens < 0
    ):
        return None, None, None
    raw_cost = value.get("estimatedCost")
    if raw_cost is None:
        return input_tokens, output_tokens, None
    try:
        cost = Decimal(str(raw_cost))
    except (InvalidOperation, ValueError):
        return input_tokens, output_tokens, None
    if not cost.is_finite() or cost < 0 or cost > Decimal("9999999999.99999999"):
        cost = None
    return input_tokens, output_tokens, cost
