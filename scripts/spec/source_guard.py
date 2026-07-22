#!/usr/bin/env python3
"""读取 Multica Issue，维护本地需求指纹并阻断需求漂移。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from typing import Any

from flow_guard import (
    SOURCE_GATE_BY_PHASE,
    SOURCE_GATES,
    artifact_state,
    load_state,
    now,
    save_state,
    validate_schema,
)


def fail(message: str, code: int = 1) -> int:
    print(f"ERROR {message}", file=sys.stderr)
    return code


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalized_text(value: object) -> str:
    return value if isinstance(value, str) else ""


def issue_snapshot(payload: dict[str, Any]) -> dict[str, str]:
    issue_id = normalized_text(payload.get("id"))
    identifier = normalized_text(payload.get("identifier"))
    title = normalized_text(payload.get("title"))
    description = normalized_text(payload.get("description"))
    updated_at = normalized_text(payload.get("updated_at"))
    if not issue_id or not identifier or not updated_at:
        raise ValueError("Multica 返回缺少 id、identifier 或 updated_at")

    requirements = json.dumps(
        {
            "identifier": identifier,
            "title": title,
            "description": description,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "id": issue_id,
        "identifier": identifier,
        "updated_at": updated_at,
        "description_hash": sha256_text(description),
        "requirements_hash": sha256_text(requirements),
    }


def fetch_multica_issue(source: dict[str, object]) -> dict[str, str]:
    issue_id = source.get("issue_id")
    workspace_id = source.get("workspace_id")
    if not isinstance(issue_id, str) or not issue_id:
        raise ValueError("state.yaml 缺少 Multica issue_id")
    if not isinstance(workspace_id, str) or not workspace_id:
        raise ValueError(
            "state.yaml 缺少 Multica workspace_id；重新初始化或补齐准确 workspace UUID"
        )

    executable = os.environ.get("LINKCV_MULTICA_CLI", "multica")
    try:
        result = subprocess.run(
            [
                executable,
                "issue",
                "get",
                issue_id,
                "--workspace-id",
                workspace_id,
                "--output",
                "json",
            ],
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
        raise RuntimeError(
            f"Multica 只读查询失败，需求状态未核验：{detail.splitlines()[-1]}"
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Multica 返回的不是合法 JSON，需求状态未核验") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Multica Issue 响应顶层不是对象，需求状态未核验")
    return issue_snapshot(payload)


def source_state(state: dict[str, object]) -> dict[str, object]:
    source = state.get("source")
    if not isinstance(source, dict) or source.get("system") != "multica":
        raise ValueError("当前 Spec 不是 Multica 来源，不需要运行需求漂移门禁")
    return source


def validate_gate_for_state(
    state: dict[str, object], gate: str, command: str
) -> None:
    phase = state.get("phase")
    if command in {"capture", "accept"}:
        if gate != "brief" or phase != "brief":
            raise ValueError(f"{command} 只允许在 phase=brief 时使用 --gate brief")
        return
    allowed = {
        "brief": {"brief"},
        "acceptance": {"acceptance"},
        "technical_design": {"technical_design"},
        "implementation": {"implementation", "verification"},
        "done": {"release"},
    }.get(str(phase), set())
    if gate not in allowed:
        expected = SOURCE_GATE_BY_PHASE.get(str(phase), "未知")
        raise ValueError(
            f"当前 phase={phase} 不能核验 gate={gate}；先运行 `npm run spec -- status`，"
            f"当前阶段通常需要 gate={expected}"
        )


def verify_identity(source: dict[str, object], snapshot: dict[str, str]) -> None:
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
    source: dict[str, object], snapshot: dict[str, str], gate: str
) -> None:
    source["fingerprint_version"] = 1
    source["issue_id"] = snapshot["id"]
    source["issue_key"] = snapshot["identifier"]
    source["updated_at"] = snapshot["updated_at"]
    source["description_hash"] = snapshot["description_hash"]
    source["requirements_hash"] = snapshot["requirements_hash"]
    source["checked_at"] = now()
    source["checked_for"] = gate
    clear_drift(source)


def invalidate_for_drift(
    state: dict[str, object], source: dict[str, object], snapshot: dict[str, str]
) -> None:
    previous_hash = source.get("requirements_hash")
    for name in ("brief", "acceptance", "technical_design"):
        item = artifact_state(state, name)
        item["frozen"] = False
        item["sha256"] = None
    state["phase"] = "brief"
    state["verification"] = {
        "verified": False,
        "evidence": [],
        "verified_at": None,
    }
    source["checked_for"] = None
    source["checked_at"] = now()
    source["drift"] = {
        "detected": True,
        "detected_at": now(),
        "previous_requirements_hash": previous_hash,
        "observed_requirements_hash": snapshot["requirements_hash"],
        "observed_updated_at": snapshot["updated_at"],
    }


def cmd_capture(args: argparse.Namespace) -> int:
    state = load_state(args.key)
    validate_gate_for_state(state, args.gate, "capture")
    source = source_state(state)
    if source.get("requirements_hash"):
        return fail("需求基线已经存在；日常核验使用 check，确认漂移使用 accept", 2)
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    record_baseline(source, snapshot, args.gate)
    save_state(args.key, state)
    print(
        f"OK  已捕获 {snapshot['identifier']} 的需求基线，gate={args.gate}；"
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

    # 一旦发起新核验，旧 gate 立即失效。这样网络或认证失败后，阶段门禁不会
    # 继续消费上一次成功留下的陈旧检查点。
    source["checked_for"] = None
    save_state(args.key, state)
    snapshot = fetch_multica_issue(source)
    verify_identity(source, snapshot)
    if snapshot["requirements_hash"] != source.get("requirements_hash"):
        invalidate_for_drift(state, source, snapshot)
        save_state(args.key, state)
        return fail(
            f"检测到 {snapshot['identifier']} 需求漂移（标题或描述变化）；Brief 及下游冻结状态"
            "已失效。重新读取 Issue、修订 Brief，再明确接受新基线",
            1,
        )

    metadata_changed = snapshot["updated_at"] != source.get("updated_at")
    source["updated_at"] = snapshot["updated_at"]
    source["description_hash"] = snapshot["description_hash"]
    source["checked_at"] = now()
    source["checked_for"] = args.gate
    save_state(args.key, state)
    suffix = "；Issue 元数据变化但需求正文未漂移" if metadata_changed else ""
    print(
        f"OK  {snapshot['identifier']} 需求未漂移，gate={args.gate}{suffix}；"
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
    save_state(args.key, state)
    print(
        f"OK  已接受 {snapshot['identifier']} 当前需求为新基线，gate={args.gate}；"
        "Brief 仍需修订、确认并重新冻结，未修改 Multica"
    )
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
