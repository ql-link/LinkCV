"""Execute reviewed MySQL migration SQL files from Alembic revisions."""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy.engine import Connection

_COMMENT = re.compile(r"(?m)^\s*--.*$")
_STATEMENT_SPLITTER = re.compile(r";\s*(?:\n|$)")
_DATABASE_SCOPE = re.compile(r"^\s*(?:CREATE|DROP)\s+DATABASE\b|^\s*USE\b", re.I)


def sql_statements(sql: str) -> list[str]:
    """Split the repository's statement-only MySQL migration format."""
    without_comments = _COMMENT.sub("", sql)
    return [
        statement.strip()
        for statement in _STATEMENT_SPLITTER.split(without_comments)
        if statement.strip()
    ]


def execute_sql_file(
    connection: Connection,
    path: Path,
    *,
    require_statements: bool = True,
) -> None:
    """Execute one migration file without allowing it to change database scope."""
    statements = sql_statements(path.read_text(encoding="utf-8"))
    if require_statements and not statements:
        raise ValueError(f"migration SQL file has no executable statements: {path}")

    for statement in statements:
        if _DATABASE_SCOPE.match(statement):
            raise ValueError(f"migration SQL cannot change database scope: {path}")
        # Migration files are reviewed, statement-only MySQL SQL. Executing the
        # driver SQL directly keeps JSON object colons literal instead of having
        # SQLAlchemy interpret values such as `"font_size":14` as bind params.
        connection.exec_driver_sql(statement)
