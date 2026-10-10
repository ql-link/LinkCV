"""Bounded resource identity memory; never a grant to read historical content."""

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from drawoffer.modules.agent.models import AgentMessage, AgentRun

MAX_MEMORY_CHARS = 6_000
RESOURCE_TYPES = frozenset({"user_profile", "resume", "dataset", "job", "application", "interview"})


def _dict_items(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def project_memory(messages: list[Any]) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    resources: set[tuple[str, str]] = set()
    truncated = False
    for message in sorted(messages, key=lambda item: item.sequence_no, reverse=True):
        if message.role != "user" or not isinstance(message.metadata_json, dict):
            continue
        metadata = message.metadata_json
        refs: dict[tuple[str, str], dict[str, Any]] = {}
        for context in _dict_items(metadata.get("contexts")):
            if isinstance(context, dict) and isinstance(context.get("type"), str) and context["type"] in RESOURCE_TYPES:
                refs[(context["type"], str(context.get("id", "")))] = {
                    "label": context.get("label", ""),
                    "source": "implicit" if context.get("presentation") == "implicit" else "explicit",
                }
        for resolution in _dict_items(metadata.get("resume_resolutions")):
            if isinstance(resolution, dict):
                refs[("resume", str(resolution.get("resume_id", "")))] = {
                    "label": resolution.get("label_at_resolution", ""),
                    "source": resolution.get("source", "explicit"),
                }
        for resolution in _dict_items(metadata.get("resource_resolutions")):
            if isinstance(resolution.get("type"), str) and resolution["type"] in RESOURCE_TYPES:
                refs[(resolution["type"], str(resolution.get("id", "")))] = {
                    "label": resolution.get("label_at_resolution", ""),
                    "source": resolution.get("source", "memory"),
                }
        tasks = _dict_items(metadata.get("agent_tasks"))
        for task in tasks:
            if not isinstance(task, dict):
                continue
            for ref in _dict_items(task.get("resolved_refs")):
                if isinstance(ref, dict) and isinstance(ref.get("type"), str) and ref["type"] in RESOURCE_TYPES:
                    refs.setdefault((ref["type"], str(ref.get("id", ""))), {"label": "", "source": "explicit"})
        for (resource_type, resource_id), ref in refs.items():
            if not 1 <= len(resource_id) <= 20 or not resource_id.isascii() or not resource_id.isdecimal() or int(resource_id) < 1 or resource_id.startswith("0"):
                continue
            if (resource_type, resource_id) not in resources and len(resources) >= 10:
                truncated = True
                continue
            related = []
            for task in tasks:
                if not isinstance(task, dict):
                    continue
                selected = _dict_items(task.get("context_refs")) + _dict_items(task.get("resolved_refs"))
                resolution = next((item for item in _dict_items(metadata.get("resume_resolutions"))
                                   if item.get("task_id") == task.get("id")), None)
                if resource_type == "resume" and resolution and str(resolution.get("resume_id")) != resource_id:
                    continue
                frozen = next((item for item in _dict_items(metadata.get("resource_resolutions"))
                               if item.get("task_id") == task.get("id") and item.get("type") == resource_type), None)
                if frozen and str(frozen.get("id")) != resource_id:
                    continue
                if not any(isinstance(item, dict) and item.get("type") == resource_type
                           and str(item.get("id")) == resource_id for item in selected):
                    continue
                if not isinstance(task.get("id"), str) or not 1 <= len(task["id"]) <= 32:
                    continue
                if not isinstance(task.get("label"), str) or not task["label"].strip():
                    continue
                if task.get("status") not in {"planned", "running", "completed", "partial", "blocked", "failed"}:
                    continue
                related.append({"id": task["id"], "label": task["label"][:120], "status": task["status"],
                                **({"result": task["result"][:300]} if isinstance(task.get("result"), str) else {})})
            event = {
                "memory_ref": f"m:{message.sequence_no}:{resource_type}:{resource_id}",
                "source_sequence_no": message.sequence_no,
                "resource": {"type": resource_type, "id": resource_id,
                             "label": str(ref["label"])[:255]},
                "source": ref["source"] if ref["source"] in {"explicit", "implicit", "memory"} else "explicit",
                "tasks": related[:8],
            }
            if len(json.dumps({"schema_version": 1, "events": events + [event],
                               "truncated": True}, ensure_ascii=False)) > MAX_MEMORY_CHARS:
                truncated = True
                continue
            resources.add((resource_type, resource_id))
            events.append(event)
    events.reverse()
    return {"schema_version": 1, "events": events, "truncated": truncated}


def conversation_memory(db: Session, run: AgentRun, *, before_sequence_no: int | None = None) -> dict[str, Any]:
    sequence = before_sequence_no if before_sequence_no is not None else db.scalar(select(AgentMessage.sequence_no).where(
        AgentMessage.run_id == run.id, AgentMessage.role == "user",
    ).order_by(AgentMessage.sequence_no.desc()).limit(1))
    if sequence is None:
        return {"schema_version": 1, "events": [], "truncated": False}
    messages = list(db.scalars(select(AgentMessage).where(
        AgentMessage.session_id == run.session_id,
        AgentMessage.sequence_no < sequence,
    ).order_by(AgentMessage.sequence_no.desc()).limit(41)).all())
    result = project_memory(messages)
    # We deliberately cannot resolve references outside this short-term window.
    if len(messages) == 41:
        result["truncated"] = True
    return result
