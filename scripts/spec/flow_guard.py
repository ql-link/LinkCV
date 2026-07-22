#!/usr/bin/env python3
"""管理 L2/L3 本地规格状态和冻结产物哈希。"""

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
STATE_SCHEMA_VERSION = 2
ARTIFACT_FILES = {
    "brief": "brief.md",
    "acceptance": "acceptance.feature",
    "technical_design": "technical_design.md",
}
PHASES = (
    "brief",
    "acceptance",
    "technical_design",
    "implementation",
    "quality_review",
    "release_ready",
)
SOURCE_SYSTEMS = ("manual", "multica", "github")
SOURCE_GATES = (
    "brief",
    "acceptance",
    "technical_design",
    "implementation",
    "verification",
    "release",
)
SOURCE_GATE_BY_PHASE = {
    "brief": "brief",
    "acceptance": "acceptance",
    "technical_design": "technical_design",
    "implementation": "implementation",
    "quality_review": "verification",
    "release_ready": "release",
}
STATIONS = {
    "brief": ("brief-generator", ("Multica Issue 或用户请求",)),
    "acceptance": ("acceptance-generator", ("brief.md",)),
    "technical_design": (
        "technical-design",
        ("brief.md", "acceptance.feature"),
    ),
    "implementation": (
        "implementation-execution（代码完成后转 run-all-tests）",
        ("brief.md", "acceptance.feature", "technical_design.md（仅 L3）"),
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


def empty_source_reconciliation_state() -> dict[str, object]:
    """Brief 与 Multica 权威需求之间由工具维护的对账状态。"""
    return {
        "status": "pending",
        "brief_sha256": None,
        "requirements_hash": None,
        "comment_ids": [],
        "reconciled_at": None,
        "write_intent": None,
    }


def ensure_source_reconciliation(state: dict[str, object]) -> bool:
    """为已有 v2 Spec 补齐可选来源状态，不强迫无关项目迁移 schema。"""
    source = state.get("source")
    if not isinstance(source, dict) or source.get("system") != "multica":
        return False
    if isinstance(source.get("reconciliation"), dict):
        return False
    source["reconciliation"] = empty_source_reconciliation_state()
    return True


def migrate_state(state: dict[str, object]) -> bool:
    """把旧版状态安全升级到当前 schema；旧字符串证据不继续充当验证证明。"""
    version = state.get("schema_version")
    if version == STATE_SCHEMA_VERSION:
        return False
    if version not in {None, 1}:
        return False

    legacy_verification = state.get("verification")
    legacy_evidence: list[object] = []
    legacy_verified = False
    if isinstance(legacy_verification, dict):
        legacy_verified = legacy_verification.get("verified") is True
        raw_evidence = legacy_verification.get("evidence")
        if isinstance(raw_evidence, list):
            legacy_evidence = raw_evidence

    state["schema_version"] = STATE_SCHEMA_VERSION
    state["verification"] = empty_verification_state()
    if legacy_evidence:
        state["verification"]["legacy_evidence"] = legacy_evidence
    state["quality_review"] = empty_quality_review_state()
    if legacy_verified or state.get("phase") == "done":
        state["phase"] = "implementation"
    return True


def load_state(key: str) -> dict[str, object]:
    path = state_path(key)
    if not path.is_file():
        raise FileNotFoundError(f"未找到 {display_path(path)}；先运行 spec init")
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("state.yaml 顶层必须是映射")
    migrated = migrate_state(value)
    supplemented = ensure_source_reconciliation(value)
    if migrated or supplemented:
        save_state(key, value)
    if migrated:
        print(
            f"INFO 已自动升级 {display_path(path)} 到 schema v{STATE_SCHEMA_VERSION}；"
            "旧验证证据需重新自动执行",
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
    if state.get("lane") not in {"L2", "L3"}:
        errors.append("lane 必须是 L2 或 L3")
    if state.get("phase") not in PHASES:
        errors.append("phase 非法")
    source = state.get("source")
    if not isinstance(source, dict):
        errors.append("source 必须是映射")
    elif source.get("system") not in SOURCE_SYSTEMS:
        errors.append(f"source.system 必须是 {', '.join(SOURCE_SYSTEMS)} 之一")
    else:
        system = source.get("system")
        if system != "manual" and not (
            isinstance(source.get("issue_id"), str) and source.get("issue_id")
        ):
            errors.append(f"source.system={system} 时 source.issue_id 必须是字符串")
        if system == "multica":
            if not (
                isinstance(source.get("workspace_id"), str)
                and source.get("workspace_id")
            ):
                errors.append("Multica 来源缺少 source.workspace_id")
            for field in (
                "updated_at",
                "description_hash",
                "base_requirements_hash",
                "requirements_hash",
                "checked_at",
                "checked_for",
            ):
                if source.get(field) is not None and not isinstance(source.get(field), str):
                    errors.append(f"source.{field} 必须是字符串或 null")
            for field in ("change_comment_ids", "active_change_comment_ids"):
                value = source.get(field)
                if value is not None and (
                    not isinstance(value, list)
                    or not all(isinstance(item, str) and item for item in value)
                ):
                    errors.append(f"source.{field} 必须是非空字符串列表或 null")
            if source.get("checked_for") not in {None, *SOURCE_GATES}:
                errors.append(f"source.checked_for 必须是 {', '.join(SOURCE_GATES)} 或 null")
            if source.get("fingerprint_version") not in {1, 2}:
                errors.append("source.fingerprint_version 必须为 1 或 2")
            drift = source.get("drift")
            if not isinstance(drift, dict):
                errors.append("Multica 来源缺少 source.drift")
            elif not isinstance(drift.get("detected"), bool):
                errors.append("source.drift.detected 必须是布尔值")
            reconciliation = source.get("reconciliation")
            if not isinstance(reconciliation, dict):
                errors.append("Multica 来源缺少 source.reconciliation")
            else:
                if reconciliation.get("status") not in {
                    "pending",
                    "clean",
                    "syncing",
                    "synced",
                }:
                    errors.append(
                        "source.reconciliation.status 必须是 pending、clean、syncing 或 synced"
                    )
                for field in ("brief_sha256", "requirements_hash", "reconciled_at"):
                    if reconciliation.get(field) is not None and not isinstance(
                        reconciliation.get(field), str
                    ):
                        errors.append(
                            f"source.reconciliation.{field} 必须是字符串或 null"
                        )
                comment_ids = reconciliation.get("comment_ids")
                if not isinstance(comment_ids, list) or not all(
                    isinstance(value, str) and value for value in comment_ids
                ):
                    errors.append(
                        "source.reconciliation.comment_ids 必须是非空字符串列表"
                    )
                write_intent = reconciliation.get("write_intent")
                if write_intent is not None and not isinstance(write_intent, dict):
                    errors.append(
                        "source.reconciliation.write_intent 必须是映射或 null"
                    )
                if reconciliation.get("status") == "syncing" and not isinstance(
                    write_intent, dict
                ):
                    errors.append("syncing 对账状态必须包含 write_intent")
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
    if phase == "brief":
        return []
    if phase == "acceptance":
        return ["brief"]
    if phase == "technical_design":
        return ["brief", "acceptance"]
    if phase in {"implementation", "quality_review", "release_ready"}:
        names = ["brief", "acceptance"]
        if state.get("lane") == "L3":
            names.append("technical_design")
        return names
    raise ValueError(f"未知阶段: {phase}")


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
    errors.extend(validate_source_checkpoint(key, state, SOURCE_GATE_BY_PHASE[phase]))
    if phase == "quality_review":
        errors.extend(validate_verification_snapshot(key, state))
    if phase == "release_ready":
        errors.extend(validate_quality_review(key, state))
    return errors


def validate_source_checkpoint(
    key: str, state: dict[str, object], required_gate: str
) -> list[str]:
    source = state.get("source")
    if not isinstance(source, dict) or source.get("system") != "multica":
        return []
    drift = source.get("drift")
    if isinstance(drift, dict) and drift.get("detected"):
        return [
            "Multica 需求已发生漂移；先重新读取 Issue、修订 Brief，并运行 "
            f"`npm run spec:source -- accept {key} --gate brief`"
        ]
    if not source.get("requirements_hash"):
        return [
            "尚未捕获 Multica 需求基线；运行 "
            f"`npm run spec:source -- capture {key} --gate {required_gate}`"
        ]
    if source.get("checked_for") != required_gate:
        return [
            f"进入当前阶段前必须重新核验 Multica 需求；运行 "
            f"`npm run spec:source -- check {key} --gate {required_gate}`"
        ]
    return []


def validate_brief_reconciliation(
    key: str, state: dict[str, object], brief_sha256: str
) -> list[str]:
    source = state.get("source")
    if not isinstance(source, dict) or source.get("system") != "multica":
        return []
    reconciliation = source.get("reconciliation")
    if not isinstance(reconciliation, dict):
        return ["Multica Brief 尚未完成权威需求对账"]
    if reconciliation.get("status") not in {"clean", "synced"}:
        return [
            "冻结 Brief 前必须完成 Multica 需求对账；无变更运行 "
            f"`npm run spec:source -- reconcile {key} --no-change`，"
            "有变更须先获得用户确认再运行 sync-comment"
        ]
    if reconciliation.get("brief_sha256") != brief_sha256:
        return ["Brief 在需求对账后发生变化；重新执行 reconcile 或 sync-comment"]
    if reconciliation.get("requirements_hash") != source.get("requirements_hash"):
        return ["Multica 权威需求在 Brief 对账后发生变化；重新核验并对账"]
    return []


def expected_phase(state: dict[str, object]) -> str:
    verification = state.get("verification")
    review = state.get("quality_review")
    if isinstance(verification, dict) and verification.get("verified"):
        if isinstance(review, dict) and review.get("passed"):
            return "release_ready"
        return "quality_review"
    if artifact_state(state, "acceptance").get("frozen"):
        if state.get("lane") == "L3" and not artifact_state(
            state, "technical_design"
        ).get("frozen"):
            return "technical_design"
        return "implementation"
    if artifact_state(state, "brief").get("frozen"):
        return "acceptance"
    return "brief"


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
    if args.source_system != "manual" and not args.issue_id:
        return fail(f"来源为 {args.source_system} 时必须提供 --issue-id", 2)
    if args.source_system == "multica" and not args.workspace_id:
        return fail("来源为 multica 时必须提供 --workspace-id", 2)
    directory = feature_dir(key)
    path = state_path(key)
    if path.exists():
        return fail(f"拒绝覆盖已有 {display_path(path)}")
    directory.mkdir(parents=True, exist_ok=True)
    state: dict[str, object] = {
        "schema_version": STATE_SCHEMA_VERSION,
        "key": key,
        "title": args.title or "",
        "source": {
            "system": args.source_system,
            "issue_id": args.issue_id,
            "workspace_id": args.workspace_id,
            "issue_key": key if args.source_system == "multica" else None,
            "updated_at": args.issue_updated_at,
            "description_hash": args.description_hash,
            "base_requirements_hash": None,
            "requirements_hash": None,
            "change_comment_ids": [],
            "active_change_comment_ids": [],
            "fingerprint_version": 1,
            "checked_at": None,
            "checked_for": None,
            "drift": {
                "detected": False,
                "detected_at": None,
                "previous_requirements_hash": None,
                "observed_requirements_hash": None,
                "observed_updated_at": None,
            },
            "reconciliation": empty_source_reconciliation_state(),
        },
        "lane": args.lane,
        "phase": "brief",
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
    print(f"OK  已初始化 .specs/{key} ({args.lane})")
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
        skill, reads = STATIONS[phase]
        print(f"{key}: lane={state.get('lane')} phase={phase}")
        print(f"  下一站：{skill}")
        print(
            "  待读："
            + ", ".join(
                item
                if item.startswith("Multica") or "证据" in item
                else f".specs/{key}/{item}"
                for item in reads
            )
        )
        print(f"  门禁：npm run spec -- check {key} {phase}")
        source = state.get("source", {})
        if isinstance(source, dict) and source.get("system") == "multica":
            gate = SOURCE_GATE_BY_PHASE[phase]
            drift = source.get("drift")
            reconciliation = source.get("reconciliation")
            if isinstance(drift, dict) and drift.get("detected"):
                print(
                    "  需求源：已检测漂移；重新读取 Issue、修订 Brief 后执行 "
                    f"npm run spec:source -- accept {key} --gate brief"
                )
            elif source.get("checked_for") == gate:
                print(
                    f"  需求源：已核验 gate={gate} at={source.get('checked_at') or '未知'}"
                )
            elif source.get("requirements_hash"):
                print(
                    "  需求源：待核验；执行 "
                    f"npm run spec:source -- check {key} --gate {gate}"
                )
            else:
                print(
                    "  需求源：尚未捕获基线；执行 "
                    f"npm run spec:source -- capture {key} --gate {gate}"
                )
            if phase == "brief" and isinstance(reconciliation, dict):
                if reconciliation.get("status") in {"clean", "synced"}:
                    print(
                        "  需求对账："
                        f"{reconciliation.get('status')} at="
                        f"{reconciliation.get('reconciled_at') or '未知'}"
                    )
                elif source.get("requirements_hash"):
                    print(
                        "  需求对账：待 brief-generator 比较当前 Brief；"
                        "开发者无需维护指纹或评论 ID"
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
    state["verification"] = empty_verification_state()
    state["quality_review"] = empty_quality_review_state()


def clear_source_checkpoint(state: dict[str, object]) -> None:
    source = state.get("source")
    if isinstance(source, dict) and source.get("system") == "multica":
        source["checked_for"] = None


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
        errors.extend(validate_source_checkpoint(key, state, name))
        if name == "brief":
            errors.extend(validate_brief_reconciliation(key, state, digest(path)))
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
    clear_source_checkpoint(state)
    save_state(key, state)
    print(f"OK  已冻结 {name}，下一阶段 {state['phase']}")
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
        errors.extend(validate_source_checkpoint(key, state, "verification"))
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
    init.add_argument("--lane", choices=("L2", "L3"), required=True, help="交付车道")
    init.add_argument(
        "--source-system",
        choices=SOURCE_SYSTEMS,
        default="manual",
        help="需求来源；默认 manual",
    )
    init.add_argument("--title", help="需求标题")
    init.add_argument("--issue-id", help="外部系统中的 Issue ID")
    init.add_argument("--workspace-id", help="Multica workspace UUID")
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
