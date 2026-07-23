#!/usr/bin/env python3
"""Create the isolated LinkCV database without exposing credentials."""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError

from linkcv.core.config import load_settings

EXPECTED_DATABASE = "linkcv"


@dataclass(frozen=True)
class DatabaseTarget:
    url: URL
    audit_summary: str


def validated_target(database_url: str) -> DatabaseTarget:
    url = make_url(database_url)
    if not url.drivername.startswith("mysql+"):
        raise ValueError("database initialization requires a MySQL driver")
    if url.database != EXPECTED_DATABASE:
        raise ValueError(
            f"database initialization target must be {EXPECTED_DATABASE!r}, "
            f"got {url.database!r}"
        )
    if not url.host:
        raise ValueError("database initialization requires MYSQL_HOST")
    port = url.port or 3306
    return DatabaseTarget(
        url=url,
        audit_summary=(
            f"database={url.host}:{port}/{url.database} "
            f"user={url.username or '<unset>'}"
        ),
    )


def create_database(database_url: str) -> str:
    target = validated_target(database_url)
    target_engine = sa.create_engine(target.url, pool_pre_ping=True)
    try:
        try:
            with target_engine.connect():
                return target.audit_summary
        except OperationalError as exc:
            if mysql_error_code(exc) != 1049:
                raise
    finally:
        target_engine.dispose()

    admin_url = target.url.set(database="mysql")
    engine = sa.create_engine(admin_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            connection.execute(
                sa.text(
                    "CREATE DATABASE IF NOT EXISTS `linkcv` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
                )
            )
    finally:
        engine.dispose()
    return target.audit_summary


def mysql_error_code(exc: OperationalError) -> int | None:
    args = getattr(getattr(exc, "orig", None), "args", ())
    return args[0] if args and isinstance(args[0], int) else None


def safe_failure_reason(exc: Exception) -> str:
    if isinstance(exc, OperationalError):
        code = mysql_error_code(exc)
        if code is not None:
            return f"mysql_error_code={code}"
    return f"error_type={type(exc).__name__}"


def main() -> int:
    settings = load_settings()
    try:
        summary = create_database(settings.sqlalchemy_url)
    except Exception as exc:
        raise RuntimeError(
            "LinkCV database initialization failed: "
            f"stage=create_database {safe_failure_reason(exc)}"
        ) from None
    print(f"LinkCV database ready: {summary}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
