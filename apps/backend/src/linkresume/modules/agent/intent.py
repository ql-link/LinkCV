"""Recognize a run's intent without granting any new resource permissions."""

import asyncio
import json
from weakref import WeakValueDictionary

import anyio
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.core.errors import ApiError
from linkresume.modules.agent.intent_schemas import INTENT_POLICY, IntentDecision
from linkresume.modules.agent.models import AgentMessage, AgentRun
from linkresume.modules.agent.conversation_memory import conversation_memory
from linkresume.modules.agent.schemas import AgentTaskPlanRequest
from linkresume.modules.agent.service import get_active_run, save_task_plan, _run_task_message
from linkresume.modules.llm.resolver import ASSISTANT_INTENT
from linkresume.modules.llm.schemas import ChatMessage
from linkresume.modules.llm.service import LLMError

INTENT_TIMEOUT_SECONDS = 10


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
            return {"version": 1, "mode": "plan", "tasks": metadata["agent_tasks"]}
        if "agent_intent" in metadata:
            db.rollback()
            return metadata["agent_intent"]
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
            if has_resume and "resume_identity" in decision.clarification_purposes:
                response = {"version": 1, "mode": "fallback", "reason": "LLM_RESPONSE_INVALID", "call_id": result.call_id}
            else:
                response = decision.model_dump(mode="json")
                response["call_id"] = result.call_id
        except TimeoutError:
            response = {"version": 1, "mode": "fallback", "reason": "INTENT_TIMEOUT"}
        except LLMError as error:
            response = {"version": 1, "mode": "fallback", "reason": error.code, "call_id": error.call_id}
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
            tasks = save_task_plan(db, run=run, payload=AgentTaskPlanRequest(tasks=response["tasks"]))
            response["tasks"] = tasks
            message = _run_task_message(db, run)
            metadata = dict(message.metadata_json or {})
        # Persist only bounded enums and call IDs, never the raw decision text.
        metadata["agent_intent"] = {key: value for key, value in response.items() if key != "tasks"}
        message.metadata_json = metadata
        db.commit()
        return response
