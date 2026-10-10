"""Execute reviewed MySQL migration SQL files from Alembic revisions."""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy.engine import Connection

_COMMENT = re.compile(r"(?m)^\s*--.*$")
_STATEMENT_SPLITTER = re.compile(r";\s*(?:\n|$)")
_DATABASE_SCOPE = re.compile(r"^\s*(?:CREATE|DROP)\s+DATABASE\b|^\s*USE\b", re.I)

# The brand rename changed the avatar directive in the 0026 seed, but 0027
# still contains the original guards. Accept only those two reviewed snapshots;
# do not rewrite published SQL or weaken rejection of customized templates.
_PREVIEW_SEED_DIGESTS = {
    "f775287ac3f4737ce7bf87cbf77a0a52ffcaae16cd94bdbf6a87756d5b64cd7f":
        "5601b276f4262685d9732c00abc749ce45948a87f845b988d1d8dbdef265dd79",
    "8b3135432b9d769cd293a3ced56ed82ea74d1d4b98412ce95dfbb044a0e3d8ac":
        "52b113c22e50c84643043fb809add053b06b8d2c8fa76009ab49d05dca5576a1",
    "33817a3f33a2ada648e7432c75fd866d5011bbafa20f47f70b8978db5e22f010":
        "e6960e72b832352b3ce0ca62a0b7e8da0e8c518ff65d902066820495f428d163",
    "b519411ea8d11e028771068db1fd62ca4eb99f702c042ec2c3ab0c0533d38c98":
        "5a1283d9c6e487dce72c6f0feb8c93d2b503e3d417944b00a2313039f09146f0",
}


def _compatible_statement(path: Path, statement: str) -> str:
    # Match the migration identifier rather than the source checkout location:
    # the executor also runs from an installed backend wheel.
    if path.name != "0027.up.sql":
        return statement
    for original, renamed in _PREVIEW_SEED_DIGESTS.items():
        statement = statement.replace(
            f"= '{original}'", f"IN ('{original}', '{renamed}')"
        )
    return statement


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
    # ``utf-8-sig`` accepts normal UTF-8 files and strips the optional BOM.
    # Some historical migration files contain a BOM before their first SQL
    # comment, which MySQL otherwise receives as part of the statement.
    statements = sql_statements(path.read_text(encoding="utf-8-sig"))
    if require_statements and not statements:
        raise ValueError(f"migration SQL file has no executable statements: {path}")

    for statement in statements:
        if _DATABASE_SCOPE.match(statement):
            raise ValueError(f"migration SQL cannot change database scope: {path}")
        # Migration files are reviewed, statement-only MySQL SQL. Executing the
        # driver SQL directly keeps JSON object colons literal instead of having
        # SQLAlchemy interpret values such as `"font_size":14` as bind params.
        # The migration format never supplies bind parameters.  Without
        # ``no_parameters``, SQLAlchemy still passes an empty parameter
        # collection to some DBAPIs.  PyMySQL then applies ``%`` formatting
        # and rejects literal percentages in seeded Markdown/JSON content.
        connection.exec_driver_sql(
            _compatible_statement(path, statement),
            execution_options={"no_parameters": True},
        )
