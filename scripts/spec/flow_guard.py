#!/usr/bin/env python3
"""管理 L2/L3 本地规格状态和冻结产物哈希。"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SPECS_ROOT = Path(os.environ.get("LINKCV_SPECS_ROOT", REPO_ROOT / ".specs")).resolve()
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
ARTIFACT_FILES = {
    "brief": "brief.md",
    "acceptance": "acceptance.feature",
    "technical_design": "technical_design.md",
}
PHASES = ("brief", "acceptance", "technical_design", "implementation", "done")
SOURCE_SYSTEMS = ("manual", "multica", "github")


def fail(message: str, code: int = 1) -> int:
    print(f"ERROR {message}", file=sys.stderr)
    return code


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def validate_key(key: str) -> str:
    if not KEY_RE.fullmatch(key) or ".." in key:
        raise ValueError("Issue key 只能包含字母、数字、下划线和连字符")
    return key.upper()


def feature_dir(key: str) -> Path:
    return SPECS_ROOT / validate_key(key)


def state_path(key: str) -> Path:
    return feature_dir(key) / "state.yaml"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def load_state(key: str) -> dict[str, object]:
    path = state_path(key)
    if not path.is_file():
        raise FileNotFoundError(f"未找到 {display_path(path)}；先运行 spec init")
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("state.yaml 顶层必须是映射")
    return value


def save_state(key: str, state: dict[str, object]) -> None:
    state["updated_at"] = now()
    state_path(key).write_text(
        yaml.safe_dump(state, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )


def artifact_state(state: dict[str, object], name: str) -> dict[str, object]:
    artifacts = state.get("artifacts")
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get(name), dict):
        raise ValueError(f"state.yaml 缺少 artifacts.{name}")
    return artifacts[name]


def validate_schema(key: str, state: dict[str, object]) -> list[str]:
    errors: list[str] = []
    if state.get("key") != validate_key(key):
        errors.append("state.key 与目录名不一致")
    if state.get("lane") not in {"L2", "L3"}:
        errors.append("lane 必须是 L2 或 L3")
    if state.get("phase") not in PHASES:
        errors.append("phase 非法")
    source = state.get("source")
    if not isinstance(source, dict):
        errors.append("source 必须是映射")
    elif source.get("system") not in SOURCE_SYSTEMS:
        errors.append(f"source.system 必须是 {', '.join(SOURCE_SYSTEMS)} 之一")
    for name in ARTIFACT_FILES:
        try:
            item = artifact_state(state, name)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if not isinstance(item.get("frozen"), bool):
            errors.append(f"artifacts.{name}.frozen 必须是布尔值")
        if item.get("sha256") is not None and not isinstance(item.get("sha256"), str):
            errors.append(f"artifacts.{name}.sha256 必须是字符串或 null")
    verification = state.get("verification")
    if not isinstance(verification, dict) or not isinstance(verification.get("verified"), bool):
        errors.append("verification.verified 必须是布尔值")
    return errors


def validate_frozen_artifact(key: str, state: dict[str, object], name: str) -> list[str]:
    item = artifact_state(state, name)
    path = feature_dir(key) / ARTIFACT_FILES[name]
    if not item.get("frozen"):
        return [f"{name} 尚未冻结"]
    if not path.is_file():
        return [f"冻结产物缺失: {display_path(path)}"]
    if item.get("sha256") != digest(path):
        return [f"{name} 冻结后已变化；确认内容后使用 freeze --refreeze"]
    return []


def required_artifacts(state: dict[str, object], phase: str) -> list[str]:
    if phase == "brief":
        return []
    if phase == "acceptance":
        return ["brief"]
    if phase == "technical_design":
        return ["brief", "acceptance"]
    if phase in {"implementation", "done"}:
        names = ["brief", "acceptance"]
        if state.get("lane") == "L3":
            names.append("technical_design")
        return names
    raise ValueError(f"未知阶段: {phase}")


def check_phase(key: str, state: dict[str, object], phase: str) -> list[str]:
    errors = validate_schema(key, state)
    if errors:
        return errors
    for name in required_artifacts(state, phase):
        errors.extend(validate_frozen_artifact(key, state, name))
    if phase == "done" and not state["verification"].get("verified"):
        errors.append("实现尚未记录验证证据")
    return errors


def cmd_init(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    if args.source_system != "manual" and not args.issue_id:
        return fail(f"来源为 {args.source_system} 时必须提供 --issue-id", 2)
    directory = feature_dir(key)
    path = state_path(key)
    if path.exists():
        return fail(f"拒绝覆盖已有 {display_path(path)}")
    directory.mkdir(parents=True, exist_ok=True)
    state: dict[str, object] = {
        "key": key,
        "title": args.title or "",
        "source": {
            "system": args.source_system,
            "issue_id": args.issue_id,
            "updated_at": args.issue_updated_at,
            "description_hash": args.description_hash,
        },
        "lane": args.lane,
        "phase": "brief",
        "artifacts": {
            name: {"file": filename, "frozen": False, "sha256": None}
            for name, filename in ARTIFACT_FILES.items()
        },
        "verification": {"verified": False, "evidence": [], "verified_at": None},
        "created_at": now(),
        "updated_at": now(),
    }
    save_state(key, state)
    print(f"OK  已初始化 .specs/{key} ({args.lane})")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    keys = (
        [validate_key(args.key)]
        if args.key
        else sorted(path.parent.name for path in SPECS_ROOT.glob("*/state.yaml"))
    )
    if not keys:
        print("OK  当前没有本地 Spec")
        return 0
    result = 0
    for key in keys:
        try:
            state = load_state(key)
        except (FileNotFoundError, ValueError, yaml.YAMLError) as exc:
            print(f"ERROR {key}: {exc}", file=sys.stderr)
            result = 1
            continue
        verified = state.get("verification", {}).get("verified")
        source = state.get("source", {}).get("system")
        print(
            f"{key}: lane={state.get('lane')} phase={state.get('phase')} "
            f"source={source} verified={verified}"
        )
    return result


def cmd_check(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    state = load_state(key)
    errors = check_phase(key, state, args.phase)
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    print(f"OK  {key} 可以进入 {args.phase}")
    return 0


def invalidate_after(state: dict[str, object], name: str) -> None:
    order = ["brief", "acceptance", "technical_design"]
    for downstream in order[order.index(name) + 1 :]:
        item = artifact_state(state, downstream)
        item["frozen"] = False
        item["sha256"] = None
    state["verification"] = {"verified": False, "evidence": [], "verified_at": None}


def cmd_freeze(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    state = load_state(key)
    name = args.artifact
    path = feature_dir(key) / ARTIFACT_FILES[name]
    if not path.is_file():
        return fail(f"产物不存在: {display_path(path)}")

    errors = [
        error
        for prerequisite in required_artifacts(state, name)
        for error in validate_frozen_artifact(key, state, prerequisite)
    ]
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1

    item = artifact_state(state, name)
    new_hash = digest(path)
    if item.get("frozen") and item.get("sha256") == new_hash:
        print(f"OK  {name} 已冻结且内容未变化")
        return 0
    if item.get("frozen") and not args.refreeze:
        return fail(f"{name} 已冻结且内容变化；确认后追加 --refreeze")
    if item.get("frozen"):
        invalidate_after(state, name)

    item["frozen"] = True
    item["sha256"] = new_hash
    if name == "brief":
        state["phase"] = "acceptance"
    elif name == "acceptance":
        state["phase"] = "technical_design" if state.get("lane") == "L3" else "implementation"
    else:
        state["phase"] = "implementation"
    save_state(key, state)
    print(f"OK  已冻结 {name}，下一阶段 {state['phase']}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    state = load_state(key)
    errors = check_phase(key, state, "implementation")
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    verification = state["verification"]
    verification["verified"] = True
    verification["evidence"] = args.evidence
    verification["verified_at"] = now()
    state["phase"] = "done"
    save_state(key, state)
    print(f"OK  已记录 {key} 的验证证据")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="初始化本地规格状态")
    init.add_argument("key", help="Issue 标识，例如 LCV-21")
    init.add_argument("--lane", choices=("L2", "L3"), required=True, help="交付车道")
    init.add_argument(
        "--source-system",
        choices=SOURCE_SYSTEMS,
        default="manual",
        help="需求来源；默认 manual",
    )
    init.add_argument("--title", help="需求标题")
    init.add_argument("--issue-id", help="外部系统中的 Issue ID")
    init.add_argument("--issue-updated-at", help="外部 Issue 最后更新时间")
    init.add_argument("--description-hash", help="外部 Issue 描述哈希")
    init.set_defaults(handler=cmd_init)

    status = subparsers.add_parser("status")
    status.add_argument("key", nargs="?")
    status.set_defaults(handler=cmd_status)

    check = subparsers.add_parser("check")
    check.add_argument("key")
    check.add_argument("phase", choices=PHASES)
    check.set_defaults(handler=cmd_check)

    freeze = subparsers.add_parser("freeze")
    freeze.add_argument("key")
    freeze.add_argument("artifact", choices=tuple(ARTIFACT_FILES))
    freeze.add_argument("--refreeze", action="store_true")
    freeze.set_defaults(handler=cmd_freeze)

    verify = subparsers.add_parser("verify")
    verify.add_argument("key")
    verify.add_argument("--evidence", action="append", required=True)
    verify.set_defaults(handler=cmd_verify)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.handler(args)
    except (FileNotFoundError, ValueError, yaml.YAMLError) as exc:
        return fail(str(exc), 2)


if __name__ == "__main__":
    raise SystemExit(main())
