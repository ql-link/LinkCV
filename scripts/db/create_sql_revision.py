#!/usr/bin/env python3
"""Create an Alembic revision with paired reviewed MySQL SQL files."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from alembic import command
from alembic.config import Config

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "apps" / "backend"
SQL_DIR = BACKEND_ROOT / "migrations" / "sql"
VERSIONS_DIR = BACKEND_ROOT / "migrations" / "versions"
REVISION_FILE_PATTERN = re.compile(r"^(\d{4})_.+\.py$")


def sql_template(direction: str, revision_id: str, message: str) -> str:
    return (
        f"-- {direction.title()} migration for {revision_id}: {message}\n"
        "-- Add reviewed MySQL 8.4 statements below.\n"
    )


def create_sql_files(revision_id: str, message: str, sql_dir: Path = SQL_DIR) -> None:
    sql_dir.mkdir(parents=True, exist_ok=True)
    normalized_message = " ".join(message.splitlines()).strip()
    for direction in ("up", "down"):
        path = sql_dir / f"{revision_id}.{direction}.sql"
        if path.exists():
            raise FileExistsError(f"migration SQL file already exists: {path}")
        path.write_text(
            sql_template(direction, revision_id, normalized_message), encoding="utf-8"
        )


def next_revision_id(versions_dir: Path = VERSIONS_DIR) -> str:
    versions_dir.mkdir(parents=True, exist_ok=True)
    revision_numbers: list[int] = []
    for path in versions_dir.glob("*.py"):
        if path.name == "__init__.py":
            continue
        match = REVISION_FILE_PATTERN.fullmatch(path.name)
        if match is None:
            raise ValueError(
                f"migration revision must use 000x naming before creating another: {path}"
            )
        revision_numbers.append(int(match.group(1)))
    next_number = max(revision_numbers, default=0) + 1
    if next_number > 9999:
        raise ValueError("migration revision sequence exhausted at 9999")
    return f"{next_number:04d}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create an Alembic revision and paired .up.sql/.down.sql files"
    )
    parser.add_argument("-m", "--message", required=True)
    args = parser.parse_args()

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    revision = command.revision(
        config,
        message=args.message,
        autogenerate=False,
        rev_id=next_revision_id(),
    )
    if revision is None or isinstance(revision, list):
        raise RuntimeError("expected exactly one generated Alembic revision")

    create_sql_files(revision.revision, args.message)
    print(f"Created SQL migration: {revision.revision}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
