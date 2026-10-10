"""Recognize a run's intent without granting any new resource permissions."""

import asyncio
import json
import logging
from weakref import WeakValueDictionary

import anyio
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from drawoffer.core.errors import ApiError
from drawoffer.modules.agent.intent_schemas import (
    INTENT_POLICY, PLANNING_RULES, IntentDecision, IntentDiagnostic,
)
from drawoffer.modules.agent.models import AgentMessage, AgentRun
from drawoffer.modules.agent.conversation_memory import conversation_memory
from drawoffer.modules.agent.schemas import AgentTaskPlanRequest
from drawoffer.modules.agent.service import get_active_run, save_task_plan, _run_task_message
from drawoffer.modules.llm.resolver import ASSISTANT_INTENT
from drawoffer.modules.llm.schemas import ChatMessage
from drawoffer.modules.llm.service import LLMError

INTENT_TIMEOUT_SECONDS = 10
RESPONSE_VERSION = 2
logger = logging.getLogger("drawoffer.agent")


async def _watch_cancellation(request: Request, run_id: int) -> None:
    def active() -> bool:
        with request.app.state.session_factory() as session:
            return session.scalar(select(AgentRun.status).where(AgentRun.id == run_id)) == "running"
    while True:
        if not await asyncio.to_thread(active):
            return
        await asyncio.sleep(0.2)


async def _watch_disconnect(request: Request) -> None:
    while (await request.receive())["type"] != "http.disconnect":
        pass


async def _complete(request: Request, run_id: int, **kwargs):
    result = {}
    # ASGI receive uses AnyIO cancellation scopes; cancel the group rather than
    # a raw asyncio task so middleware cannot swallow a one-shot cancellation.
    async with anyio.create_task_group() as group:
        async def complete():
            try:
                result["value"] = await request.app.state.llm_service.structured_chat(**kwargs)
            except Exception as error:
                result["error"] = error
            finally:
                group.cancel_scope.cancel()

        async def watch(watcher):
            await watcher
            result["cancelled"] = True
            group.cancel_scope.cancel()

        group.start_soon(complete)
        group.start_soon(watch, _watch_cancellation(request, run_id))
        group.start_soon(watch, _watch_disconnect(request))
    if result.get("cancelled") or not result:
        raise asyncio.CancelledError
    if "error" in result:
        raise result["error"]
    return result["value"]


def intent_input(message: AgentMessage, history: list[AgentMessage], memory: dict | None = None) -> str:
    metadata = message.metadata_json or {}
    contexts = [
        {key: ref[key] for key in ("type", "id", "label", "presentation") if key in ref}
        for ref in metadata.get("contexts", []) if isinstance(ref, dict)
    ]
    # Never include material bodies, locators, credentials or provider responses.
    return json.dumps({
        "request": message.content[:12000],
        "history": [{"role": item.role, "content": item.content[:1500]} for item in history[-4:]],
        "authorized_contexts": contexts,
        "conversation_memory": memory or {"schema_version": 1, "events": [], "truncated": False},
        "clarification_answers": metadata.get("clarification_answers", [])[:5],
    }, ensure_ascii=False)


def _versioned(response: dict) -> dict:
    """The one wire shape Pi accepts; fallback carries the single copy of the routing rules."""
    response = {**response, "version": RESPONSE_VERSION}
    if response["mode"] == "fallback":
        response["routing_rules"] = PLANNING_RULES
    return response


async def recognize_run_intent(request: Request, db: Session, run_id: str) -> dict:
    # Serialize same-run requests without retaining a growing lock registry.
    locks = getattr(request.app.state, "intent_locks", None)
    if locks is None:
        locks = WeakValueDictionary()
        request.app.state.intent_locks = locks
    lock = locks.setdefault(run_id, asyncio.Lock())
    async with lock:
        db.expire_all()
        run, session = get_active_run(db, run_id)
        message = _run_task_message(db, run)
        metadata = dict(message.metadata_json or {})
        if "agent_tasks" in metadata:
            db.rollback()
            return _versioned({"mode": "plan", "tasks": metadata["agent_tasks"],
                               "resume_switch": bool((metadata.get("agent_intent") or {}).get("resume_switch"))})
        if "agent_intent" in metadata:
            db.rollback()
            return _versioned(metadata["agent_intent"])
        history = list(db.scalars(select(AgentMessage).where(
            AgentMessage.session_id == session.id,
            AgentMessage.sequence_no < message.sequence_no,
        ).order_by(AgentMessage.sequence_no.desc()).limit(4)))[::-1]
        text = intent_input(message, history, conversation_memory(db, run))
        user_id, run_pk = session.user_id, run.id
        has_resume = any(ref.get("type") == "resume" and ref.get("presentation", "mention") != "implicit"
                         for ref in metadata.get("contexts", []))
        # Release DB row locks before the network request.
        db.rollback()
        try:
            async with asyncio.timeout(INTENT_TIMEOUT_SECONDS):
                result = await _complete(
                    request, run_pk, user_id=user_id,
                    messages=(ChatMessage(role="system", content=INTENT_POLICY),
                              ChatMessage(role="user", content=text)),
                    source="agent_intent", use_case=ASSISTANT_INTENT,
                    response_model=IntentDecision, agent_run_id=run_pk,
                )
            decision = result.value
            if has_resume and "resume_identity" in decision.clarification_purposes and not decision.resume_identity_conflict:
                response = {"mode": "fallback", "reason": "INTENT_DECISION_INCONSISTENT", "call_id": result.call_id}
            elif decision.resume_identity_conflict and not has_resume:
                response = {"mode": "fallback", "reason": "INTENT_DECISION_INCONSISTENT", "call_id": result.call_id}
            else:
                response = decision.model_dump(mode="json")
                response["call_id"] = result.call_id
        except TimeoutError:
            response = {"mode": "fallback", "reason": "INTENT_TIMEOUT"}
        except LLMError as error:
            response = {"mode": "fallback", "reason": error.code, "call_id": error.call_id}
            if error.decision_detail:
                # Only known question names and bounded numeric values can enter metadata/logs.
                try:
                    response["decision_detail"] = IntentDiagnostic.model_validate(error.decision_detail).model_dump(exclude_none=True)
                except ValueError:
                    pass
        # Cancellation is deliberately not caught: it must not execute fallback.
        db.expire_all()
        run, _ = get_active_run(db, run_id)
        message = _run_task_message(db, run)
        metadata = dict(message.metadata_json or {})
        if "agent_tasks" in metadata:
            db.rollback()
            raise ApiError(409, "AGENT_TASK_PLAN_CONFLICT")
        if response["mode"] == "plan":
            # Invalid authorization is a business refusal, not an LLM fallback.
            tasks = save_task_plan(db, run=run, payload=AgentTaskPlanRequest(
                tasks=response["tasks"], resume_switch=bool(response.get("resume_switch"))))
            response["tasks"] = tasks
            message = _run_task_message(db, run)
            metadata = dict(message.metadata_json or {})
        # Persist only bounded enums and call IDs, never the raw decision text.
        metadata["agent_intent"] = {key: value for key, value in response.items() if key != "tasks"}
        response = _versioned(response)
        message.metadata_json = metadata
        db.commit()
        logger.log(logging.WARNING if response["mode"] == "fallback" else logging.INFO,
                   "agent intent recognition result", extra={
                       "action": "recognize_intent", "operation_id": run_id,
                       "stage": "model_execution",
                       "result": "failed" if response["mode"] == "fallback" else "succeeded",
                       "error_code": response.get("reason"), "call_id": response.get("call_id"),
                       "intent_mode": response["mode"], "candidate_count": len(response.get("tasks", [])),
                       "decision_field": response.get("decision_detail", {}).get("field"),
                       "decision_confidence": response.get("decision_detail", {}).get("confidence"),
                   })
        return response
