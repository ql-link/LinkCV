#!/usr/bin/env python3
"""管理方案先行任务的本地规格状态和冻结产物哈希。"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SPECS_ROOT = Path(os.environ.get("LINKCV_SPECS_ROOT", REPO_ROOT / ".specs")).resolve()
VERIFICATION_ROOT = Path(
    os.environ.get("LINKCV_VERIFICATION_ROOT", REPO_ROOT)
).resolve()
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
STATE_SCHEMA_VERSION = 7
ARTIFACT_FILES = {
    "solution": "solution.md",
    "acceptance": "acceptance.feature",
}
# 方案文档冻结时选定的后续路径。进不进 .specs 由 flow-router 决定，这里只决定方案之后怎么走。
ROUTES = {
    "acceptance_first": "契约验收（方案 → 验收契约 → 实现）",
    "direct_build": "直接施工（方案 → 实现，不产出验收契约）",
}
PHASES = (
    "solution",
    "acceptance",
    "implementation",
    "quality_review",
    "release_ready",
)
STATIONS = {
    "solution": (
        "solution-generator",
        ("来源 Issue 正文、相关飞书详情文档与用户确认补充",),
    ),
    "acceptance": ("acceptance-generator", ("solution.md",)),
    "implementation": (
        "implementation-execution（代码完成后转 run-all-tests）",
        ("solution.md",),
    ),
    "quality_review": (
        "code-review-and-quality",
        ("验证证据", "implementation_report.md（存在时）"),
    ),
    "release_ready": (
        "branch-pr-workflow",
        ("验证与质量审查证据", "implementation_report.md（存在时）"),
    ),
}


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


def legacy_source_issue(source: object) -> str | None:
    """把旧版平台字段压缩为一个不参与流程判断的稳定引用。"""
    if not isinstance(source, dict):
        return None
    issue_id = source.get("issue_id")
    if not isinstance(issue_id, str) or not issue_id.strip():
        return None
    issue_id = issue_id.strip()
    system = source.get("system")
    if not isinstance(system, str) or not system.strip() or system == "manual":
        return issue_id
    system = system.strip().lower()
    workspace_id = source.get("workspace_id")
    if isinstance(workspace_id, str) and workspace_id.strip():
        return f"{system}://{workspace_id.strip()}/{issue_id}"
    return f"{system}:{issue_id}"


def feature_dir(key: str) -> Path:
    return SPECS_ROOT / validate_key(key)


def state_path(key: str) -> Path:
    return feature_dir(key) / "state.yaml"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def empty_verification_state() -> dict[str, object]:
    return {
        "verified": False,
        "commands": [],
        "code_snapshot": None,
        "manual_acceptance": None,
        "verified_at": None,
    }


def empty_quality_review_state() -> dict[str, object]:
    return {
        "passed": False,
        "evidence": [],
        "code_snapshot_sha256": None,
        "reviewed_at": None,
    }


def route_of(state: dict[str, object]) -> str | None:
    route = state.get("route")
    return route if isinstance(route, str) and route in ROUTES else None


def acceptance_required(state: dict[str, object]) -> bool:
    """只有契约验收路径才把 acceptance.feature 作为下游门禁的前置。"""
    return route_of(state) == "acceptance_first"


def migrate_state(state: dict[str, object]) -> bool:
    """升级旧状态，并把平台字段压缩为单一来源 Issue 引用。"""
    version = state.get("schema_version")
    if version == STATE_SCHEMA_VERSION:
        return False
    if version not in {None, 1, 2, 3, 4, 5, 6}:
        return False

    if version in {None, 1}:
        legacy_verification = state.get("verification")
        legacy_evidence: list[object] = []
        legacy_verified = False
        if isinstance(legacy_verification, dict):
            legacy_verified = legacy_verification.get("verified") is True
            raw_evidence = legacy_verification.get("evidence")
            if isinstance(raw_evidence, list):
                legacy_evidence = raw_evidence
        state["verification"] = empty_verification_state()
        if legacy_evidence:
            state["verification"]["legacy_evidence"] = legacy_evidence
        state["quality_review"] = empty_quality_review_state()
        if legacy_verified or state.get("phase") == "done":
            state["phase"] = "implementation"

    artifacts = state.get("artifacts")
    if isinstance(artifacts, dict):
        artifacts.pop("technical_design", None)
        legacy_brief = artifacts.pop("brief", None)
        if isinstance(legacy_brief, dict) and "solution" not in artifacts:
            legacy_brief["file"] = ARTIFACT_FILES["solution"]
            artifacts["solution"] = legacy_brief
    if state.get("phase") == "technical_design":
        state["phase"] = "implementation"
    if state.get("phase") == "brief":
        state["phase"] = "solution"

    # 旧版只有 L2/L3 一条链路，等价于新的契约验收路径；方案文档未冻结时路径尚未选定。
    state.pop("lane", None)
    if route_of(state) is None:
        solution_frozen = (
            isinstance(artifacts, dict)
            and isinstance(artifacts.get("solution"), dict)
            and artifacts["solution"].get("frozen") is True
        )
        state["route"] = "acceptance_first" if solution_frozen else None

    source_issue = state.get("source_issue")
    if not isinstance(source_issue, str) or not source_issue.strip():
        source_issue = legacy_source_issue(state.get("source"))
    else:
        source_issue = source_issue.strip()
    state.pop("source", None)
    state["source_issue"] = source_issue
    state["schema_version"] = STATE_SCHEMA_VERSION
    return True


def load_state(key: str) -> dict[str, object]:
    path = state_path(key)
    if not path.is_file():
        raise FileNotFoundError(f"未找到 {display_path(path)}；先运行 spec init")
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("state.yaml 顶层必须是映射")
    migrated = migrate_state(value)
    if migrated:
        save_state(key, value)
    if migrated:
        print(
            f"INFO 已自动升级 {display_path(path)} 到 schema v{STATE_SCHEMA_VERSION}；"
            "已把旧版平台字段合并为 source_issue 引用，移除已下线的 "
            "technical_design 阶段与 lane 字段，把 brief 阶段改名为 solution，"
            "并把原 L2/L3 链路记为 route=acceptance_first",
            file=sys.stderr,
        )
    return value


def save_state(key: str, state: dict[str, object]) -> None:
    state["updated_at"] = now()
    state_path(key).write_text(
        yaml.safe_dump(state, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )


def git_output_bytes(*args: str) -> bytes:
    result = subprocess.run(
        ["git", *args],
        cwd=VERIFICATION_ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(detail or f"git {' '.join(args)} 执行失败")
    return result.stdout


def update_file_digest(hasher: object, relative_raw: bytes) -> None:
    relative = os.fsdecode(relative_raw)
    target = VERIFICATION_ROOT / relative
    hasher.update(relative_raw)
    hasher.update(b"\0")
    if target.is_symlink():
        hasher.update(b"symlink\0")
        hasher.update(os.fsencode(os.readlink(target)))
        return
    if not target.is_file():
        hasher.update(b"missing\0")
        return
    executable = target.stat().st_mode & 0o111
    hasher.update(f"file:{executable:o}\0".encode())
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)


def repository_snapshot() -> dict[str, object]:
    """对当前可提交内容做内容指纹；提交动作本身不会让相同内容失效。"""
    listed = git_output_bytes(
        "ls-files", "--cached", "--others", "--exclude-standard", "-z"
    )
    paths = sorted(path for path in listed.split(b"\0") if path)
    hasher = hashlib.sha256()
    for relative_raw in paths:
        update_file_digest(hasher, relative_raw)
        hasher.update(b"\0")
    head = git_output_bytes("rev-parse", "--verify", "HEAD").decode().strip()
    return {
        "sha256": hasher.hexdigest(),
        "file_count": len(paths),
        "head": head,
        "captured_at": now(),
    }


def artifact_state(state: dict[str, object], name: str) -> dict[str, object]:
    artifacts = state.get("artifacts")
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get(name), dict):
        raise ValueError(f"state.yaml 缺少 artifacts.{name}")
    return artifacts[name]


def validate_schema(key: str, state: dict[str, object]) -> list[str]:
    errors: list[str] = []
    if state.get("schema_version") != STATE_SCHEMA_VERSION:
        errors.append(f"schema_version 必须为 {STATE_SCHEMA_VERSION}")
    if state.get("key") != validate_key(key):
        errors.append("state.key 与目录名不一致")
    if "lane" in state:
        errors.append("lane 字段已下线；改用 route 记录方案文档之后的路径")
    route = state.get("route")
    if route is not None and route not in ROUTES:
        errors.append("route 必须是 " + "、".join(ROUTES) + " 或 null")
    if state.get("phase") not in PHASES:
        errors.append("phase 非法")
    solution_frozen = False
    try:
        solution_frozen = artifact_state(state, "solution").get("frozen") is True
    except ValueError:
        pass
    if solution_frozen and route is None:
        errors.append("方案文档已冻结但未记录 route；运行 spec route 选定后续路径")
    if not solution_frozen and route is not None:
        errors.append("方案文档尚未冻结，不应记录 route")
    try:
        if artifact_state(state, "acceptance").get("frozen") and route != "acceptance_first":
            errors.append("只有 route=acceptance_first 才允许冻结 acceptance.feature")
    except ValueError:
        pass
    source_issue = state.get("source_issue")
    if source_issue is not None and not (
        isinstance(source_issue, str) and source_issue.strip()
    ):
        errors.append("source_issue 必须是非空字符串或 null")
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
    elif verification.get("verified"):
        commands = verification.get("commands")
        snapshot = verification.get("code_snapshot")
        if not isinstance(commands, list) or not commands:
            errors.append("已验证状态必须包含 verification.commands")
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("sha256"), str):
            errors.append("已验证状态必须包含 verification.code_snapshot.sha256")
    quality_review = state.get("quality_review")
    if not isinstance(quality_review, dict) or not isinstance(
        quality_review.get("passed"), bool
    ):
        errors.append("quality_review.passed 必须是布尔值")
    elif quality_review.get("passed") and not isinstance(
        quality_review.get("code_snapshot_sha256"), str
    ):
        errors.append("已通过质量审查时必须记录 code_snapshot_sha256")
    return errors


def verification_state(state: dict[str, object]) -> dict[str, object]:
    verification = state.get("verification")
    if not isinstance(verification, dict):
        raise ValueError("state.yaml 缺少 verification")
    return verification


def quality_review_state(state: dict[str, object]) -> dict[str, object]:
    review = state.get("quality_review")
    if not isinstance(review, dict):
        raise ValueError("state.yaml 缺少 quality_review")
    return review


def validate_manual_acceptance(key: str) -> tuple[dict[str, object] | None, list[str]]:
    path = feature_dir(key) / "manual_acceptance.md"
    if not path.is_file():
        return None, [f"人工验收文件不存在: {display_path(path)}"]
    body = path.read_text(encoding="utf-8")
    errors: list[str] = []
    if re.search(r"<[^>\n]+>", body):
        errors.append("manual_acceptance.md 仍含模板占位内容")
    if re.search(r"\|\s*总体状态\s*\|\s*`?通过`?\s*\|", body) is None:
        errors.append("人工验收总体状态不是通过")
    if re.search(r"人工验收结论：\s*`?通过`?", body) is None:
        errors.append("人工验收结论不是通过")
    if re.search(r"是否可以进入质量审查：\s*`?是`?", body) is None:
        errors.append("人工验收尚未允许进入质量审查")
    if re.search(
        r"(?:\|\s*(?:未执行|失败|阻塞)\s*\||-\s*状态：\s*`?(?:未执行|失败|阻塞)`?)",
        body,
    ):
        errors.append("人工验收明细仍有失败、阻塞或未执行项")
    statistics = re.search(
        r"统计：通过\s*`?(\d+)`?；失败\s*`?(\d+)`?；"
        r"阻塞\s*`?(\d+)`?；未执行\s*`?(\d+)`?；不适用\s*`?(\d+)`?",
        body,
    )
    if statistics is None:
        errors.append("人工验收统计缺失或格式无效")
    elif any(int(value) for value in statistics.groups()[1:4]):
        errors.append("人工验收仍有失败、阻塞或未执行项")
    if errors:
        return None, errors
    return {
        "file": "manual_acceptance.md",
        "sha256": digest(path),
        "result": "passed",
    }, []


def validate_verification_snapshot(key: str, state: dict[str, object]) -> list[str]:
    verification = verification_state(state)
    if not verification.get("verified"):
        return ["实现尚未完成自动验证"]
    snapshot = verification.get("code_snapshot")
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("sha256"), str):
        return ["验证记录缺少代码快照；重新运行 spec verify"]
    current = repository_snapshot()
    if current["sha256"] != snapshot["sha256"]:
        return ["验证后代码内容已变化；重新运行 spec verify，质量审查会自动重置"]
    manual = verification.get("manual_acceptance")
    if manual is not None:
        if not isinstance(manual, dict):
            return ["人工验收记录结构无效"]
        path = feature_dir(key) / "manual_acceptance.md"
        if not path.is_file() or manual.get("sha256") != digest(path):
            return ["人工验收记录在验证后发生变化；重新运行 spec verify"]
    return []


def validate_quality_review(key: str, state: dict[str, object]) -> list[str]:
    review = quality_review_state(state)
    if not review.get("passed"):
        return ["代码质量审查尚未通过"]
    verification = verification_state(state)
    snapshot = verification.get("code_snapshot")
    expected_hash = snapshot.get("sha256") if isinstance(snapshot, dict) else None
    if review.get("code_snapshot_sha256") != expected_hash:
        return ["质量审查对应的代码快照与验证快照不一致；重新执行质量审查"]
    return validate_verification_snapshot(key, state)


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
    if phase == "solution":
        return []
    if phase == "acceptance":
        return ["solution"]
    if phase in {"implementation", "quality_review", "release_ready"}:
        if acceptance_required(state):
            return ["solution", "acceptance"]
        return ["solution"]
    raise ValueError(f"未知阶段: {phase}")


def station_reads(state: dict[str, object], phase: str) -> tuple[str, ...]:
    reads = STATIONS[phase][1]
    if phase == "implementation" and acceptance_required(state):
        return (*reads, ARTIFACT_FILES["acceptance"])
    return reads


def check_phase(key: str, state: dict[str, object], phase: str) -> list[str]:
    errors = validate_schema(key, state)
    if errors:
        return errors
    if state.get("phase") != phase:
        errors.append(
            f"当前 phase={state.get('phase')}，不能按 {phase} 阶段继续；"
            f"先运行 `npm run spec -- status {key}` 恢复正确下一站"
        )
    for name in required_artifacts(state, phase):
        errors.extend(validate_frozen_artifact(key, state, name))
    if phase == "quality_review":
        errors.extend(validate_verification_snapshot(key, state))
    if phase == "release_ready":
        errors.extend(validate_quality_review(key, state))
    return errors


def expected_phase(state: dict[str, object]) -> str:
    verification = state.get("verification")
    review = state.get("quality_review")
    if isinstance(verification, dict) and verification.get("verified"):
        if isinstance(review, dict) and review.get("passed"):
            return "release_ready"
        return "quality_review"
    if not artifact_state(state, "solution").get("frozen"):
        return "solution"
    if route_of(state) == "direct_build":
        return "implementation"
    if artifact_state(state, "acceptance").get("frozen"):
        return "implementation"
    return "acceptance"


def validate_current_state(key: str, state: dict[str, object]) -> list[str]:
    errors = validate_schema(key, state)
    if errors:
        return errors
    for name in ARTIFACT_FILES:
        if artifact_state(state, name).get("frozen"):
            errors.extend(validate_frozen_artifact(key, state, name))
    phase = state.get("phase")
    if phase == "quality_review":
        errors.extend(validate_verification_snapshot(key, state))
    elif phase == "release_ready":
        errors.extend(validate_quality_review(key, state))
    expected = expected_phase(state)
    if state.get("phase") != expected:
        errors.append(
            f"phase={state.get('phase')} 与冻结产物不一致；按当前状态应为 {expected}"
        )
    return errors


def cmd_init(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    source_issue = args.source_issue.strip() if args.source_issue is not None else None
    if args.source_issue is not None and not source_issue:
        return fail("--source-issue 不能是空字符串", 2)
    directory = feature_dir(key)
    path = state_path(key)
    if path.exists():
        return fail(f"拒绝覆盖已有 {display_path(path)}")
    directory.mkdir(parents=True, exist_ok=True)
    state: dict[str, object] = {
        "schema_version": STATE_SCHEMA_VERSION,
        "key": key,
        "title": args.title or "",
        "source_issue": source_issue,
        "route": None,
        "phase": "solution",
        "artifacts": {
            name: {"file": filename, "frozen": False, "sha256": None}
            for name, filename in ARTIFACT_FILES.items()
        },
        "verification": empty_verification_state(),
        "quality_review": empty_quality_review_state(),
        "created_at": now(),
        "updated_at": now(),
    }
    save_state(key, state)
    print(f"OK  已初始化 .specs/{key}；方案文档冻结时选定后续路径")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    if args.key:
        keys = [validate_key(args.key)]
    else:
        discovered = sorted(path.parent.name for path in SPECS_ROOT.glob("*/state.yaml"))
        keys = []
        for key in discovered:
            try:
                state = load_state(key)
            except (FileNotFoundError, ValueError, yaml.YAMLError):
                keys.append(key)
                continue
            if state.get("phase") != "release_ready":
                keys.append(key)
    if not keys:
        print("OK  当前没有在途本地 Spec；新需求从 flow-router 开始")
        return 0
    if not args.key and len(keys) > 1:
        print(f"WARN 当前有 {len(keys)} 个在途 Spec；请选择 KEY 后继续")
    result = 0
    for key in keys:
        try:
            state = load_state(key)
        except (FileNotFoundError, ValueError, yaml.YAMLError) as exc:
            print(f"ERROR {key}: {exc}", file=sys.stderr)
            result = 1
            continue
        errors = validate_current_state(key, state)
        if errors:
            print(f"ERROR {key}: 本地状态不可信", file=sys.stderr)
            for error in errors:
                print(f"  - {error}", file=sys.stderr)
            print(f"  修复后重试：npm run spec -- status {key}", file=sys.stderr)
            result = 1
            continue

        phase = str(state.get("phase"))
        skill = STATIONS[phase][0]
        reads = station_reads(state, phase)
        route = route_of(state)
        print(f"{key}: route={ROUTES[route] if route else '未选定'} phase={phase}")
        print(f"  下一站：{skill}")
        print(
            "  待读："
            + ", ".join(
                item
                if item.startswith(("来源 Issue", "飞书")) or "证据" in item
                else f".specs/{key}/{item}"
                for item in reads
            )
        )
        print(f"  门禁：npm run spec -- check {key} {phase}")
        source_issue = state.get("source_issue")
        if isinstance(source_issue, str):
            print(
                f"  来源 Issue：{source_issue}；"
                "正文是开发起点，详情文档按需补充；不执行外部漂移门禁"
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
    order = ["solution", "acceptance"]
    for downstream in order[order.index(name) + 1 :]:
        item = artifact_state(state, downstream)
        item["frozen"] = False
        item["sha256"] = None
    state["verification"] = empty_verification_state()
    state["quality_review"] = empty_quality_review_state()


def cmd_freeze(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    state = load_state(key)
    name = args.artifact
    path = feature_dir(key) / ARTIFACT_FILES[name]
    if not path.is_file():
        return fail(f"产物不存在: {display_path(path)}")

    errors = validate_schema(key, state)
    if not errors:
        errors.extend(
            error
            for prerequisite in required_artifacts(state, name)
            for error in validate_frozen_artifact(key, state, prerequisite)
        )
    if name == "solution" and args.next is None and route_of(state) is None:
        errors.append(
            "冻结方案文档时必须用 --next 选定后续路径：" + "、".join(ROUTES)
        )
    if name == "acceptance":
        chosen = args.next or route_of(state)
        if chosen != "acceptance_first":
            errors.append(
                "当前路径不产出验收契约；需要时先运行 "
                f"`npm run spec -- route {key} acceptance_first`"
            )
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1

    item = artifact_state(state, name)
    new_hash = digest(path)
    unchanged = item.get("frozen") and item.get("sha256") == new_hash
    route_change = name == "solution" and args.next is not None and args.next != route_of(state)
    if unchanged and not route_change:
        print(f"OK  {name} 已冻结且内容未变化")
        return 0
    if item.get("frozen") and not unchanged and not args.refreeze:
        return fail(f"{name} 已冻结且内容变化；确认后追加 --refreeze")
    if item.get("frozen") and not unchanged:
        invalidate_after(state, name)

    item["frozen"] = True
    item["sha256"] = new_hash
    if name == "solution" and args.next is not None:
        apply_route(state, args.next)
    state["phase"] = expected_phase(state)
    save_state(key, state)
    print(
        f"OK  已冻结 {name}；路径 {ROUTES[route_of(state)]}，下一阶段 {state['phase']}"
    )
    return 0


def apply_route(state: dict[str, object], route: str) -> None:
    """切换方案文档之后的路径；离开契约验收时作废已冻结的验收契约和下游证据。"""
    if route_of(state) == route:
        return
    if route != "acceptance_first":
        acceptance = artifact_state(state, "acceptance")
        acceptance["frozen"] = False
        acceptance["sha256"] = None
    state["verification"] = empty_verification_state()
    state["quality_review"] = empty_quality_review_state()
    state["route"] = route


def cmd_route(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    state = load_state(key)
    errors = validate_schema(key, state)
    if not errors and not artifact_state(state, "solution").get("frozen"):
        errors.append("方案文档尚未冻结；路径在冻结方案文档时选定")
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    if route_of(state) == args.route:
        print(f"OK  路径已经是 {ROUTES[args.route]}")
        return 0
    apply_route(state, args.route)
    state["phase"] = expected_phase(state)
    save_state(key, state)
    print(
        f"OK  已切换为 {ROUTES[args.route]}；已重置验证与质量审查记录，"
        f"下一阶段 {state['phase']}"
    )
    return 0


def run_verification_commands(commands: list[str]) -> tuple[list[dict[str, object]], int]:
    results: list[dict[str, object]] = []
    for raw_command in commands:
        command = shlex.split(raw_command)
        if not command:
            raise ValueError("--run 不能是空命令")
        print(f"RUN {raw_command}", flush=True)
        started = time.monotonic()
        try:
            result = subprocess.run(
                command,
                cwd=VERIFICATION_ROOT,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(f"验证命令不存在: {command[0]}") from exc
        command_result = {
            "command": raw_command,
            "exit_code": result.returncode,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "finished_at": now(),
        }
        results.append(command_result)
        if result.returncode != 0:
            return results, result.returncode
    return results, 0


def cmd_verify(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    state = load_state(key)
    errors = validate_schema(key, state)
    if not errors:
        if state.get("phase") not in {
            "implementation",
            "quality_review",
            "release_ready",
        }:
            errors.append(
                f"当前 phase={state.get('phase')}，不能记录实现验证；先运行 "
                f"`npm run spec -- status {key}`"
            )
        for name in required_artifacts(state, "implementation"):
            errors.extend(validate_frozen_artifact(key, state, name))
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1

    manual_acceptance: dict[str, object] | None = None
    if args.manual_acceptance:
        manual_acceptance, manual_errors = validate_manual_acceptance(key)
        if manual_errors:
            for error in manual_errors:
                print(f"ERROR {error}", file=sys.stderr)
            return 1

    before = repository_snapshot()
    command_results, returncode = run_verification_commands(args.run)
    if returncode != 0:
        return fail(
            f"验证命令失败（exit={returncode}）；未更新验证状态",
            1,
        )
    after = repository_snapshot()
    if before["sha256"] != after["sha256"]:
        return fail("验证命令改变了可提交内容；检查变更后重新运行 spec verify")

    verification = verification_state(state)
    verification["verified"] = True
    verification["commands"] = command_results
    verification["code_snapshot"] = after
    verification["manual_acceptance"] = manual_acceptance
    verification["verified_at"] = now()
    state["quality_review"] = empty_quality_review_state()
    state["phase"] = "quality_review"
    save_state(key, state)
    print(f"OK  {key} 已自动验证并绑定当前代码快照；下一阶段 quality_review")
    return 0


def cmd_review(args: argparse.Namespace) -> int:
    key = validate_key(args.key)
    state = load_state(key)
    errors = check_phase(key, state, "quality_review")
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    verification = verification_state(state)
    snapshot = verification.get("code_snapshot")
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("sha256"), str):
        return fail("验证记录缺少代码快照；重新运行 spec verify")
    review = quality_review_state(state)
    review["passed"] = True
    review["evidence"] = args.evidence or []
    review["code_snapshot_sha256"] = snapshot["sha256"]
    review["reviewed_at"] = now()
    state["phase"] = "release_ready"
    save_state(key, state)
    print(f"OK  已记录 {key} 的质量审查结论；下一阶段 release_ready")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="初始化本地规格状态")
    init.add_argument("key", help="Issue 标识，例如 LCV-21")
    init.add_argument("--title", help="需求标题")
    init.add_argument(
        "--source-issue",
        help="来源 Issue 的完整链接或稳定引用；无外部 Issue 的例外任务可省略",
    )
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
    freeze.add_argument(
        "--next",
        choices=tuple(ROUTES),
        help="冻结方案文档时选定后续路径；首次冻结必填",
    )
    freeze.set_defaults(handler=cmd_freeze)

    route = subparsers.add_parser("route", help="切换方案文档之后的路径")
    route.add_argument("key")
    route.add_argument("route", choices=tuple(ROUTES))
    route.set_defaults(handler=cmd_route)

    verify = subparsers.add_parser("verify")
    verify.add_argument("key")
    verify.add_argument(
        "--run",
        action="append",
        required=True,
        help="由工具实际执行并记录的验证命令；可重复",
    )
    verify.add_argument(
        "--manual-acceptance",
        action="store_true",
        help="同时校验固定位置的 manual_acceptance.md",
    )
    verify.set_defaults(handler=cmd_verify)

    review = subparsers.add_parser("review")
    review.add_argument("key")
    review.add_argument("--pass", dest="passed", action="store_true", required=True)
    review.add_argument("--evidence", action="append")
    review.set_defaults(handler=cmd_review)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.handler(args)
    except (FileNotFoundError, RuntimeError, ValueError, yaml.YAMLError) as exc:
        return fail(str(exc), 2)


if __name__ == "__main__":
    raise SystemExit(main())
