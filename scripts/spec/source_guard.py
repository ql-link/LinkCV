#!/usr/bin/env python3
"""读取 Multica 权威需求，维护需求指纹，并在确认后追加结构化变更评论。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from flow_guard import (
    SOURCE_GATE_BY_PHASE,
    SOURCE_GATES,
    artifact_state,
    digest,
    empty_quality_review_state,
    empty_source_reconciliation_state,
    empty_verification_state,
    feature_dir,
    load_state,
    now,
    save_state,
    validate_schema,
)

COMMENT_HEADING = "## LinkCV 已确认需求变更"
COMMENT_FENCE = "linkcv-requirement-change"
COMMENT_PATTERN = re.compile(
    rf"\n```{re.escape(COMMENT_FENCE)}\n(?P<metadata>\{{.*\}})\n```\s*$",
    re.DOTALL,
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def fail(message: str, code: int = 1) -> int:
    print(f"ERROR {message}", file=sys.stderr)
    return code


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalized_text(value: object) -> str:
    return value if isinstance(value, str) else ""


def canonical_hash(payload: dict[str, object]) -> str:
    return sha256_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def base_issue_snapshot(payload: dict[str, Any]) -> dict[str, object]:
    issue_id = normalized_text(payload.get("id"))
    identifier = normalized_text(payload.get("identifier"))
    title = normalized_text(payload.get("title"))
    description = normalized_text(payload.get("description"))
    updated_at = normalized_text(payload.get("updated_at"))
    if not issue_id or not identifier or not updated_at:
        raise ValueError("Multica 返回缺少 id、identifier 或 updated_at")

    requirements = {
        "identifier": identifier,
        "title": title,
        "description": description,
    }
    base_hash = canonical_hash(requirements)
    return {
        "id": issue_id,
        "identifier": identifier,
        "updated_at": updated_at,
        "description_hash": sha256_text(description),
        "base_requirements_hash": base_hash,
        "requirements_hash": base_hash,
        "change_comment_ids": [],
        "active_change_comment_ids": [],
    }


def multica_command(
    arguments: list[str], *, input_text: str | None = None
) -> object:
    executable = os.environ.get("LINKCV_MULTICA_CLI", "multica")
    try:
        result = subprocess.run(
            [executable, *arguments],
            input=input_text,
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "找不到 multica CLI；需求状态未核验，不得继续当前阶段"
        ) from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "未知错误"
        raise RuntimeError(f"Multica 命令失败：{detail.splitlines()[-1]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Multica 返回的不是合法 JSON，需求状态未核验") from exc


def source_coordinates(source: dict[str, object]) -> tuple[str, str]:
    issue_id = source.get("issue_id")
    workspace_id = source.get("workspace_id")
    if not isinstance(issue_id, str) or not issue_id:
        raise ValueError("state.yaml 缺少 Multica issue_id")
    if not isinstance(workspace_id, str) or not workspace_id:
        raise ValueError(
            "state.yaml 缺少 Multica workspace_id；重新初始化或补齐准确 workspace UUID"
        )
    return issue_id, workspace_id


def comment_items(payload: object) -> list[dict[str, object]]:
    if isinstance(payload, list):
        raw_items = payload
    elif isinstance(payload, dict):
        raw_items = next(
            (
                value
                for key in ("comments", "items", "data")
                if isinstance((value := payload.get(key)), list)
            ),
            None,
        )
        if raw_items is None:
            raise RuntimeError("Multica 评论列表响应缺少 comments/items/data 数组")
    else:
        raise RuntimeError("Multica 评论列表响应顶层不是数组或对象")
    if not all(isinstance(item, dict) for item in raw_items):
        raise RuntimeError("Multica 评论列表含有非对象条目")
    return raw_items


def is_root_comment(comment: dict[str, object]) -> bool:
    for field in ("parent_id", "parentId", "parent"):
        if comment.get(field):
            return False
    return True


def parse_structured_comment(comment: dict[str, object]) -> dict[str, object] | None:
    content = normalized_text(comment.get("content"))
    has_marker = COMMENT_FENCE in content or content.startswith(COMMENT_HEADING)
    if not has_marker:
        return None
    if not is_root_comment(comment):
        raise RuntimeError("结构化需求变更必须是顶层评论，不能放在回复线程中")

    match = COMMENT_PATTERN.search(content)
    if match is None:
        raise RuntimeError("发现格式损坏的 LinkCV 结构化需求变更评论")
    business_content = content[: match.start()].strip()
    if not business_content.startswith(COMMENT_HEADING):
        raise RuntimeError("结构化需求变更评论缺少固定标题")
    business_body = business_content[len(COMMENT_HEADING) :].strip()
    if not business_body:
        raise RuntimeError("结构化需求变更评论缺少业务变更内容")

    try:
        metadata = json.loads(match.group("metadata"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("结构化需求变更评论的工具元数据不是合法 JSON") from exc
    if not isinstance(metadata, dict) or metadata.get("schema_version") != 1:
        raise RuntimeError("结构化需求变更评论的 schema_version 必须为 1")
    if metadata.get("producer") != "linkcv-source-guard":
        raise RuntimeError("结构化需求变更评论缺少受支持的 producer")

    comment_id = normalized_text(comment.get("id"))
    created_at = normalized_text(comment.get("created_at")) or normalized_text(
        comment.get("createdAt")
    )
    change_id = normalized_text(metadata.get("change_id"))
    base_hash = normalized_text(metadata.get("base_requirements_sha256"))
    confirmed_at = normalized_text(metadata.get("confirmed_at"))
    supersedes = metadata.get("supersedes", [])
    if not comment_id or not created_at:
        raise RuntimeError("结构化需求变更评论缺少 id 或 created_at")
    try:
        uuid.UUID(change_id)
    except (ValueError, AttributeError) as exc:
        raise RuntimeError("结构化需求变更评论的 change_id 无效") from exc
    if not SHA256_RE.fullmatch(base_hash):
        raise RuntimeError("结构化需求变更评论的原需求指纹无效")
    if not confirmed_at:
        raise RuntimeError("结构化需求变更评论缺少 confirmed_at")
    if not isinstance(supersedes, list) or not all(
        isinstance(value, str) and value for value in supersedes
    ):
        raise RuntimeError("结构化需求变更评论的 supersedes 必须是评论 ID 列表")
    if len(supersedes) != len(set(supersedes)):
        raise RuntimeError("结构化需求变更评论的 supersedes 含重复评论 ID")

    return {
        "comment_id": comment_id,
        "created_at": created_at,
        "change_id": change_id,
        "base_requirements_hash": base_hash,
        "confirmed_at": confirmed_at,
        "supersedes": supersedes,
        "business_content_hash": sha256_text(business_content),
    }


def apply_change_comments(
    snapshot: dict[str, object], comments_payload: object
) -> dict[str, object]:
    parsed: list[dict[str, object]] = []
    for comment in comment_items(comments_payload):
        value = parse_structured_comment(comment)
        if value is not None:
            parsed.append(value)
    parsed.sort(key=lambda value: (str(value["created_at"]), str(value["comment_id"])))
    seen_ids: list[str] = []
    active_ids: list[str] = []
    comment_ids = [str(value["comment_id"]) for value in parsed]
    change_ids = [str(value["change_id"]) for value in parsed]
    if len(comment_ids) != len(set(comment_ids)) or len(change_ids) != len(
        set(change_ids)
    ):
        raise RuntimeError("结构化需求变更评论含重复的评论 ID 或 change_id")

    canonical_changes: list[dict[str, object]] = []
    for change in parsed:
        comment_id = str(change["comment_id"])
        change_id = str(change["change_id"])
        supersedes = [str(value) for value in change["supersedes"]]
        invalid_supersedes = [value for value in supersedes if value not in active_ids]
        if invalid_supersedes:
            raise RuntimeError(
                f"结构化需求变更评论 {comment_id} 替代了未知或已失效评论："
                f"{', '.join(invalid_supersedes)}"
            )
        active_ids = [value for value in active_ids if value not in supersedes]
        active_ids.append(comment_id)
        canonical_changes.append(
            {
                "comment_id": comment_id,
                "change_id": change_id,
                "created_at": change["created_at"],
                "confirmed_at": change["confirmed_at"],
                "base_requirements_hash": change["base_requirements_hash"],
                "business_content_hash": change["business_content_hash"],
                "supersedes": supersedes,
            }
        )
        seen_ids.append(comment_id)

    if canonical_changes:
        snapshot["requirements_hash"] = canonical_hash(
            {
                "issue_requirements_hash": snapshot["base_requirements_hash"],
                "structured_changes": canonical_changes,
            }
        )
    snapshot["change_comment_ids"] = seen_ids
    snapshot["active_change_comment_ids"] = active_ids
    snapshot["structured_changes"] = canonical_changes
    return snapshot


def fetch_multica_issue(source: dict[str, object]) -> dict[str, object]:
    issue_id, workspace_id = source_coordinates(source)
    issue_payload = multica_command(
        [
            "issue",
            "get",
            issue_id,
            "--workspace-id",
            workspace_id,
            "--output",
            "json",
        ]
    )
    if not isinstance(issue_payload, dict):
        raise RuntimeError("Multica Issue 响应顶层不是对象，需求状态未核验")
    comments_payload = multica_command(
        [
            "issue",
            "comment",
            "list",
            issue_id,
            "--workspace-id",
            workspace_id,
            "--roots-only",
            "--full",
            "--output",
            "json",
        ]
    )
    return apply_change_comments(base_issue_snapshot(issue_payload), comments_payload)


def source_state(state: dict[str, object]) -> dict[str, object]:
    source = state.get("source")
    if not isinstance(source, dict) or source.get("system") != "multica":
        raise ValueError("当前 Spec 不是 Multica 来源，不需要运行需求漂移门禁")
    return source


def reconciliation_state(source: dict[str, object]) -> dict[str, object]:
    reconciliation = source.get("reconciliation")
    if not isinstance(reconciliation, dict):
        reconciliation = empty_source_reconciliation_state()
        source["reconciliation"] = reconciliation
    return reconciliation


def reset_reconciliation(source: dict[str, object]) -> None:
    source["reconciliation"] = empty_source_reconciliation_state()


def validate_gate_for_state(
    state: dict[str, object], gate: str, command: str
) -> None:
    phase = state.get("phase")
    if command in {"capture", "accept", "reconcile", "sync-comment"}:
        if gate != "brief" or phase != "brief":
            raise ValueError(f"{command} 只允许在 phase=brief 时使用 --gate brief")
        return
    allowed = {
        "brief": {"brief"},
        "acceptance": {"acceptance"},
        "technical_design": {"technical_design"},
        "implementation": {"implementation", "verification"},
        "quality_review": {"verification"},
        "release_ready": {"verification", "release"},
    }.get(str(phase), set())
    if gate not in allowed:
        expected = SOURCE_GATE_BY_PHASE.get(str(phase), "未知")
        raise ValueError(
            f"当前 phase={phase} 不能核验 gate={gate}；先运行 `npm run spec -- status`，"
            f"当前阶段通常需要 gate={expected}"
        )


def verify_identity(source: dict[str, object], snapshot: dict[str, object]) -> None:
    configured = source.get("issue_id")
    if configured not in {snapshot["id"], snapshot["identifier"]}:
        raise ValueError(
            f"Multica 返回对象与 state.yaml 不一致：期望 {configured}，"
            f"实际 {snapshot['identifier']}"
        )


def drift_state(source: dict[str, object]) -> dict[str, object]:
    drift = source.get("drift")
    if not isinstance(drift, dict):
        drift = {}
        source["drift"] = drift
    return drift


def clear_drift(source: dict[str, object]) -> None:
    source["drift"] = {
        "detected": False,
        "detected_at": None,
        "previous_requirements_hash": None,
        "observed_requirements_hash": None,
        "observed_updated_at": None,
    }


def record_baseline(
    source: dict[str, object], snapshot: dict[str, object], gate: str
) -> None:
    comment_ids = [str(value) for value in snapshot["change_comment_ids"]]
    source["fingerprint_version"] = 2 if comment_ids else 1
    source["issue_id"] = snapshot["id"]
    source["issue_key"] = snapshot["identifier"]
    source["updated_at"] = snapshot["updated_at"]
    source["description_hash"] = snapshot["description_hash"]
    source["base_requirements_hash"] = snapshot["base_requirements_hash"]
    source["requirements_hash"] = snapshot["requirements_hash"]
    source["change_comment_ids"] = comment_ids
    source["active_change_comment_ids"] = [
        str(value) for value in snapshot["active_change_comment_ids"]
    ]
    source["checked_at"] = now()
    source["checked_for"] = gate
    clear_drift(source)


def invalidate_for_drift(
    state: dict[str, object], source: dict[str, object], snapshot: dict[str, object]
) -> None:
    previous_hash = source.get("requirements_hash")
    for name in ("brief", "acceptance", "technical_design"):
        item = artifact_state(state, name)
        item["frozen"] = False
        item["sha256"] = None
    state["phase"] = "brief"
    state["verification"] = empty_verification_state()
    state["quality_review"] = empty_quality_review_state()
    source["checked_for"] = None
    source["checked_at"] = now()
    reset_reconciliation(source)
    source["drift"] = {
        "detected": True,
        "detected_at": now(),
        "previous_requirements_hash": previous_hash,
        "observed_requirements_hash": snapshot["requirements_hash"],
        "observed_updated_at": snapshot["updated_at"],
    }


def require_matching_snapshot(
    key: str,
    state: dict[str, object],
    source: dict[str, object],
) -> dict[str, object]:
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    if snapshot["requirements_hash"] != source.get("requirements_hash"):
        invalidate_for_drift(state, source, snapshot)
        save_state(key, state)
        raise RuntimeError(
            "Multica 权威需求已变化；本地冻结状态已失效。重新读取需求并明确接受新基线"
        )
    return snapshot


def require_brief(key: str) -> Path:
    path = feature_dir(key) / "brief.md"
    if not path.is_file():
        raise FileNotFoundError(f"未找到 {path}；先生成并确认 Brief")
    return path


def cmd_capture(args: argparse.Namespace) -> int:
    state = load_state(args.key)
    validate_gate_for_state(state, args.gate, "capture")
    source = source_state(state)
    if source.get("requirements_hash"):
        return fail("需求基线已经存在；日常核验使用 check，确认漂移使用 accept", 2)
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    record_baseline(source, snapshot, args.gate)
    reset_reconciliation(source)
    save_state(args.key, state)
    print(
        f"OK  已捕获 {snapshot['identifier']} 的权威需求基线，gate={args.gate}；"
        "未修改 Multica"
    )
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    state = load_state(args.key)
    validate_gate_for_state(state, args.gate, "check")
    errors = validate_schema(args.key, state)
    if errors:
        return fail("state.yaml 无效：" + "；".join(errors), 2)
    source = source_state(state)
    if not source.get("requirements_hash"):
        return fail(
            f"尚未捕获需求基线；运行 `npm run spec:source -- capture {args.key} "
            f"--gate {args.gate}`",
            2,
        )
    if drift_state(source).get("detected"):
        return fail(
            "已有未确认的需求漂移；重新读取 Issue、修订 Brief 后运行 accept",
            1,
        )

    source["checked_for"] = None
    save_state(args.key, state)
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    if snapshot["requirements_hash"] != source.get("requirements_hash"):
        invalidate_for_drift(state, source, snapshot)
        save_state(args.key, state)
        return fail(
            f"检测到 {snapshot['identifier']} 权威需求漂移（正文或结构化变更评论变化）；"
            "Brief 及下游冻结状态已失效。重新读取需求、修订 Brief，再明确接受新基线",
            1,
        )

    metadata_changed = snapshot["updated_at"] != source.get("updated_at")
    source["updated_at"] = snapshot["updated_at"]
    source["description_hash"] = snapshot["description_hash"]
    source["base_requirements_hash"] = snapshot["base_requirements_hash"]
    source["change_comment_ids"] = [
        str(value) for value in snapshot["change_comment_ids"]
    ]
    source["active_change_comment_ids"] = [
        str(value) for value in snapshot["active_change_comment_ids"]
    ]
    source["checked_at"] = now()
    source["checked_for"] = args.gate
    save_state(args.key, state)
    suffix = "；Issue 元数据变化但权威需求未漂移" if metadata_changed else ""
    print(
        f"OK  {snapshot['identifier']} 权威需求未漂移，gate={args.gate}{suffix}；"
        "未修改 Multica"
    )
    return 0


def cmd_accept(args: argparse.Namespace) -> int:
    state = load_state(args.key)
    validate_gate_for_state(state, args.gate, "accept")
    source = source_state(state)
    if not drift_state(source).get("detected"):
        return fail("当前没有待确认的需求漂移；无需 accept", 2)
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    record_baseline(source, snapshot, args.gate)
    reset_reconciliation(source)
    save_state(args.key, state)
    print(
        f"OK  已接受 {snapshot['identifier']} 当前权威需求为新基线，gate={args.gate}；"
        "Brief 仍需修订、对账并重新冻结，未修改 Multica"
    )
    return 0


def cmd_reconcile(args: argparse.Namespace) -> int:
    state = load_state(args.key)
    validate_gate_for_state(state, args.gate, "reconcile")
    source = source_state(state)
    if reconciliation_state(source).get("status") == "syncing":
        return fail(
            f"已有未确认的评论写入；先运行 "
            f"`npm run spec:source -- recover-comment {args.key}`",
            1,
        )
    if not source.get("requirements_hash"):
        return fail("尚未捕获 Multica 权威需求基线", 2)
    if drift_state(source).get("detected"):
        return fail("已有未确认的需求漂移；先修订 Brief 并 accept", 1)
    if source.get("checked_for") != "brief":
        return fail(
            f"对账前先运行 `npm run spec:source -- check {args.key} --gate brief`",
            1,
        )
    brief_path = require_brief(args.key)
    snapshot = require_matching_snapshot(args.key, state, source)
    reconciliation = reconciliation_state(source)
    reconciliation.update(
        {
            "status": "clean",
            "brief_sha256": digest(brief_path),
            "requirements_hash": snapshot["requirements_hash"],
            "comment_ids": [],
            "reconciled_at": now(),
            "write_intent": None,
        }
    )
    save_state(args.key, state)
    print(
        f"OK  {snapshot['identifier']} 与当前 Brief 已对账：无须回写需求变更；"
        "未修改 Multica"
    )
    return 0


def build_change_comment(
    business_content: str,
    base_requirements_hash: str,
    supersedes: list[str],
    change_id: str,
    confirmed_at: str,
) -> str:
    metadata = {
        "schema_version": 1,
        "producer": "linkcv-source-guard",
        "change_id": change_id,
        "base_requirements_sha256": base_requirements_hash,
        "supersedes": supersedes,
        "confirmed_at": confirmed_at,
    }
    return (
        f"{render_comment_body(business_content)}\n\n"
        f"```{COMMENT_FENCE}\n"
        f"{json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}\n"
        "```"
    )


def render_comment_body(business_content: str) -> str:
    blocks = re.split(r"\n\s*\n", business_content.strip(), maxsplit=1)
    summary = blocks[0].strip()
    details = blocks[1].strip() if len(blocks) == 2 else ""
    sections = [COMMENT_HEADING, "### 概述", summary]
    if details:
        sections.extend(("### 具体变化", details))
    sections.extend(
        (
            "### 工具记录",
            "以下信息仅用于需求追踪，开发者和审核员无需填写或维护。",
        )
    )
    return "\n\n".join(sections)


def load_change_content(key: str, raw_path: str) -> str:
    path = Path(raw_path).resolve()
    spec_directory = feature_dir(key).resolve()
    try:
        path.relative_to(spec_directory)
    except ValueError as exc:
        raise ValueError("--change-file 必须位于当前 .specs/<KEY>/ 目录内") from exc
    if not path.is_file():
        raise FileNotFoundError(f"需求变更内容文件不存在: {path}")
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise ValueError("需求变更内容不能为空")
    if COMMENT_FENCE in content or content.startswith(COMMENT_HEADING):
        raise ValueError("需求变更内容只能写业务差异，工具元数据由 source_guard 自动生成")
    if "@" in content:
        raise ValueError("需求变更评论不得包含 @ 提及，以免触发无关 Agent")
    return content


def added_comment_id(payload: object) -> str:
    if isinstance(payload, dict):
        value = payload.get("id")
        if isinstance(value, str) and value:
            return value
        data = payload.get("data")
        if isinstance(data, dict) and isinstance(data.get("id"), str) and data["id"]:
            return str(data["id"])
    raise RuntimeError("Multica 已返回评论写入结果，但响应中缺少评论 ID；请人工核查 Issue")


def business_comment_hash(business_content: str) -> str:
    return sha256_text(render_comment_body(business_content))


def resolve_supersedes(
    snapshot: dict[str, object], *, correct_latest: bool
) -> list[str]:
    if not correct_latest:
        return []
    active_ids = [str(value) for value in snapshot["active_change_comment_ids"]]
    if not active_ids:
        raise ValueError("--correct-latest 需要至少一条当前有效的结构化需求变更评论")
    return [active_ids[-1]]


def write_intent_state(source: dict[str, object]) -> dict[str, object]:
    reconciliation = reconciliation_state(source)
    intent = reconciliation.get("write_intent")
    if reconciliation.get("status") != "syncing" or not isinstance(intent, dict):
        raise ValueError("当前没有待恢复的结构化评论写入")
    return intent


def change_for_intent(
    snapshot: dict[str, object], intent: dict[str, object]
) -> dict[str, object] | None:
    changes = snapshot.get("structured_changes")
    if not isinstance(changes, list):
        return None
    return next(
        (
            change
            for change in changes
            if isinstance(change, dict)
            and change.get("change_id") == intent.get("change_id")
        ),
        None,
    )


def finalize_comment_sync(
    key: str,
    state: dict[str, object],
    source: dict[str, object],
    snapshot: dict[str, object],
    intent: dict[str, object],
) -> str:
    change = change_for_intent(snapshot, intent)
    if change is None:
        raise RuntimeError("待恢复的结构化评论尚未出现在 Multica；禁止自动重复写入")
    for field in (
        "base_requirements_hash",
        "business_content_hash",
        "supersedes",
    ):
        if change.get(field) != intent.get(field):
            raise RuntimeError(
                f"Multica 中相同 change_id 的 {field} 与本地写入意图不一致"
            )
    comment_id = normalized_text(change.get("comment_id"))
    if not comment_id:
        raise RuntimeError("已恢复的结构化评论缺少评论 ID")

    previous_ids = intent.get("previous_comment_ids")
    observed_ids = snapshot.get("change_comment_ids")
    expected_ids = [*(previous_ids if isinstance(previous_ids, list) else []), comment_id]
    if (
        snapshot.get("base_requirements_hash")
        != intent.get("issue_requirements_hash")
        or observed_ids != expected_ids
    ):
        invalidate_for_drift(state, source, snapshot)
        save_state(key, state)
        raise RuntimeError(
            "评论写入期间 Multica 还发生了其他权威需求变化；评论已保留，"
            "本地规格已按需求漂移退回 Brief"
        )

    record_baseline(source, snapshot, "brief")
    reconciliation = reconciliation_state(source)
    reconciliation.update(
        {
            "status": "synced",
            "brief_sha256": intent.get("brief_sha256"),
            "requirements_hash": snapshot["requirements_hash"],
            "comment_ids": [comment_id],
            "reconciled_at": now(),
            "write_intent": None,
        }
    )
    save_state(key, state)
    return comment_id


def cmd_sync_comment(args: argparse.Namespace) -> int:
    if not args.confirmed_by_user:
        return fail("缺少 --confirmed-by-user；未经用户明确确认不得写入 Multica", 2)
    state = load_state(args.key)
    validate_gate_for_state(state, args.gate, "sync-comment")
    errors = validate_schema(args.key, state)
    if errors:
        return fail("state.yaml 无效：" + "；".join(errors), 2)
    source = source_state(state)
    reconciliation = reconciliation_state(source)
    if reconciliation.get("status") == "syncing":
        return fail(
            f"已有未确认的评论写入，禁止重复追加；运行 "
            f"`npm run spec:source -- recover-comment {args.key}`",
            1,
        )
    if not source.get("requirements_hash"):
        return fail("尚未捕获 Multica 权威需求基线", 2)
    if drift_state(source).get("detected"):
        return fail("已有未确认的需求漂移；写评论前先处理漂移", 1)
    if source.get("checked_for") != "brief":
        return fail(
            f"回写前先运行 `npm run spec:source -- check {args.key} --gate brief`",
            1,
        )

    brief_path = require_brief(args.key)
    business_content = load_change_content(args.key, args.change_file)
    snapshot = require_matching_snapshot(args.key, state, source)
    supersedes = resolve_supersedes(
        snapshot,
        correct_latest=args.correct_latest,
    )
    change_id = str(uuid.uuid4())
    confirmed_at = now()
    intent: dict[str, object] = {
        "change_id": change_id,
        "base_requirements_hash": str(snapshot["requirements_hash"]),
        "issue_requirements_hash": snapshot["base_requirements_hash"],
        "business_content_hash": business_comment_hash(business_content),
        "supersedes": supersedes,
        "previous_comment_ids": [
            str(value) for value in snapshot["change_comment_ids"]
        ],
        "brief_sha256": digest(brief_path),
        "prepared_at": confirmed_at,
        "comment_id": None,
    }
    comment = build_change_comment(
        business_content,
        str(snapshot["requirements_hash"]),
        supersedes,
        change_id,
        confirmed_at,
    )
    reconciliation.update(
        {
            "status": "syncing",
            "brief_sha256": intent["brief_sha256"],
            "requirements_hash": snapshot["requirements_hash"],
            "comment_ids": [],
            "reconciled_at": None,
            "write_intent": intent,
        }
    )
    save_state(args.key, state)
    issue_id, workspace_id = source_coordinates(source)
    try:
        response = multica_command(
            [
                "issue",
                "comment",
                "add",
                issue_id,
                "--workspace-id",
                workspace_id,
                "--content-stdin",
                "--output",
                "json",
            ],
            input_text=comment,
        )
        comment_id = added_comment_id(response)
        intent["comment_id"] = comment_id
        save_state(args.key, state)
    except RuntimeError as exc:
        raise RuntimeError(
            "结构化需求变更评论写入结果不确定，已保留写入意图并禁止自动重试："
            f"{exc}"
        ) from exc

    try:
        updated_snapshot = fetch_multica_issue(source)
        verify_identity(source, updated_snapshot)
    except RuntimeError as exc:
        raise RuntimeError(
            "评论写入后无法重新核验 Multica；评论可能已成功，请先人工核查 Issue 再重试"
        ) from exc
    if comment_id not in updated_snapshot["change_comment_ids"]:
        raise RuntimeError(
            "评论写入响应已成功，但权威需求链未发现新评论；请人工核查 Issue"
        )
    if updated_snapshot["requirements_hash"] == snapshot["requirements_hash"]:
        raise RuntimeError("评论写入后权威需求指纹未变化；请人工核查 Issue")

    finalize_comment_sync(args.key, state, source, updated_snapshot, intent)
    print(
        f"OK  已向 {updated_snapshot['identifier']} 追加并核验 1 条结构化需求变更评论；"
        "指纹、变更 ID、评论 ID 与替代关系均由工具维护"
    )
    return 0


def cmd_recover_comment(args: argparse.Namespace) -> int:
    state = load_state(args.key)
    validate_gate_for_state(state, "brief", "sync-comment")
    source = source_state(state)
    intent = write_intent_state(source)
    brief_path = require_brief(args.key)
    if intent.get("brief_sha256") != digest(brief_path):
        return fail("Brief 在评论写入恢复前发生变化；先恢复原内容并完成核验", 1)
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    comment_id = finalize_comment_sync(args.key, state, source, snapshot, intent)
    print(
        f"OK  已恢复并核验结构化需求变更评论 {comment_id}；未重复写入 Multica"
    )
    return 0


def cmd_abandon_sync(args: argparse.Namespace) -> int:
    if not args.confirmed_comment_absent:
        return fail(
            "缺少 --confirmed-comment-absent；未确认评论不存在前不得放弃写入意图",
            2,
        )
    state = load_state(args.key)
    validate_gate_for_state(state, "brief", "sync-comment")
    source = source_state(state)
    intent = write_intent_state(source)
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    if change_for_intent(snapshot, intent) is not None:
        return fail(
            f"评论实际已经存在；运行 `npm run spec:source -- recover-comment {args.key}`",
            1,
        )
    if snapshot["requirements_hash"] != source.get("requirements_hash"):
        invalidate_for_drift(state, source, snapshot)
        save_state(args.key, state)
        return fail("放弃写入期间 Multica 权威需求已变化；已按需求漂移处理", 1)
    reset_reconciliation(source)
    save_state(args.key, state)
    print("OK  已确认 Multica 中不存在待写评论并清除写入意图；未修改 Multica")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command, handler in (
        ("capture", cmd_capture),
        ("check", cmd_check),
        ("accept", cmd_accept),
    ):
        child = subparsers.add_parser(command)
        child.add_argument("key")
        child.add_argument("--gate", choices=SOURCE_GATES, required=True)
        child.set_defaults(handler=handler)

    reconcile = subparsers.add_parser("reconcile")
    reconcile.add_argument("key")
    reconcile.add_argument("--gate", choices=("brief",), default="brief")
    reconcile.add_argument("--no-change", action="store_true", required=True)
    reconcile.set_defaults(handler=cmd_reconcile)

    sync = subparsers.add_parser("sync-comment")
    sync.add_argument("key")
    sync.add_argument("--gate", choices=("brief",), default="brief")
    sync.add_argument("--change-file", required=True)
    sync.add_argument("--confirmed-by-user", action="store_true")
    sync.add_argument(
        "--correct-latest",
        action="store_true",
        help="当前评论纠正最近一条有效变更；工具自动解析并记录替代关系",
    )
    sync.set_defaults(handler=cmd_sync_comment)

    recover = subparsers.add_parser("recover-comment")
    recover.add_argument("key")
    recover.set_defaults(handler=cmd_recover_comment)

    abandon = subparsers.add_parser("abandon-sync")
    abandon.add_argument("key")
    abandon.add_argument("--confirmed-comment-absent", action="store_true")
    abandon.set_defaults(handler=cmd_abandon_sync)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.handler(args)
    except (FileNotFoundError, ValueError) as exc:
        return fail(str(exc), 2)
    except RuntimeError as exc:
        return fail(str(exc), 2)


if __name__ == "__main__":
    raise SystemExit(main())
