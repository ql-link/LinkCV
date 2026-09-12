#!/usr/bin/env python3
"""Read-only preflight for the 0036 canonical resume snapshot migration."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from linkcv.core.config import load_settings
from linkcv.core.database import build_engine


def _load_revision():
    path = (
        Path(__file__).resolve().parents[2]
        / "migrations"
        / "versions"
        / "0036_migrate_resume_snapshots_to_canonical_.py"
    )
    spec = importlib.util.spec_from_file_location("linkcv_revision_0036_preflight", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load canonical migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    settings = load_settings()
    engine = build_engine(settings.sqlalchemy_url)
    try:
        revision = _load_revision()
        with engine.connect() as connection:
            converted = revision._preflight(connection)
        counts: dict[str, int] = {}
        for table, *_rest in converted:
            counts[table] = counts.get(table, 0) + 1
        summary = ", ".join(f"{table}={count}" for table, count in sorted(counts.items()))
        print(f"0036 canonical preflight passed: {summary or 'no snapshots'}")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
