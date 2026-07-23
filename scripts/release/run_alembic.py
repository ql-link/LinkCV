#!/usr/bin/env python3
"""Validate the deployment target before running LinkCV Alembic migrations."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url

from linkcv.core.config import load_settings

BACKEND_ROOT = Path(__file__).resolve().parents[2] / "apps" / "backend"


@dataclass(frozen=True)
class ExpectedTarget:
    app_env: str
    host: str
    port: int
    database: str


def validate_target(database_url: str, app_env: str, expected: ExpectedTarget) -> str:
    url = make_url(database_url)
    actual = {
        "APP_ENV": app_env,
        "MYSQL_HOST": url.host or "",
        "MYSQL_PORT": url.port or 3306,
        "MYSQL_DATABASE": url.database or "",
    }
    wanted = {
        "APP_ENV": expected.app_env,
        "MYSQL_HOST": expected.host,
        "MYSQL_PORT": expected.port,
        "MYSQL_DATABASE": expected.database,
    }
    mismatches = [
        f"{name}: actual={actual[name]!r}, expected={wanted[name]!r}"
        for name in wanted
        if actual[name] != wanted[name]
    ]
    if mismatches:
        raise ValueError("Alembic target mismatch: " + "; ".join(mismatches))
    return (
        f"APP_ENV={app_env} database={url.host}:{actual['MYSQL_PORT']}/{url.database} "
        f"user={url.username or '<unset>'}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-app-env", required=True)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-port", required=True, type=int)
    parser.add_argument("--expected-database", required=True)
    args = parser.parse_args()

    settings = load_settings()
    expected = ExpectedTarget(
        app_env=args.expected_app_env,
        host=args.expected_host,
        port=args.expected_port,
        database=args.expected_database,
    )
    summary = validate_target(
        settings.sqlalchemy_url, settings.app_environment, expected
    )
    print(f"Alembic target verified: {summary}", flush=True)

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    command.upgrade(config, "head")
    command.current(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
