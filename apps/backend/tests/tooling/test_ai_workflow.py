from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
FLOW_GUARD = REPO_ROOT / "scripts" / "spec" / "flow_guard.py"
SOURCE_GUARD = REPO_ROOT / "scripts" / "spec" / "source_guard.py"
LINK_SETUP = REPO_ROOT / "scripts" / "setup" / "setup_ai_links.py"
SKILL_CHECK = REPO_ROOT / "scripts" / "quality" / "check_skills.py"
DOCS_SYNC = REPO_ROOT / "scripts" / "quality" / "check_docs_sync.py"
RUNTIME_CONTRACTS = REPO_ROOT / "scripts" / "quality" / "check_runtime_contracts.py"
RUNTIME_CONTRACT_RULES = REPO_ROOT / "scripts" / "quality" / "runtime-contract-rules.yaml"


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


def write_fake_multica(tmp_path: Path, payload: dict[str, object]) -> tuple[Path, Path]:
    response = tmp_path / "multica-response.json"
    response.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    executable = tmp_path / "multica"
    executable.write_text(
        "#!/usr/bin/env python3\n"
        "import os\n"
        "from pathlib import Path\n"
        "print(Path(os.environ['LINKCV_MULTICA_RESPONSE']).read_text(encoding='utf-8'))\n",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return executable, response


def multica_issue(description: str, updated_at: str) -> dict[str, object]:
    return {
        "id": "00000000-0000-0000-0000-000000000102",
        "identifier": "LCV-102",
        "title": "虚构工作流需求",
        "description": description,
        "updated_at": updated_at,
    }


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


def test_flow_init_records_manual_source_by_default(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(FLOW_GUARD, "init", "LCV-101", "--lane", "L2", env=env)
    state = yaml.safe_load((specs_root / "LCV-101" / "state.yaml").read_text(encoding="utf-8"))

    assert initialized.returncode == 0, initialized.stderr
    assert state["source"]["system"] == "manual"
    assert state["source"]["issue_id"] is None


def test_flow_init_records_explicit_external_source(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--lane",
        "L3",
        "--source-system",
        "multica",
        "--issue-id",
        "00000000-0000-0000-0000-000000000102",
        "--workspace-id",
        "00000000-0000-0000-0000-000000000001",
        env=env,
    )
    state = yaml.safe_load((specs_root / "LCV-102" / "state.yaml").read_text(encoding="utf-8"))
    status = run_script(FLOW_GUARD, "status", "LCV-102", env=env)

    assert initialized.returncode == 0, initialized.stderr
    assert state["source"]["system"] == "multica"
    assert state["source"]["issue_id"] == "00000000-0000-0000-0000-000000000102"
    assert state["source"]["workspace_id"] == "00000000-0000-0000-0000-000000000001"
    assert "需求源：尚未捕获基线" in status.stdout


def test_flow_init_rejects_external_source_without_issue_id(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-103",
        "--lane",
        "L2",
        "--source-system",
        "github",
        env=env,
    )

    assert initialized.returncode == 2
    assert "必须提供 --issue-id" in initialized.stderr
    assert not (specs_root / "LCV-103" / "state.yaml").exists()


def test_flow_init_rejects_multica_without_workspace_id(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-104",
        "--lane",
        "L2",
        "--source-system",
        "multica",
        "--issue-id",
        "issue-104",
        env=env,
    )

    assert initialized.returncode == 2
    assert "--workspace-id" in initialized.stderr


def test_multica_source_drift_invalidates_frozen_artifacts(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-102"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("初始范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--lane",
        "L2",
        "--source-system",
        "multica",
        "--issue-id",
        "00000000-0000-0000-0000-000000000102",
        "--workspace-id",
        "00000000-0000-0000-0000-000000000001",
        env=env,
    ).returncode == 0

    capture = run_script(SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env)
    assert capture.returncode == 0, capture.stderr
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-102", "brief", env=env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "acceptance", env=env
    ).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(
        FLOW_GUARD, "freeze", "LCV-102", "acceptance", env=env
    ).returncode == 0

    response.write_text(
        json.dumps(
            multica_issue("已经改变的范围", "2026-07-22T01:00:00Z"),
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    drifted = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "implementation", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert drifted.returncode == 1
    assert "需求" in drifted.stderr and "漂移" in drifted.stderr
    assert state["phase"] == "brief"
    assert state["source"]["drift"]["detected"] is True
    assert state["artifacts"]["brief"]["frozen"] is False
    assert state["artifacts"]["acceptance"]["frozen"] is False

    accepted = run_script(
        SOURCE_GUARD, "accept", "LCV-102", "--gate", "brief", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    assert accepted.returncode == 0, accepted.stderr
    assert state["source"]["drift"]["detected"] is False
    assert state["source"]["checked_for"] == "brief"


def test_multica_source_query_failure_does_not_mark_gate(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("稳定范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--lane",
        "L2",
        "--source-system",
        "multica",
        "--issue-id",
        "00000000-0000-0000-0000-000000000102",
        "--workspace-id",
        "workspace-105",
        env=env,
    ).returncode == 0

    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    env["LINKCV_MULTICA_CLI"] = str(tmp_path / "missing-multica")
    checked = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "brief", env=env
    )
    state = yaml.safe_load(
        (specs_root / "LCV-102" / "state.yaml").read_text(encoding="utf-8")
    )

    assert checked.returncode == 2
    assert "状态未核验" in checked.stderr
    assert state["source"]["checked_for"] is None


def test_multica_metadata_change_does_not_invalidate_requirements(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("范围不变", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--lane",
        "L2",
        "--source-system",
        "multica",
        "--issue-id",
        "00000000-0000-0000-0000-000000000102",
        "--workspace-id",
        "00000000-0000-0000-0000-000000000001",
        env=env,
    ).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0

    response.write_text(
        json.dumps(
            multica_issue("范围不变", "2026-07-22T01:00:00Z"), ensure_ascii=False
        ),
        encoding="utf-8",
    )
    checked = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "brief", env=env
    )

    assert checked.returncode == 0, checked.stderr
    assert "元数据变化但需求正文未漂移" in checked.stdout


def test_multica_requires_a_fresh_checkpoint_at_each_delivery_gate(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-102"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("稳定范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--lane",
        "L2",
        "--source-system",
        "multica",
        "--issue-id",
        "00000000-0000-0000-0000-000000000102",
        "--workspace-id",
        "00000000-0000-0000-0000-000000000001",
        env=env,
    ).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-102", "brief", env=env).returncode == 0

    acceptance_blocked = run_script(
        FLOW_GUARD, "check", "LCV-102", "acceptance", env=env
    )
    assert acceptance_blocked.returncode == 1
    assert "--gate acceptance" in acceptance_blocked.stderr
    assert run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "acceptance", env=env
    ).returncode == 0
    assert run_script(
        FLOW_GUARD, "check", "LCV-102", "acceptance", env=env
    ).returncode == 0

    (feature / "acceptance.feature").write_text("Feature: stable", encoding="utf-8")
    assert run_script(
        FLOW_GUARD, "freeze", "LCV-102", "acceptance", env=env
    ).returncode == 0
    implementation_blocked = run_script(
        FLOW_GUARD, "check", "LCV-102", "implementation", env=env
    )
    assert implementation_blocked.returncode == 1
    assert "--gate implementation" in implementation_blocked.stderr
    assert run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "implementation", env=env
    ).returncode == 0
    assert run_script(
        FLOW_GUARD, "check", "LCV-102", "implementation", env=env
    ).returncode == 0

    verification_blocked = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-102",
        "--evidence",
        "npm run check",
        env=env,
    )
    assert verification_blocked.returncode == 1
    assert "--gate verification" in verification_blocked.stderr
    assert run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "verification", env=env
    ).returncode == 0
    assert run_script(
        FLOW_GUARD,
        "verify",
        "LCV-102",
        "--evidence",
        "npm run check",
        env=env,
    ).returncode == 0

    release_blocked = run_script(FLOW_GUARD, "check", "LCV-102", "done", env=env)
    assert release_blocked.returncode == 1
    assert "--gate release" in release_blocked.stderr
    assert run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "release", env=env
    ).returncode == 0
    assert run_script(FLOW_GUARD, "check", "LCV-102", "done", env=env).returncode == 0


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


def test_l2_flow_skips_technical_design_and_records_evidence(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-100"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-100", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-100", "brief", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-100", "acceptance", env=env).returncode == 0
    (feature / "manual_acceptance.md").write_text(
        "# 人工验收\n\n结论：通过\n", encoding="utf-8"
    )

    implementation = run_script(FLOW_GUARD, "check", "LCV-100", "implementation", env=env)
    verified = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-100",
        "--evidence",
        "npm run check",
        "--evidence",
        "人工验收：.specs/LCV-100/manual_acceptance.md（通过）",
        env=env,
    )
    done = run_script(FLOW_GUARD, "check", "LCV-100", "done", env=env)
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert implementation.returncode == 0, implementation.stderr
    assert verified.returncode == 0, verified.stderr
    assert done.returncode == 0, done.stderr
    assert state["verification"]["evidence"] == [
        "npm run check",
        "人工验收：.specs/LCV-100/manual_acceptance.md（通过）",
    ]


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
    assert "4 组运行时契约" in result.stdout


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

    package_file = tmp_path / "package.json"
    package_file.write_text(
        package_file.read_text(encoding="utf-8").replace(
            "BACKEND_PORT:-8000", "BACKEND_PORT:-8010"
        ),
        encoding="utf-8",
    )

    result = run_script(
        RUNTIME_CONTRACTS,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "fastapi-default-port" in result.stderr
    assert "package.json" in result.stderr


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
