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


def test_l3_flow_requires_frozen_artifacts_and_detects_drift(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(FLOW_GUARD, "init", "LCV-99", "--lane", "L3", env=env)
    blocked = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert initialized.returncode == 0, initialized.stderr
    assert blocked.returncode == 1
    assert "brief 尚未冻结" in blocked.stderr

    brief = specs_root / "LCV-99" / "brief.md"
    brief.write_text("# Brief\n", encoding="utf-8")
    frozen = run_script(FLOW_GUARD, "freeze", "LCV-99", "brief", env=env)
    allowed = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert frozen.returncode == 0, frozen.stderr
    assert allowed.returncode == 0, allowed.stderr

    brief.write_text("# Changed Brief\n", encoding="utf-8")
    drifted = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert drifted.returncode == 1
    assert "冻结后已变化" in drifted.stderr


def test_l3_flow_requires_technical_design_and_refreeze_invalidates_downstream(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-109"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-109", "--lane", "L3", env=env).returncode == 0
    (feature / "brief.md").write_text("brief v1", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-109", "brief", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: v1", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-109", "acceptance", env=env).returncode == 0

    blocked = run_script(FLOW_GUARD, "check", "LCV-109", "implementation", env=env)
    status = run_script(FLOW_GUARD, "status", "LCV-109", env=env)

    assert blocked.returncode == 1
    assert "当前 phase=technical_design" in blocked.stderr
    assert status.returncode == 0, status.stderr
    assert "下一站：technical-design" in status.stdout

    (feature / "technical_design.md").write_text("technical v1", encoding="utf-8")
    assert run_script(
        FLOW_GUARD, "freeze", "LCV-109", "technical_design", env=env
    ).returncode == 0
    allowed = run_script(FLOW_GUARD, "check", "LCV-109", "implementation", env=env)
    assert allowed.returncode == 0, allowed.stderr

    (feature / "brief.md").write_text("brief v2", encoding="utf-8")
    refrozen = run_script(
        FLOW_GUARD, "freeze", "LCV-109", "brief", "--refreeze", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert refrozen.returncode == 0, refrozen.stderr
    assert state["phase"] == "acceptance"
    assert state["artifacts"]["brief"]["frozen"] is True
    assert state["artifacts"]["acceptance"]["frozen"] is False
    assert state["artifacts"]["technical_design"]["frozen"] is False
    assert state["verification"]["verified"] is False
    assert state["quality_review"]["passed"] is False


def test_flow_init_allows_missing_source_issue_for_explicit_exceptions(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(FLOW_GUARD, "init", "LCV-101", "--lane", "L2", env=env)
    state = yaml.safe_load((specs_root / "LCV-101" / "state.yaml").read_text(encoding="utf-8"))

    assert initialized.returncode == 0, initialized.stderr
    assert state["schema_version"] == 4
    assert state["source_issue"] is None
    assert state["verification"]["verified"] is False
    assert state["quality_review"]["passed"] is False


def test_flow_init_records_source_issue_without_platform_fields(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--lane",
        "L3",
        "--source-issue",
        "https://example.invalid/issues/LCV-102",
        env=env,
    )
    state = yaml.safe_load((specs_root / "LCV-102" / "state.yaml").read_text(encoding="utf-8"))
    status = run_script(FLOW_GUARD, "status", "LCV-102", env=env)

    assert initialized.returncode == 0, initialized.stderr
    assert state["source_issue"] == "https://example.invalid/issues/LCV-102"
    assert "source" not in state
    assert "来源 Issue：https://example.invalid/issues/LCV-102" in status.stdout
    assert "正文是开发起点，详情文档按需补充" in status.stdout
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
        "--lane",
        "L2",
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
    assert migrated["schema_version"] == 4
    assert migrated["source_issue"] == "multica://workspace-102/issue-102"
    assert "source" not in migrated


def test_flow_init_rejects_empty_source_issue(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-103",
        "--lane",
        "L2",
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
        "--lane",
        "L2",
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
        "--lane",
        "L2",
        "--source-issue",
        "https://linear.app/example/issue/LIN-105/example",
        env=env,
    )
    custom = run_script(
        FLOW_GUARD,
        "init",
        "LCV-105B",
        "--lane",
        "L2",
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
    assert run_script(FLOW_GUARD, "init", "LCV-106", "--lane", "L3", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-106", "brief", env=env).returncode == 0

    status = run_script(FLOW_GUARD, "status", "LCV-106", env=env)
    assert status.returncode == 0, status.stderr
    assert "下一站：acceptance-generator" in status.stdout
    assert ".specs/LCV-106/brief.md" in status.stdout
    assert "npm run spec -- check LCV-106 acceptance" in status.stdout

    (feature / "brief.md").write_text("changed", encoding="utf-8")
    drifted = run_script(FLOW_GUARD, "status", "LCV-106", env=env)
    assert drifted.returncode == 1
    assert "本地状态不可信" in drifted.stderr
    assert "冻结后已变化" in drifted.stderr


def test_status_requires_selection_when_multiple_specs_are_active(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}
    assert run_script(FLOW_GUARD, "init", "LCV-107", "--lane", "L2", env=env).returncode == 0
    assert run_script(FLOW_GUARD, "init", "LCV-108", "--lane", "L3", env=env).returncode == 0

    status = run_script(FLOW_GUARD, "status", env=env)

    assert status.returncode == 0, status.stderr
    assert "有 2 个在途 Spec；请选择 KEY" in status.stdout
    assert "LCV-107" in status.stdout
    assert "LCV-108" in status.stdout


def test_l2_flow_records_automatic_verification_and_quality_review(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-100"
    verification_root = create_verification_repo(tmp_path)
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
    }

    assert run_script(FLOW_GUARD, "init", "LCV-100", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-100", "brief", env=env).returncode == 0
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
    assert run_script(FLOW_GUARD, "init", "LCV-114", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-114", "brief", env=env).returncode == 0
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
    assert run_script(FLOW_GUARD, "init", "LCV-110", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-110", "brief", env=env).returncode == 0
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
    assert "未更新验证状态" in failed.stderr
    assert state["phase"] == "implementation"
    assert state["verification"]["verified"] is False


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
    assert run_script(FLOW_GUARD, "init", "LCV-115", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-115", "brief", env=env).returncode == 0
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
    assert run_script(FLOW_GUARD, "init", "LCV-111", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-111", "brief", env=env).returncode == 0
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
    assert run_script(FLOW_GUARD, "init", "LCV-112", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-112", "brief", env=env).returncode == 0
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
    assert run_script(FLOW_GUARD, "init", "LCV-113", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-113", "brief", env=env).returncode == 0
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
    assert migrated["schema_version"] == 4
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
    assert "9 组运行时契约" in result.stdout


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


def test_skill_check_rejects_incomplete_brief_template(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    source_skill = REPO_ROOT / ".ai" / "skills" / "brief-generator"
    target_skill = skills_root / "brief-generator"
    shutil.copytree(source_skill, target_skill)
    template_file = target_skill / "brief.template.md"
    template_file.write_text(
        template_file.read_text(encoding="utf-8").replace(
            "## 3. 业务流程", "## 3. 实现说明"
        ),
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "Brief 模板缺少固定结构" in result.stderr
    assert "## 3. 业务流程" in result.stderr
