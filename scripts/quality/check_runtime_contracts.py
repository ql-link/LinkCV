#!/usr/bin/env python3
"""校验 LinkResume 当前可确定判断的运行时契约。"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml


REPO_ROOT = Path(
    os.environ.get("LINKRESUME_REPO_ROOT", Path(__file__).resolve().parents[2])
).resolve()
DEFAULT_CONFIG = REPO_ROOT / "scripts" / "quality" / "runtime-contract-rules.yaml"
PI_AGENT_RUNTIME = Path("apps/pi-service/src/runtime/agent.js")
BACKEND_AGENT_SCHEMAS = Path(
    "apps/backend/src/linkresume/modules/agent/schemas.py"
)


@dataclass(frozen=True)
class Assertion:
    path: str
    pattern: str
    message: str


@dataclass(frozen=True)
class Contract:
    identifier: str
    description: str
    assertions: tuple[Assertion, ...]


def load_contracts(path: Path) -> list[Contract]:
    if not path.is_file():
        raise ValueError(f"规则文件不存在：{path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if data.get("version") != 1:
        raise ValueError("运行时契约规则 version 必须为 1")

    contracts: list[Contract] = []
    seen: set[str] = set()
    for raw in data.get("contracts", []):
        identifier = raw.get("id")
        assertions = raw.get("assertions") or []
        if not isinstance(identifier, str) or not identifier:
            raise ValueError("每条运行时契约必须有 id")
        if identifier in seen:
            raise ValueError(f"运行时契约 id 重复：{identifier}")
        if not assertions:
            raise ValueError(f"运行时契约 {identifier} 缺少 assertions")
        seen.add(identifier)

        parsed: list[Assertion] = []
        for raw_assertion in assertions:
            file_path = raw_assertion.get("path")
            pattern = raw_assertion.get("pattern")
            message = raw_assertion.get("message")
            if not all(isinstance(value, str) and value for value in (file_path, pattern, message)):
                raise ValueError(f"运行时契约 {identifier} 的 assertion 字段不完整")
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"运行时契约 {identifier} 的正则无效：{exc}") from exc
            parsed.append(Assertion(file_path, pattern, message))

        contracts.append(
            Contract(
                identifier=identifier,
                description=str(raw.get("description") or ""),
                assertions=tuple(parsed),
            )
        )
    if not contracts:
        raise ValueError("运行时契约规则不能为空")
    return contracts


def check_contracts(contracts: list[Contract], repo_root: Path) -> list[str]:
    errors: list[str] = []
    for contract in contracts:
        for assertion in contract.assertions:
            target = repo_root / assertion.path
            if not target.is_file():
                errors.append(f"{contract.identifier}: 文件不存在 {assertion.path}")
                continue
            body = target.read_text(encoding="utf-8")
            if re.search(assertion.pattern, body, flags=re.DOTALL) is None:
                errors.append(
                    f"{contract.identifier}: {assertion.message}（{assertion.path}）"
                )
    return errors


def check_agent_tool_audit_contract(repo_root: Path) -> list[str]:
    pi_path = repo_root / PI_AGENT_RUNTIME
    schema_path = repo_root / BACKEND_AGENT_SCHEMAS
    if not pi_path.is_file() or not schema_path.is_file():
        return [
            "agent-tool-audit-contract: 无法读取 Pi 工具或 FastAPI 审计 schema"
        ]

    pi_tools = set(
        re.findall(
            r'\bauditedTool\(\{\s*name:\s*"([a-z0-9_]+)"',
            pi_path.read_text(encoding="utf-8"),
        )
    )
    schema_match = re.search(
        r"class ToolEventRequest\(BaseModel\):[\s\S]*?"
        r"tool_name: Literal\[([\s\S]*?)\n\s*\]",
        schema_path.read_text(encoding="utf-8"),
    )
    if not pi_tools or schema_match is None:
        return [
            "agent-tool-audit-contract: 无法解析 Pi 审计工具或 FastAPI tool_name 白名单"
        ]
    allowed_tools = set(re.findall(r'"([a-z0-9_]+)"', schema_match.group(1)))
    missing = sorted(pi_tools - allowed_tools)
    if not missing:
        return []
    return [
        "agent-tool-audit-contract: Pi 审计工具未加入 FastAPI tool_name 白名单："
        + ", ".join(missing)
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="校验 LinkResume 运行时契约")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    args = parser.parse_args(argv)

    try:
        contracts = load_contracts(args.config)
        errors = check_contracts(contracts, REPO_ROOT)
        errors.extend(check_agent_tool_audit_contract(REPO_ROOT))
    except ValueError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 2

    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1

    print(f"OK  已校验 {len(contracts)} 组运行时契约")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
