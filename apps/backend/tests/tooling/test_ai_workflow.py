from __future__ import annotations

import json
import os
import re
import shlex
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


def write_fake_multica(tmp_path: Path, payload: dict[str, object]) -> tuple[Path, Path]:
    response = tmp_path / "multica-response.json"
    response.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "multica-comments.json").write_text("[]", encoding="utf-8")
    executable = tmp_path / "multica"
    executable.write_text(
        "#!/usr/bin/env python3\n"
        "import json\n"
        "import os\n"
        "import sys\n"
        "from pathlib import Path\n"
        "response = Path(os.environ['LINKCV_MULTICA_RESPONSE'])\n"
        "comments_path = response.with_name('multica-comments.json')\n"
        "arguments = sys.argv[1:]\n"
        "if arguments[:3] == ['issue', 'comment', 'list']:\n"
        "    comments = json.loads(comments_path.read_text(encoding='utf-8'))\n"
        "    failure_marker = response.with_name('multica-list-failed-once')\n"
        "    if os.environ.get('LINKCV_MULTICA_FAIL_LIST_AFTER_ADD') and comments and not failure_marker.exists():\n"
        "        failure_marker.write_text('failed', encoding='utf-8')\n"
        "        raise SystemExit(7)\n"
        "    print(comments_path.read_text(encoding='utf-8'))\n"
        "elif arguments[:3] == ['issue', 'comment', 'add']:\n"
        "    if os.environ.get('LINKCV_MULTICA_FAIL_ADD'):\n"
        "        raise SystemExit(8)\n"
        "    content = sys.stdin.read()\n"
        "    comments = json.loads(comments_path.read_text(encoding='utf-8'))\n"
        "    comment = {\n"
        "        'id': f'comment-{len(comments) + 1}',\n"
        "        'content': content,\n"
        "        'created_at': f'2026-07-22T02:00:{len(comments):02d}Z',\n"
        "        'parent_id': None,\n"
        "    }\n"
        "    comments.append(comment)\n"
        "    comments_path.write_text(json.dumps(comments, ensure_ascii=False), encoding='utf-8')\n"
        "    response.with_name('multica-last-comment.txt').write_text(content, encoding='utf-8')\n"
        "    print(json.dumps(comment, ensure_ascii=False))\n"
        "else:\n"
        "    print(response.read_text(encoding='utf-8'))\n",
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


def multica_comments_path(tmp_path: Path) -> Path:
    return tmp_path / "multica-comments.json"


def structured_multica_comment(
    *,
    comment_id: str,
    base_hash: str,
    business_content: str = "新增：导出前必须展示确认页。",
    supersedes: list[str] | None = None,
) -> dict[str, object]:
    metadata = {
        "schema_version": 1,
        "producer": "linkcv-source-guard",
        "change_id": "00000000-0000-4000-8000-000000000001",
        "base_requirements_sha256": base_hash,
        "supersedes": supersedes or [],
        "confirmed_at": "2026-07-22T02:00:00+00:00",
    }
    return {
        "id": comment_id,
        "content": (
            "## LinkCV 已确认需求变更\n\n"
            f"{business_content}\n\n"
            "```linkcv-requirement-change\n"
            f"{json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}\n"
            "```"
        ),
        "created_at": "2026-07-22T02:00:00Z",
        "parent_id": None,
    }


def init_multica_spec(specs_root: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return run_script(
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


def test_flow_init_records_manual_source_by_default(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(FLOW_GUARD, "init", "LCV-101", "--lane", "L2", env=env)
    state = yaml.safe_load((specs_root / "LCV-101" / "state.yaml").read_text(encoding="utf-8"))

    assert initialized.returncode == 0, initialized.stderr
    assert state["schema_version"] == 2
    assert state["source"]["system"] == "manual"
    assert state["source"]["issue_id"] is None
    assert state["verification"]["verified"] is False
    assert state["quality_review"]["passed"] is False


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
    assert run_script(
        SOURCE_GUARD, "reconcile", "LCV-102", "--no-change", env=env
    ).returncode == 0
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
    assert "元数据变化但权威需求未漂移" in checked.stdout


def test_multica_requires_a_fresh_checkpoint_at_each_delivery_gate(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-102"
    verification_root = create_verification_repo(tmp_path)
    executable, response = write_fake_multica(
        tmp_path, multica_issue("稳定范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
        "LINKCV_VERIFICATION_ROOT": str(verification_root),
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
    assert run_script(
        SOURCE_GUARD, "reconcile", "LCV-102", "--no-change", env=env
    ).returncode == 0
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
        "--run",
        successful_verification_command(),
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
        "--run",
        successful_verification_command(),
        env=env,
    ).returncode == 0

    review_check = run_script(
        FLOW_GUARD, "check", "LCV-102", "quality_review", env=env
    )
    assert review_check.returncode == 0, review_check.stderr
    assert run_script(
        FLOW_GUARD,
        "review",
        "LCV-102",
        "--pass",
        "--evidence",
        "未发现阻断问题",
        env=env,
    ).returncode == 0

    release_blocked = run_script(
        FLOW_GUARD, "check", "LCV-102", "release_ready", env=env
    )
    assert release_blocked.returncode == 1
    assert "--gate release" in release_blocked.stderr
    assert run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "release", env=env
    ).returncode == 0
    assert run_script(
        FLOW_GUARD, "check", "LCV-102", "release_ready", env=env
    ).returncode == 0


def test_multica_ordinary_comments_do_not_change_authoritative_requirements(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("稳定范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    state_path = specs_root / "LCV-102" / "state.yaml"
    baseline = yaml.safe_load(state_path.read_text(encoding="utf-8"))["source"][
        "requirements_hash"
    ]
    multica_comments_path(tmp_path).write_text(
        json.dumps(
            [
                {
                    "id": "ordinary-1",
                    "content": "这个想法后续再讨论，不构成需求变更。",
                    "created_at": "2026-07-22T01:00:00Z",
                    "parent_id": None,
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    checked = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "brief", env=env
    )
    source = yaml.safe_load(state_path.read_text(encoding="utf-8"))["source"]

    assert checked.returncode == 0, checked.stderr
    assert source["requirements_hash"] == baseline
    assert source["change_comment_ids"] == []


def test_multica_structured_comment_is_authoritative_and_detects_drift(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("初始范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    state_path = specs_root / "LCV-102" / "state.yaml"
    baseline = yaml.safe_load(state_path.read_text(encoding="utf-8"))["source"][
        "requirements_hash"
    ]
    multica_comments_path(tmp_path).write_text(
        json.dumps(
            [structured_multica_comment(comment_id="change-1", base_hash=baseline)],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    checked = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "brief", env=env
    )
    state = yaml.safe_load(state_path.read_text(encoding="utf-8"))

    assert checked.returncode == 1
    assert "结构化变更评论" in checked.stderr
    assert state["source"]["drift"]["detected"] is True
    assert state["source"]["reconciliation"]["status"] == "pending"


def test_multica_malformed_structured_comment_fails_closed(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("初始范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    multica_comments_path(tmp_path).write_text(
        json.dumps(
            [
                {
                    "id": "broken-1",
                    "content": "## LinkCV 已确认需求变更\n\n缺少工具元数据",
                    "created_at": "2026-07-22T01:00:00Z",
                    "parent_id": None,
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    checked = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "brief", env=env
    )
    source = yaml.safe_load(
        (specs_root / "LCV-102" / "state.yaml").read_text(encoding="utf-8")
    )["source"]

    assert checked.returncode == 2
    assert "格式损坏" in checked.stderr
    assert source["checked_for"] is None


def test_multica_brief_freeze_requires_reconciliation_bound_to_current_brief(
    tmp_path: Path,
) -> None:
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
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    (feature / "brief.md").write_text("第一版 Brief", encoding="utf-8")

    unreconciled = run_script(FLOW_GUARD, "freeze", "LCV-102", "brief", env=env)
    assert unreconciled.returncode == 1
    assert "必须完成 Multica 需求对账" in unreconciled.stderr
    assert run_script(
        SOURCE_GUARD, "reconcile", "LCV-102", "--no-change", env=env
    ).returncode == 0

    (feature / "brief.md").write_text("第二版 Brief", encoding="utf-8")
    changed = run_script(FLOW_GUARD, "freeze", "LCV-102", "brief", env=env)
    assert changed.returncode == 1
    assert "对账后发生变化" in changed.stderr
    assert run_script(
        SOURCE_GUARD, "reconcile", "LCV-102", "--no-change", env=env
    ).returncode == 0
    assert run_script(
        FLOW_GUARD, "freeze", "LCV-102", "brief", env=env
    ).returncode == 0


def test_existing_multica_state_gets_reconciliation_without_schema_upgrade(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("初始范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
    }
    assert init_multica_spec(specs_root, env).returncode == 0
    state_path = specs_root / "LCV-102" / "state.yaml"
    state = yaml.safe_load(state_path.read_text(encoding="utf-8"))
    state["source"].pop("reconciliation")
    state_path.write_text(
        yaml.safe_dump(state, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )

    status = run_script(FLOW_GUARD, "status", "LCV-102", env=env)
    migrated = yaml.safe_load(state_path.read_text(encoding="utf-8"))

    assert status.returncode == 0, status.stderr
    assert migrated["schema_version"] == 2
    assert migrated["source"]["reconciliation"]["status"] == "pending"


def test_multica_sync_comment_requires_confirmation_and_maintains_metadata(
    tmp_path: Path,
) -> None:
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
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    (feature / "brief.md").write_text("Brief 增加导出确认页", encoding="utf-8")
    change_file = feature / "requirement_change.md"
    change_file.write_text(
        "本次确认新增导出确认页，避免用户直接导出错误内容。\n\n"
        "- 新增：导出前必须展示确认页。\n"
        "- 验收：用户确认后才开始导出。",
        encoding="utf-8",
    )

    blocked = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        env=env,
    )
    assert blocked.returncode == 2
    assert "--confirmed-by-user" in blocked.stderr
    assert json.loads(multica_comments_path(tmp_path).read_text(encoding="utf-8")) == []

    synced = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        env=env,
    )
    comments = json.loads(multica_comments_path(tmp_path).read_text(encoding="utf-8"))
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    metadata_match = re.search(
        r"```linkcv-requirement-change\n(\{.*\})\n```$", comments[0]["content"]
    )

    assert synced.returncode == 0, synced.stderr
    assert len(comments) == 1
    assert comments[0]["content"].startswith(
        "## LinkCV 已确认需求变更\n\n"
        "### 概述\n\n"
        "本次确认新增导出确认页，避免用户直接导出错误内容。"
    )
    assert "### 具体变化" in comments[0]["content"]
    assert "### 工具记录" in comments[0]["content"]
    assert metadata_match is not None
    metadata = json.loads(metadata_match.group(1))
    assert metadata["schema_version"] == 1
    assert metadata["producer"] == "linkcv-source-guard"
    assert metadata["change_id"]
    assert len(metadata["base_requirements_sha256"]) == 64
    assert metadata["supersedes"] == []
    assert state["source"]["fingerprint_version"] == 2
    assert state["source"]["change_comment_ids"] == ["comment-1"]
    assert state["source"]["reconciliation"]["status"] == "synced"
    assert state["source"]["reconciliation"]["comment_ids"] == ["comment-1"]
    assert run_script(
        FLOW_GUARD, "freeze", "LCV-102", "brief", env=env
    ).returncode == 0


def test_multica_sync_comment_appends_correction_and_tracks_superseded_comment(
    tmp_path: Path,
) -> None:
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
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    brief = feature / "brief.md"
    change_file = feature / "requirement-change.tmp.md"
    brief.write_text("Brief 第一版", encoding="utf-8")
    change_file.write_text("新增：导出前展示确认页。", encoding="utf-8")
    assert run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        env=env,
    ).returncode == 0

    brief.write_text("Brief 纠正版", encoding="utf-8")
    change_file.write_text(
        "本次修正确认页的出现条件，避免重复打断用户。\n\n"
        "- 修正：仅首次导出前展示确认页。",
        encoding="utf-8",
    )
    corrected = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        "--correct-latest",
        env=env,
    )
    comments = json.loads(multica_comments_path(tmp_path).read_text(encoding="utf-8"))
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    second_metadata = json.loads(
        re.search(
            r"```linkcv-requirement-change\n(\{.*\})\n```$",
            comments[1]["content"],
        ).group(1)
    )

    assert corrected.returncode == 0, corrected.stderr
    assert len(comments) == 2
    assert second_metadata["supersedes"] == ["comment-1"]
    assert state["source"]["change_comment_ids"] == ["comment-1", "comment-2"]
    assert state["source"]["active_change_comment_ids"] == ["comment-2"]
    assert state["source"]["reconciliation"]["comment_ids"] == ["comment-2"]

    help_result = run_script(SOURCE_GUARD, "sync-comment", "--help", env=env)
    assert help_result.returncode == 0
    assert "--correct-latest" in help_result.stdout
    assert "--supersedes" not in help_result.stdout

    multica_comments_path(tmp_path).write_text(
        json.dumps(list(reversed(comments)), ensure_ascii=False), encoding="utf-8"
    )
    reordered = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "brief", env=env
    )
    assert reordered.returncode == 0, reordered.stderr


def test_multica_correction_requires_an_active_comment(tmp_path: Path) -> None:
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
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    (feature / "brief.md").write_text("Brief 纠正版", encoding="utf-8")
    change_file = feature / "requirement-change.tmp.md"
    change_file.write_text("修正导出确认条件。", encoding="utf-8")

    corrected = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        "--correct-latest",
        env=env,
    )

    assert corrected.returncode == 2
    assert "至少一条当前有效" in corrected.stderr
    assert json.loads(multica_comments_path(tmp_path).read_text(encoding="utf-8")) == []


def test_multica_correction_automatically_selects_latest_active_comment(
    tmp_path: Path,
) -> None:
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
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    brief = feature / "brief.md"
    change_file = feature / "requirement-change.tmp.md"

    for index in (1, 2):
        brief.write_text(f"Brief 第 {index} 版", encoding="utf-8")
        change_file.write_text(f"新增第 {index} 项独立要求。", encoding="utf-8")
        assert run_script(
            SOURCE_GUARD,
            "sync-comment",
            "LCV-102",
            "--change-file",
            str(change_file),
            "--confirmed-by-user",
            env=env,
        ).returncode == 0

    brief.write_text("Brief 纠正版", encoding="utf-8")
    change_file.write_text("纠正最近确认的第 2 项要求。", encoding="utf-8")
    corrected = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        "--correct-latest",
        env=env,
    )
    comments = json.loads(multica_comments_path(tmp_path).read_text(encoding="utf-8"))
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    metadata = json.loads(
        re.search(
            r"```linkcv-requirement-change\n(\{.*\})\n```$",
            comments[2]["content"],
        ).group(1)
    )

    assert corrected.returncode == 0, corrected.stderr
    assert metadata["supersedes"] == ["comment-2"]
    assert state["source"]["active_change_comment_ids"] == [
        "comment-1",
        "comment-3",
    ]


def test_pr_template_starts_with_summary_and_keeps_issue_links_last() -> None:
    content = PR_TEMPLATE.read_text(encoding="utf-8")

    assert content.startswith("## 概述\n")
    assert content.index("## 概述") < content.index("## 背景与目标")
    assert "## 合并信息" not in content
    assert "目标分支" not in content
    assert "来源分支" not in content
    assert content.rstrip().endswith(
        '- GitHub Issue：<Issue 编号与链接；不适用时写“无”>'
    )


def test_multica_issue_body_can_change_after_structured_comments_and_be_accepted(
    tmp_path: Path,
) -> None:
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
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    (feature / "brief.md").write_text("Brief 第一版", encoding="utf-8")
    change_file = feature / "requirement-change.tmp.md"
    change_file.write_text("新增：导出前展示确认页。", encoding="utf-8")
    assert run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        env=env,
    ).returncode == 0

    response.write_text(
        json.dumps(
            multica_issue("正文补充了权限边界", "2026-07-22T03:00:00Z"),
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    drifted = run_script(
        SOURCE_GUARD, "check", "LCV-102", "--gate", "brief", env=env
    )
    accepted = run_script(
        SOURCE_GUARD, "accept", "LCV-102", "--gate", "brief", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert drifted.returncode == 1
    assert accepted.returncode == 0, accepted.stderr
    assert state["source"]["fingerprint_version"] == 2
    assert state["source"]["change_comment_ids"] == ["comment-1"]
    assert state["source"]["drift"]["detected"] is False


def test_multica_uncertain_write_is_recovered_without_duplicate_comment(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-102"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("初始范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
        "LINKCV_MULTICA_FAIL_LIST_AFTER_ADD": "1",
    }
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    (feature / "brief.md").write_text("Brief 第一版", encoding="utf-8")
    change_file = feature / "requirement-change.tmp.md"
    change_file.write_text("新增：导出前展示确认页。", encoding="utf-8")

    uncertain = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        env=env,
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))
    assert uncertain.returncode == 2
    assert "评论可能已成功" in uncertain.stderr
    assert state["source"]["reconciliation"]["status"] == "syncing"
    assert len(json.loads(multica_comments_path(tmp_path).read_text(encoding="utf-8"))) == 1

    duplicate = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        env=env,
    )
    recovered = run_script(
        SOURCE_GUARD, "recover-comment", "LCV-102", env=env
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert duplicate.returncode == 1
    assert "禁止重复追加" in duplicate.stderr
    assert recovered.returncode == 0, recovered.stderr
    assert len(json.loads(multica_comments_path(tmp_path).read_text(encoding="utf-8"))) == 1
    assert state["source"]["reconciliation"]["status"] == "synced"
    assert state["source"]["reconciliation"]["write_intent"] is None


def test_multica_failed_write_intent_requires_confirmed_absence_before_abandon(
    tmp_path: Path,
) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-102"
    executable, response = write_fake_multica(
        tmp_path, multica_issue("初始范围", "2026-07-21T01:00:00Z")
    )
    env = {
        "LINKCV_SPECS_ROOT": str(specs_root),
        "LINKCV_MULTICA_CLI": str(executable),
        "LINKCV_MULTICA_RESPONSE": str(response),
        "LINKCV_MULTICA_FAIL_ADD": "1",
    }
    assert init_multica_spec(specs_root, env).returncode == 0
    assert run_script(
        SOURCE_GUARD, "capture", "LCV-102", "--gate", "brief", env=env
    ).returncode == 0
    (feature / "brief.md").write_text("Brief 第一版", encoding="utf-8")
    change_file = feature / "requirement-change.tmp.md"
    change_file.write_text("新增：导出前展示确认页。", encoding="utf-8")
    failed = run_script(
        SOURCE_GUARD,
        "sync-comment",
        "LCV-102",
        "--change-file",
        str(change_file),
        "--confirmed-by-user",
        env=env,
    )
    assert failed.returncode == 2

    blocked = run_script(SOURCE_GUARD, "abandon-sync", "LCV-102", env=env)
    abandoned = run_script(
        SOURCE_GUARD,
        "abandon-sync",
        "LCV-102",
        "--confirmed-comment-absent",
        env=env,
    )
    state = yaml.safe_load((feature / "state.yaml").read_text(encoding="utf-8"))

    assert blocked.returncode == 2
    assert "--confirmed-comment-absent" in blocked.stderr
    assert abandoned.returncode == 0, abandoned.stderr
    assert state["source"]["reconciliation"]["status"] == "pending"
    assert state["source"]["reconciliation"]["write_intent"] is None


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
    assert migrated["schema_version"] == 2
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
