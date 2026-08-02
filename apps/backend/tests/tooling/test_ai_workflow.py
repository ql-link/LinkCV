from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
FLOW_GUARD = REPO_ROOT / "scripts" / "spec" / "flow_guard.py"
LINK_SETUP = REPO_ROOT / "scripts" / "setup" / "setup_ai_links.py"
SKILL_CHECK = REPO_ROOT / "scripts" / "quality" / "check_skills.py"
DOCS_SYNC = REPO_ROOT / "scripts" / "quality" / "check_docs_sync.py"
RUNTIME_CONTRACTS = REPO_ROOT / "scripts" / "quality" / "check_runtime_contracts.py"
RUNTIME_CONTRACT_RULES = REPO_ROOT / "scripts" / "quality" / "runtime-contract-rules.yaml"
PR_TEMPLATE = (
    REPO_ROOT / ".ai" / "skills" / "branch-pr-workflow" / "pull_request.template.md"
)


def run_script(script: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    command_env.update(env or {})
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=REPO_ROOT,
        env=command_env,
        text=True,
        capture_output=True,
        check=False,
    )


def successful_verification_command() -> str:
    return f"{shlex.quote(sys.executable)} -c pass"


def failed_verification_command() -> str:
    return f"{shlex.quote(sys.executable)} -c {shlex.quote('raise SystemExit(7)')}"


def repository_mutating_verification_command() -> str:
    script = "from pathlib import Path; Path('tracked.txt').write_text('modified\\n')"
    return f"{shlex.quote(sys.executable)} -c {shlex.quote(script)}"


def create_verification_repo(tmp_path: Path) -> Path:
    root = tmp_path / "verification-repo"
    root.mkdir()
    (root / "tracked.txt").write_text("initial\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "tracked.txt"], cwd=root, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=LinkCV Tests",
            "-c",
            "user.email=tests@example.invalid",
            "commit",
            "-qm",
            "test baseline",
        ],
        cwd=root,
        check=True,
    )
    return root


def write_passing_manual_acceptance(path: Path) -> None:
    path.write_text(
        """# LCV-100 · 人工端到端验收记录

| 项目 | 内容 |
| --- | --- |
| 总体状态 | `通过` |

## 验收结论

- 统计：通过 `1`；失败 `0`；阻塞 `0`；未执行 `0`；不适用 `0`。
- 人工验收结论：`通过`
- 是否可以进入质量审查：`是`
""",
        encoding="utf-8",
    )


def test_link_setup_creates_missing_links_and_is_idempotent(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "skills").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text("rules", encoding="utf-8")
    env = {"LINKCV_REPO_ROOT": str(tmp_path)}

    first = run_script(LINK_SETUP, env=env)
    second = run_script(LINK_SETUP, "--check", env=env)

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert (tmp_path / "AGENTS.md").is_symlink()
    assert (tmp_path / ".agents" / "skills").resolve() == (tmp_path / ".ai" / "skills")


def test_link_setup_refuses_to_overwrite_existing_file(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "skills").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text("new", encoding="utf-8")
    agents = tmp_path / "AGENTS.md"
    agents.write_text("keep", encoding="utf-8")

    result = run_script(LINK_SETUP, env={"LINKCV_REPO_ROOT": str(tmp_path)})

    assert result.returncode == 1
    assert "拒绝覆盖" in result.stderr
    assert agents.read_text(encoding="utf-8") == "keep"


def test_solution_freeze_requires_artifact_and_detects_drift(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(FLOW_GUARD, "init", "LCV-99", env=env)
    blocked = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert initialized.returncode == 0, initialized.stderr
    assert blocked.returncode == 1
    assert "solution 尚未冻结" in blocked.stderr

    solution = specs_root / "LCV-99" / "solution.md"
    solution.write_text("# 方案\n", encoding="utf-8")
    frozen = run_script(FLOW_GUARD, "freeze", "LCV-99", "solution", "--next", "acceptance_first", env=env)
    allowed = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert frozen.returncode == 0, frozen.stderr
    assert allowed.returncode == 0, allowed.stderr

    solution.write_text("# 方案 v2\n", encoding="utf-8")
    drifted = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert drifted.returncode == 1
    assert "冻结后已变化" in drifted.stderr


def test_acceptance_first_route_reaches_implementation_and_refreeze_invalidates_downstream(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-109"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-109", env=env).returncode == 0
    (feature / "solution.md").write_text("solution v1", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-109", "solution", "--next", "acceptance_first", env=env).returncode == 0

    blocked = run_script(FLOW_GUARD, "check", "LCV-109", "implementation", env=env)
    assert blocked.returncode == 1
    assert "当前 phase=acceptance" in blocked.stderr

    (feature / "acceptance.feature").write_text("Feature: v1", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-109", "acceptance", env=env).returncode == 0

    allowed = run_script(FLOW_GUARD, "check", "LCV-109", "implementation", env=env)
    status = run_script(FLOW_GUARD, "status", "LCV-109", env=env)

    assert allowed.returncode == 0, allowed.stderr
    assert status.returncode == 0, status.stderr
    assert "下一站：implementation-execution" in status.stdout
    assert "technical" not in status.stdout

    (feature / "solution.md").write_text("solution v2", encoding="utf-8")
    refrozen = run_script(
        FLOW_GUARD, "freeze", "LCV-109", "solution", "--refreeze", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert refrozen.returncode == 0, refrozen.stderr
    assert state["phase"] == "acceptance"
    assert state["artifacts"]["solution"]["frozen"] is True
    assert state["artifacts"]["acceptance"]["frozen"] is False
    assert "technical_design" not in state["artifacts"]
    assert state["verification"]["verified"] is False
    assert state["quality_review"]["passed"] is False


def test_direct_build_route_reaches_implementation_without_acceptance(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-116"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-116", env=env).returncode == 0
    (feature / "solution.md").write_text("solution v1", encoding="utf-8")

    missing_route = run_script(FLOW_GUARD, "freeze", "LCV-116", "solution", env=env)
    assert missing_route.returncode == 1
    assert "必须用 --next 选定后续路径" in missing_route.stderr

    frozen = run_script(
        FLOW_GUARD, "freeze", "LCV-116", "solution", "--next", "direct_build", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    allowed = run_script(FLOW_GUARD, "check", "LCV-116", "implementation", env=env)
    status = run_script(FLOW_GUARD, "status", "LCV-116", env=env)

    assert frozen.returncode == 0, frozen.stderr
    assert state["route"] == "direct_build"
    assert state["phase"] == "implementation"
    assert allowed.returncode == 0, allowed.stderr
    assert "acceptance.feature" not in status.stdout

    (feature / "acceptance.feature").write_text("Feature: v1", encoding="utf-8")
    rejected = run_script(FLOW_GUARD, "freeze", "LCV-116", "acceptance", env=env)
    assert rejected.returncode == 1
    assert "当前路径不产出验收契约" in rejected.stderr

    state_before_rejected_next = (feature / "state.yaml").read_bytes()
    rejected_with_next = run_script(
        FLOW_GUARD,
        "freeze",
        "LCV-116",
        "acceptance",
        "--next",
        "acceptance_first",
        env=env,
    )
    unchanged_state = yaml.safe_load(
        (feature / "state.yaml").read_text(encoding="utf-8")
    )
    assert rejected_with_next.returncode == 1
    assert "--next 只允许在冻结 solution 时使用" in rejected_with_next.stderr
    assert unchanged_state["route"] == "direct_build"
    assert unchanged_state["phase"] == "implementation"
    assert unchanged_state["artifacts"]["acceptance"]["frozen"] is False
    assert (feature / "state.yaml").read_bytes() == state_before_rejected_next


def test_route_switch_to_acceptance_first_requires_acceptance_before_implementation(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-117"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-117", env=env).returncode == 0
    (feature / "solution.md").write_text("solution v1", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD, "freeze", "LCV-117", "solution", "--next", "direct_build", env=env
        ).returncode
        == 0
    )

    switched = run_script(FLOW_GUARD, "route", "LCV-117", "acceptance_first", env=env)
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    blocked = run_script(FLOW_GUARD, "check", "LCV-117", "implementation", env=env)

    assert switched.returncode == 0, switched.stderr
    assert state["route"] == "acceptance_first"
    assert state["phase"] == "acceptance"
    assert blocked.returncode == 1
    assert "acceptance 尚未冻结" in blocked.stderr

    (feature / "acceptance.feature").write_text("Feature: v1", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-117", "acceptance", env=env).returncode == 0

    back = run_script(FLOW_GUARD, "route", "LCV-117", "direct_build", env=env)
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert back.returncode == 0, back.stderr
    assert state["artifacts"]["acceptance"]["frozen"] is False
    assert state["phase"] == "implementation"


def test_route_cannot_be_selected_before_solution_is_frozen(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-118", env=env).returncode == 0
    rejected = run_script(FLOW_GUARD, "route", "LCV-118", "direct_build", env=env)

    assert rejected.returncode == 1
    assert "方案文档尚未冻结" in rejected.stderr


def test_flow_migration_maps_legacy_lane_to_acceptance_first_route(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-119"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-119", env=env).returncode == 0
    (feature / "solution.md").write_text("solution v1", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD, "freeze", "LCV-119", "solution", "--next", "acceptance_first", env=env
        ).returncode
        == 0
    )

    state_file = feature / "state.yaml"
    state = yaml.safe_load(state_file.read_text(encoding="utf-8"))
    state["schema_version"] = 6
    state["lane"] = "L3"
    state.pop("route")
    state_file.write_text(yaml.safe_dump(state, allow_unicode=True, sort_keys=False), encoding="utf-8")

    status = run_script(FLOW_GUARD, "status", "LCV-119", env=env)
    migrated = yaml.safe_load(state_file.read_text(encoding="utf-8"))

    assert status.returncode == 0, status.stderr
    assert migrated["schema_version"] == 7
    assert "lane" not in migrated
    assert migrated["route"] == "acceptance_first"
    assert migrated["phase"] == "acceptance"


def test_flow_init_allows_missing_source_issue_as_normal_input(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD, "init", "LOCAL-20260802-WORKFLOW", env=env
    )
    state = yaml.safe_load(
        (specs_root / "LOCAL-20260802-WORKFLOW" / "state.yaml").read_text(
            encoding="utf-8"
        )
    )
    status = run_script(
        FLOW_GUARD, "status", "LOCAL-20260802-WORKFLOW", env=env
    )

    assert initialized.returncode == 0, initialized.stderr
    assert state["schema_version"] == 7
    assert state["source_issue"] is None
    assert state["verification"]["verified"] is False
    assert state["quality_review"]["passed"] is False
    assert status.returncode == 0, status.stderr
    assert "待读：有效来源材料与用户确认补充" in status.stdout
    assert "关联 Issue：无" in status.stdout
    assert "当前请求或其他已确认材料可作为需求来源" in status.stdout
    assert "不阻止后续阶段" in status.stdout


def test_flow_init_records_source_issue_without_platform_fields(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--source-issue",
        "https://example.invalid/issues/LCV-102",
        env=env,
    )
    state = yaml.safe_load((specs_root / "LCV-102" / "state.yaml").read_text(encoding="utf-8"))
    status = run_script(FLOW_GUARD, "status", "LCV-102", env=env)

    assert initialized.returncode == 0, initialized.stderr
    assert state["source_issue"] == "https://example.invalid/issues/LCV-102"
    assert "source" not in state
    assert "关联 Issue：https://example.invalid/issues/LCV-102" in status.stdout
    assert "存在时完整读取，作为可选追踪信息" in status.stdout
    assert "不执行外部漂移门禁" in status.stdout


def test_v3_state_migration_collapses_platform_fields_into_source_issue(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-102"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}
    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        env=env,
    )
    assert initialized.returncode == 0, initialized.stderr
    state_path = feature / "state.yaml"
    state = yaml.safe_load(state_path.read_text(encoding="utf-8"))
    state["schema_version"] = 3
    state.pop("source_issue")
    state["source"] = {
        "system": "multica",
        "issue_id": "issue-102",
        "workspace_id": "workspace-102",
    }
    state_path.write_text(yaml.safe_dump(state, allow_unicode=True), encoding="utf-8")

    status = run_script(FLOW_GUARD, "status", "LCV-102", env=env)
    migrated = yaml.safe_load(state_path.read_text(encoding="utf-8"))

    assert status.returncode == 0, status.stderr
    assert migrated["schema_version"] == 7
    assert migrated["source_issue"] == "multica://workspace-102/issue-102"
    assert "source" not in migrated


def test_flow_migration_drops_retired_technical_design_phase(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-103"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-103", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-103", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: v1", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-103", "acceptance", env=env).returncode == 0

    state_path = feature / "state.yaml"
    state = yaml.safe_load(state_path.read_text(encoding="utf-8"))
    state["schema_version"] = 5
    state["phase"] = "technical_design"
    state["artifacts"]["technical_design"] = {
        "file": "technical_design.md",
        "frozen": False,
        "sha256": None,
    }
    state_path.write_text(yaml.safe_dump(state, allow_unicode=True), encoding="utf-8")

    status = run_script(FLOW_GUARD, "status", "LCV-103", env=env)
    migrated = yaml.safe_load(state_path.read_text(encoding="utf-8"))

    assert status.returncode == 0, status.stderr
    assert migrated["schema_version"] == 7
    assert migrated["phase"] == "implementation"
    assert "technical_design" not in migrated["artifacts"]
    assert "下一站：implementation-execution" in status.stdout


def test_flow_migration_renames_brief_artifact_to_solution(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-104"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-104", env=env).returncode == 0
    solution = feature / "solution.md"
    solution.write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-104", "solution", "--next", "acceptance_first", env=env).returncode == 0
    solution.rename(feature / "brief.md")

    state_path = feature / "state.yaml"
    state = yaml.safe_load(state_path.read_text(encoding="utf-8"))
    state["schema_version"] = 5
    state["artifacts"] = {
        "brief": {**state["artifacts"]["solution"], "file": "brief.md"},
        "acceptance": state["artifacts"]["acceptance"],
    }
    state_path.write_text(yaml.safe_dump(state, allow_unicode=True), encoding="utf-8")

    status = run_script(FLOW_GUARD, "status", "LCV-104", env=env)
    migrated = yaml.safe_load(state_path.read_text(encoding="utf-8"))

    assert status.returncode == 0, status.stderr
    assert migrated["schema_version"] == 7
    assert "brief" not in migrated["artifacts"]
    assert migrated["artifacts"]["solution"]["file"] == "solution.md"
    assert migrated["artifacts"]["solution"]["frozen"] is True
    assert migrated["phase"] == "acceptance"
    assert solution.read_text(encoding="utf-8") == "solution"
    assert not (feature / "brief.md").exists()
    assert "下一站：acceptance-generator" in status.stdout


def test_flow_repairs_brief_file_left_by_earlier_v7_migration(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-120"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-120", env=env).returncode == 0
    solution = feature / "solution.md"
    solution.write_text("solution", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD,
            "freeze",
            "LCV-120",
            "solution",
            "--next",
            "acceptance_first",
            env=env,
        ).returncode
        == 0
    )
    solution.rename(feature / "brief.md")

    status = run_script(FLOW_GUARD, "status", "LCV-120", env=env)
    repaired = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert status.returncode == 0, status.stderr
    assert "已迁移旧版 brief.md 为 solution.md" in status.stderr
    assert repaired["schema_version"] == 7
    assert repaired["artifacts"]["solution"]["frozen"] is True
    assert solution.read_text(encoding="utf-8") == "solution"
    assert not (feature / "brief.md").exists()


def test_flow_v7_migration_removes_identical_brief_duplicate(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-125"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-125", env=env).returncode == 0
    solution = feature / "solution.md"
    solution.write_text("current solution", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD,
            "freeze",
            "LCV-125",
            "solution",
            "--next",
            "direct_build",
            env=env,
        ).returncode
        == 0
    )
    brief = feature / "brief.md"
    shutil.copyfile(solution, brief)

    status = run_script(FLOW_GUARD, "status", "LCV-125", env=env)

    assert status.returncode == 0, status.stderr
    assert "清理同内容冗余副本" in status.stderr
    assert solution.read_text(encoding="utf-8") == "current solution"
    assert not brief.exists()
    assert "下一站：implementation-execution" in status.stdout


def test_flow_v7_migration_refuses_conflicting_brief_and_solution_files(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-123"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-123", env=env).returncode == 0
    solution = feature / "solution.md"
    solution.write_text("current solution", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD,
            "freeze",
            "LCV-123",
            "solution",
            "--next",
            "acceptance_first",
            env=env,
        ).returncode
        == 0
    )
    brief = feature / "brief.md"
    brief.write_text("different legacy brief", encoding="utf-8")
    state_path = feature / "state.yaml"
    state_before = state_path.read_bytes()

    status = run_script(FLOW_GUARD, "status", "LCV-123", env=env)

    assert status.returncode == 2
    assert "brief.md 与 solution.md 同时存在且内容不同" in status.stderr
    assert brief.read_text(encoding="utf-8") == "different legacy brief"
    assert solution.read_text(encoding="utf-8") == "current solution"
    assert state_path.read_bytes() == state_before


def test_flow_migration_refuses_conflicting_brief_and_solution_files(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-122"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-122", env=env).returncode == 0
    solution = feature / "solution.md"
    solution.write_text("legacy solution", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD,
            "freeze",
            "LCV-122",
            "solution",
            "--next",
            "acceptance_first",
            env=env,
        ).returncode
        == 0
    )
    solution.rename(feature / "brief.md")
    solution.write_text("different solution", encoding="utf-8")
    state_path = feature / "state.yaml"
    state = yaml.safe_load(state_path.read_text(encoding="utf-8"))
    state["schema_version"] = 5
    state["artifacts"] = {
        "brief": {**state["artifacts"]["solution"], "file": "brief.md"},
        "acceptance": state["artifacts"]["acceptance"],
    }
    state_path.write_text(
        yaml.safe_dump(state, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    state_before = state_path.read_bytes()

    status = run_script(FLOW_GUARD, "status", "LCV-122", env=env)

    assert status.returncode == 2
    assert "brief.md 与 solution.md 同时存在且内容不同" in status.stderr
    assert (feature / "brief.md").read_text(encoding="utf-8") == "legacy solution"
    assert solution.read_text(encoding="utf-8") == "different solution"
    assert state_path.read_bytes() == state_before


def test_flow_init_rejects_empty_source_issue(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-103",
        "--source-issue",
        "",
        env=env,
    )

    assert initialized.returncode == 2
    assert "--source-issue 不能是空字符串" in initialized.stderr
    assert not (specs_root / "LCV-103" / "state.yaml").exists()


def test_flow_init_preserves_opaque_issue_reference(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-104",
        "--source-issue",
        "LCV-104",
        env=env,
    )

    state = yaml.safe_load((specs_root / "LCV-104" / "state.yaml").read_text(encoding="utf-8"))

    assert initialized.returncode == 0, initialized.stderr
    assert state["source_issue"] == "LCV-104"


def test_flow_init_treats_issue_urls_as_opaque_references(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    linear = run_script(
        FLOW_GUARD,
        "init",
        "LCV-105",
        "--source-issue",
        "https://linear.app/example/issue/LIN-105/example",
        env=env,
    )
    custom = run_script(
        FLOW_GUARD,
        "init",
        "LCV-105B",
        "--source-issue",
        "https://example.atlassian.net/browse/JIRA-105",
        env=env,
    )

    assert linear.returncode == 0, linear.stderr
    assert custom.returncode == 0, custom.stderr
    linear_state = yaml.safe_load(
        (specs_root / "LCV-105" / "state.yaml").read_text(encoding="utf-8")
    )
    custom_state = yaml.safe_load(
        (specs_root / "LCV-105B" / "state.yaml").read_text(encoding="utf-8")
    )
    assert (
        linear_state["source_issue"]
        == "https://linear.app/example/issue/LIN-105/example"
    )
    assert (
        custom_state["source_issue"]
        == "https://example.atlassian.net/browse/JIRA-105"
    )


def test_status_reports_next_action_and_rejects_local_artifact_drift(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-106"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}
    assert run_script(FLOW_GUARD, "init", "LCV-106", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-106", "solution", "--next", "acceptance_first", env=env).returncode == 0

    status = run_script(FLOW_GUARD, "status", "LCV-106", env=env)
    assert status.returncode == 0, status.stderr
    assert "下一站：acceptance-generator" in status.stdout
    assert ".specs/LCV-106/solution.md" in status.stdout
    assert "npm run spec -- check LCV-106 acceptance" in status.stdout

    (feature / "solution.md").write_text("changed", encoding="utf-8")
    drifted = run_script(FLOW_GUARD, "status", "LCV-106", env=env)
    assert drifted.returncode == 1
    assert "本地状态不可信" in drifted.stderr
    assert "冻结后已变化" in drifted.stderr


def test_status_requires_selection_when_multiple_specs_are_active(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}
    assert run_script(FLOW_GUARD, "init", "LCV-107", env=env).returncode == 0
    assert run_script(FLOW_GUARD, "init", "LCV-108", env=env).returncode == 0

    status = run_script(FLOW_GUARD, "status", env=env)

    assert status.returncode == 0, status.stderr
    assert "有 2 个在途 Spec；请选择 KEY" in status.stdout
    assert "LCV-107" in status.stdout
    assert "LCV-108" in status.stdout


def test_flow_records_automatic_verification_and_quality_review(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-100"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }

    assert run_script(FLOW_GUARD, "init", "LCV-100", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-100", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-100", "acceptance", env=env).returncode == 0
    write_passing_manual_acceptance(feature / "manual_acceptance.md")

    implementation = run_script(FLOW_GUARD, "check", "LCV-100", "implementation", env=env)
    verified = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-100",
        "--run",
        successful_verification_command(),
        "--manual-acceptance",
        env=env,
    )
    review_status = run_script(FLOW_GUARD, "status", "LCV-100", env=env)
    reviewed = run_script(
        FLOW_GUARD,
        "review",
        "LCV-100",
        "--pass",
        "--evidence",
        "未发现阻断问题",
        env=env,
    )
    release_ready = run_script(
        FLOW_GUARD, "check", "LCV-100", "release_ready", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert implementation.returncode == 0, implementation.stderr
    assert verified.returncode == 0, verified.stderr
    assert review_status.returncode == 0, review_status.stderr
    assert "下一站：code-review-and-quality" in review_status.stdout
    assert reviewed.returncode == 0, reviewed.stderr
    assert release_ready.returncode == 0, release_ready.stderr
    assert state["phase"] == "release_ready"
    assert state["verification"]["commands"][0]["exit_code"] == 0
    assert state["verification"]["code_snapshot"]["sha256"]
    assert state["verification"]["manual_acceptance"]["result"] == "passed"
    assert state["quality_review"]["passed"] is True
    assert state["quality_review"]["code_snapshot_sha256"] == state["verification"][
        "code_snapshot"
    ]["sha256"]

    with (feature / "manual_acceptance.md").open("a", encoding="utf-8") as handle:
        handle.write("\n补充备注\n")
    manual_drift = run_script(
        FLOW_GUARD, "check", "LCV-100", "release_ready", env=env
    )
    assert manual_drift.returncode == 1
    assert "人工验收记录在验证后发生变化" in manual_drift.stderr


def test_status_omits_release_ready_specs_unless_key_is_explicit(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-114"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }
    assert run_script(FLOW_GUARD, "init", "LCV-114", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-114", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-114", "acceptance", env=env).returncode == 0
    assert run_script(
        FLOW_GUARD,
        "verify",
        "LCV-114",
        "--run",
        successful_verification_command(),
        env=env,
    ).returncode == 0
    assert run_script(FLOW_GUARD, "review", "LCV-114", "--pass", env=env).returncode == 0

    default_status = run_script(FLOW_GUARD, "status", env=env)
    explicit_status = run_script(FLOW_GUARD, "status", "LCV-114", env=env)

    assert default_status.returncode == 0, default_status.stderr
    assert "当前没有在途本地 Spec" in default_status.stdout
    assert explicit_status.returncode == 0, explicit_status.stderr
    assert "phase=release_ready" in explicit_status.stdout
    assert "下一站：branch-pr-workflow" in explicit_status.stdout


def test_failed_verification_command_does_not_advance_state(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-110"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }
    assert run_script(FLOW_GUARD, "init", "LCV-110", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-110", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-110", "acceptance", env=env).returncode == 0

    failed = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-110",
        "--run",
        failed_verification_command(),
        env=env,
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert failed.returncode == 1
    assert "已撤销旧验证与质量审查状态" in failed.stderr
    assert state["phase"] == "implementation"
    assert state["verification"]["verified"] is False
    assert state["verification"]["commands"][0]["exit_code"] == 7


def test_failed_reverification_revokes_previous_verification_and_review(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-121"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }
    assert run_script(FLOW_GUARD, "init", "LCV-121", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD,
            "freeze",
            "LCV-121",
            "solution",
            "--next",
            "direct_build",
            env=env,
        ).returncode
        == 0
    )
    assert (
        run_script(
            FLOW_GUARD,
            "verify",
            "LCV-121",
            "--run",
            successful_verification_command(),
            env=env,
        ).returncode
        == 0
    )
    assert (
        run_script(FLOW_GUARD, "review", "LCV-121", "--pass", env=env).returncode
        == 0
    )

    failed = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-121",
        "--run",
        failed_verification_command(),
        env=env,
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    status = run_script(FLOW_GUARD, "status", "LCV-121", env=env)

    assert failed.returncode == 1
    assert "已撤销旧验证与质量审查状态" in failed.stderr
    assert state["phase"] == "implementation"
    assert state["verification"]["verified"] is False
    assert state["verification"]["commands"][0]["exit_code"] == 7
    assert state["quality_review"]["passed"] is False
    assert status.returncode == 0, status.stderr
    assert "下一站：implementation-execution" in status.stdout


def test_reverification_with_drifted_solution_revokes_previous_trusted_state(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-124"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }
    assert run_script(FLOW_GUARD, "init", "LCV-124", env=env).returncode == 0
    solution = feature / "solution.md"
    solution.write_text("solution v1", encoding="utf-8")
    assert (
        run_script(
            FLOW_GUARD,
            "freeze",
            "LCV-124",
            "solution",
            "--next",
            "direct_build",
            env=env,
        ).returncode
        == 0
    )
    assert (
        run_script(
            FLOW_GUARD,
            "verify",
            "LCV-124",
            "--run",
            successful_verification_command(),
            env=env,
        ).returncode
        == 0
    )
    assert (
        run_script(FLOW_GUARD, "review", "LCV-124", "--pass", env=env).returncode
        == 0
    )
    solution.write_text("solution v2", encoding="utf-8")

    failed = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-124",
        "--run",
        successful_verification_command(),
        env=env,
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    default_status = run_script(FLOW_GUARD, "status", env=env)

    assert failed.returncode == 1
    assert "solution 冻结后已变化" in failed.stderr
    assert "已撤销旧验证与质量审查状态" in failed.stderr
    assert state["phase"] == "implementation"
    assert state["verification"]["verified"] is False
    assert state["quality_review"]["passed"] is False
    assert default_status.returncode == 1
    assert "LCV-124: 本地状态不可信" in default_status.stderr


def test_verification_command_that_changes_code_does_not_advance_state(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-115"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }
    assert run_script(FLOW_GUARD, "init", "LCV-115", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-115", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-115", "acceptance", env=env).returncode == 0

    blocked = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-115",
        "--run",
        repository_mutating_verification_command(),
        env=env,
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert blocked.returncode == 1
    assert "验证命令改变了可提交内容" in blocked.stderr
    assert state["phase"] == "implementation"
    assert state["verification"]["verified"] is False


def test_code_change_invalidates_review_and_reverify_resets_it(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-111"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }
    assert run_script(FLOW_GUARD, "init", "LCV-111", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-111", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-111", "acceptance", env=env).returncode == 0
    assert run_script(
        FLOW_GUARD,
        "verify",
        "LCV-111",
        "--run",
        successful_verification_command(),
        env=env,
    ).returncode == 0

    subprocess.run(
        [
            "git",
            "-c",
            "user.name=LinkCV Tests",
            "-c",
            "user.email=tests@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "empty commit",
        ],
        cwd=verification_root,
        check=True,
    )
    reviewed = run_script(FLOW_GUARD, "review", "LCV-111", "--pass", env=env)
    assert reviewed.returncode == 0, reviewed.stderr

    (verification_root / "tracked.txt").write_text("changed\n", encoding="utf-8")
    drifted = run_script(FLOW_GUARD, "status", "LCV-111", env=env)
    assert drifted.returncode == 1
    assert "验证后代码内容已变化" in drifted.stderr

    reverified = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-111",
        "--run",
        successful_verification_command(),
        env=env,
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    assert reverified.returncode == 0, reverified.stderr
    assert state["phase"] == "quality_review"
    assert state["quality_review"]["passed"] is False


def test_manual_acceptance_must_have_no_failed_or_pending_items(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-112"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }
    assert run_script(FLOW_GUARD, "init", "LCV-112", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-112", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-112", "acceptance", env=env).returncode == 0
    write_passing_manual_acceptance(feature / "manual_acceptance.md")
    manual = feature / "manual_acceptance.md"
    manual.write_text(
        manual.read_text(encoding="utf-8").replace("失败 `0`", "失败 `1`"),
        encoding="utf-8",
    )

    blocked = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-112",
        "--run",
        successful_verification_command(),
        "--manual-acceptance",
        env=env,
    )
    assert blocked.returncode == 1
    assert "仍有失败、阻塞或未执行项" in blocked.stderr


def test_legacy_verified_state_is_migrated_and_requires_reverification(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-113"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}
    assert run_script(FLOW_GUARD, "init", "LCV-113", env=env).returncode == 0
    (feature / "solution.md").write_text("solution", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-113", "solution", "--next", "acceptance_first", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-113", "acceptance", env=env).returncode == 0
    state_path = feature / "state.yaml"
    state = yaml.safe_load(state_path.read_text(encoding="utf-8"))
    state.pop("schema_version")
    state.pop("quality_review")
    state["phase"] = "done"
    state["verification"] = {
        "verified": True,
        "evidence": ["npm run check"],
        "verified_at": "2026-07-21T00:00:00+00:00",
    }
    state_path.write_text(yaml.safe_dump(state, allow_unicode=True), encoding="utf-8")

    status = run_script(FLOW_GUARD, "status", "LCV-113", env=env)
    migrated = yaml.safe_load(state_path.read_text(encoding="utf-8"))

    assert status.returncode == 0, status.stderr
    assert "已自动升级" in status.stderr
    assert "下一站：implementation-execution" in status.stdout
    assert migrated["schema_version"] == 7
    assert migrated["phase"] == "implementation"
    assert migrated["verification"]["verified"] is False
    assert migrated["verification"]["legacy_evidence"] == ["npm run check"]


def test_docs_sync_reports_missing_required_documents() -> None:
    result = run_script(
        DOCS_SYNC,
        "--files",
        "apps/backend/src/linkcv/api/routes/health.py",
    )

    assert result.returncode == 1
    assert "fastapi-http-contract" in result.stderr
    assert "docs/api/http-contracts.md" in result.stderr
    assert "docs/internals/backend.md" in result.stderr


def test_docs_sync_accepts_complete_companion_updates() -> None:
    result = run_script(
        DOCS_SYNC,
        "--files",
        "apps/backend/src/linkcv/api/routes/health.py",
        "docs/api/http-contracts.md",
        "docs/internals/backend.md",
    )

    assert result.returncode == 0, result.stderr


def test_runtime_contracts_match_current_repository() -> None:
    result = run_script(RUNTIME_CONTRACTS)

    assert result.returncode == 0, result.stderr
    assert "14 组运行时契约" in result.stdout


def test_runtime_contracts_report_drift(tmp_path: Path) -> None:
    rules = yaml.safe_load(RUNTIME_CONTRACT_RULES.read_text(encoding="utf-8"))
    target_rules = tmp_path / "scripts" / "quality" / "runtime-contract-rules.yaml"
    target_rules.parent.mkdir(parents=True)
    shutil.copy2(RUNTIME_CONTRACT_RULES, target_rules)

    for contract in rules["contracts"]:
        for assertion in contract["assertions"]:
            relative = Path(assertion["path"])
            target = tmp_path / relative
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(REPO_ROOT / relative, target)

    backend_config = (
        tmp_path / "apps" / "backend" / "src" / "linkcv" / "core" / "config.py"
    )
    backend_config.write_text(
        backend_config.read_text(encoding="utf-8").replace(
            'default=8000, alias="BACKEND_PORT"',
            'default=8010, alias="BACKEND_PORT"',
        ),
        encoding="utf-8",
    )

    result = run_script(
        RUNTIME_CONTRACTS,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "fastapi-default-port" in result.stderr
    assert "apps/backend/src/linkcv/core/config.py" in result.stderr


def test_skill_check_rejects_unowned_ai_top_level_entry(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "skills").mkdir(parents=True)
    (tmp_path / ".ai" / "references").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    (tmp_path / ".ai" / "skills" / "README.md").write_text(
        "skills", encoding="utf-8"
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert ".ai 顶层含未归属目录或文件" in result.stderr
    assert "长期知识应放 docs" in result.stderr


def test_skill_check_accepts_linkcv_backend_test_paths(tmp_path: Path) -> None:
    skill_root = tmp_path / ".ai" / "skills" / "test-authoring"
    skill_root.mkdir(parents=True)
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    (tmp_path / ".ai" / "skills" / "README.md").write_text(
        "skills", encoding="utf-8"
    )
    (skill_root / "SKILL.md").write_text(
        """---
name: test-authoring
description: 为 LinkCV 后端单元和集成测试提供真实路径及清晰的触发条件说明，适用于需要补充测试覆盖或调整测试分层的请求。
---

测试放在 `apps/backend/tests/unit/` 和 `apps/backend/tests/integration/`。
""",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 0, result.stderr


def test_skill_check_rejects_solution_template_without_required_capability(tmp_path: Path) -> None:
    protected_markers = (
        "### 1. 需求描述",
        "### 5. 状态机",
        "### 7. 数据模型",
        "#### 9.3 代码实施计划",
        "### 14. 验证与验收",
    )

    for index, marker in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / "solution-generator"
        target_skill = skills_root / "solution-generator"
        shutil.copytree(source_skill, target_skill)
        template_file = target_skill / "solution.template.md"
        template_file.write_text(
            template_file.read_text(encoding="utf-8").replace(
                marker, f"### 已删除能力 {index}"
            ),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "方案模板缺少完整章节库或施工能力" in result.stderr
        assert marker in result.stderr


def test_skill_check_rejects_solution_skill_without_on_demand_contract(tmp_path: Path) -> None:
    protected_markers = (
        "未命中的章节整章删除",
        "必须保留状态机",
        "必须保留数据模型",
        "没有 Issue 不阻止创建方案，也不算例外",
        "没有真实待决选择的短方案，整份展示一次并确认一次",
        "冻结阶段直接复用该选择",
    )

    for index, marker in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / "solution-generator"
        target_skill = skills_root / "solution-generator"
        shutil.copytree(source_skill, target_skill)
        skill_file = target_skill / "SKILL.md"
        skill_file.write_text(
            skill_file.read_text(encoding="utf-8").replace(
                marker,
                f"核心规则已删除 {index}",
            ),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "方案生成规则缺少按需施工契约" in result.stderr
        assert marker in result.stderr


def test_skill_check_rejects_fixed_solution_section_in_downstream_skill(
    tmp_path: Path,
) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    for skill_name in ("solution-generator", "acceptance-generator"):
        shutil.copytree(
            REPO_ROOT / ".ai" / "skills" / skill_name,
            skills_root / skill_name,
        )
    skill_file = skills_root / "acceptance-generator" / "SKILL.md"
    skill_file.write_text(
        skill_file.read_text(encoding="utf-8")
        + "\n验证方式读取方案文档 9.3。\n",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "acceptance-generator: 方案流程规则仍依赖 solution.md 固定章节号" in result.stderr
    assert "方案文档 9.3" in result.stderr


def test_skill_check_rejects_incomplete_flow_router_contract(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    source_skill = REPO_ROOT / ".ai" / "skills" / "flow-router"
    target_skill = skills_root / "flow-router"
    shutil.copytree(source_skill, target_skill)
    skill_file = target_skill / "SKILL.md"
    skill_file.write_text(
        skill_file.read_text(encoding="utf-8").replace(
            "默认只向用户展示三行", "默认展示完整七维表"
        ),
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "七维分流契约缺少必要内容" in result.stderr
    assert "默认只向用户展示三行" in result.stderr


def test_skill_check_protects_flow_router_core_semantics(tmp_path: Path) -> None:
    protected_markers = (
        "七个维度仍必须在内部完整判断",
        "没有 Issue 不阻止分流",
        "严格风险本身不自动升级为方案先行",
        "这是当前存储能力限制，不代表任务本身复杂",
        "不要由分流阶段提前主持方案讨论",
        "其他准备为 `需澄清` 或 `需调查` 的情况",
        "只有准备不足、风险严格、需要持久记录或用户主动要求查看判断依据时",
    )

    for index, marker in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / "flow-router"
        target_skill = skills_root / "flow-router"
        shutil.copytree(source_skill, target_skill)
        skill_file = target_skill / "SKILL.md"
        skill_file.write_text(
            skill_file.read_text(encoding="utf-8").replace(marker, "核心语义已删除"),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "七维分流契约缺少必要内容" in result.stderr
        assert marker in result.stderr


def test_skill_check_protects_five_reduction_contracts(tmp_path: Path) -> None:
    protected_cases = (
        (
            "module-planning",
            "SKILL.md",
            "没有 Issue 不阻塞模块规划",
        ),
        (
            "module-planning",
            "SKILL.md",
            "复用该授权，不再索要一遍相同指令",
        ),
        (
            "implementation-execution",
            "implementation_report.template.md",
            "## 2. 已接受限制",
        ),
        (
            "implementation-execution",
            "SKILL.md",
            "严格风险本身都不触发报告",
        ),
        (
            "run-all-tests",
            "SKILL.md",
            "**任务范围验证**",
        ),
        (
            "run-all-tests",
            "SKILL.md",
            "准备创建 PR 时始终运行完整 `npm run check`",
        ),
        (
            "branch-pr-workflow",
            "SKILL.md",
            "来源 Issue 是可选的追踪信息",
        ),
        (
            "code-review-and-quality",
            "SKILL.md",
            "`release_ready` 只代表同一代码快照完成了任务范围验证和质量审查",
        ),
    )

    for index, (skill_name, relative_file, marker) in enumerate(protected_cases):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        shutil.copytree(
            REPO_ROOT / ".ai" / "skills" / skill_name,
            skills_root / skill_name,
        )
        protected_file = skills_root / skill_name / relative_file
        protected_file.write_text(
            protected_file.read_text(encoding="utf-8").replace(
                marker, f"减法契约已删除 {index}"
            ),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "五项减法契约缺少必要内容" in result.stderr
        assert marker in result.stderr


def test_skill_check_protects_flow_router_downstream_contract(tmp_path: Path) -> None:
    protected_markers = (
        (
            "implementation-execution",
            "方案先行任务以冻结方案文档为准；"
            "直接实现以来源材料、当前确认结论和 `flow-router` 列出的严格检查项为准",
            "实现入口或实施报告契约缺少必要内容",
        ),
        (
            "implementation-execution",
            "不因选择影响大就自动升级为模块规划",
            "实现入口或实施报告契约缺少必要内容",
        ),
        (
            "contract-guard",
            "其他单需求分歧返回 `flow-router` 重新判断，"
            "已经明确属于方案先行时直接交 `solution-generator` 定稿",
            "七维分流下游契约缺少必要内容",
        ),
    )

    for index, (skill_name, marker, expected_error) in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / skill_name
        target_skill = skills_root / skill_name
        shutil.copytree(source_skill, target_skill)
        skill_file = target_skill / "SKILL.md"
        skill_file.write_text(
            skill_file.read_text(encoding="utf-8").replace(marker, "核心语义已删除"),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert expected_error in result.stderr
        assert marker in result.stderr


def test_skill_check_rejects_legacy_flow_router_rule(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    source_skill = REPO_ROOT / ".ai" / "skills" / "flow-router"
    target_skill = skills_root / "flow-router"
    shutil.copytree(source_skill, target_skill)
    skill_file = target_skill / "SKILL.md"
    skill_file.write_text(
        skill_file.read_text(encoding="utf-8")
        + "\n任意一条不满足即判方案先行。\n",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "仍含旧的一票升级判据" in result.stderr
