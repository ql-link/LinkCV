import argparse

from sqlalchemy import text

from linkcv.core.config import load_settings
from linkcv.core.database import build_engine
from linkcv.core.storage import AssetStorage


LIST_SQL = text(
    """
    SELECT
        r.id,
        r.user_id,
        r.source_object_key,
        (SELECT COUNT(*) FROM resume_versions rv WHERE rv.resume_id = r.id)
            AS version_count
    FROM resumes r
    LEFT JOIN resume_imports ri ON ri.result_resume_id = r.id
    WHERE r.source_type = 'import' AND ri.id IS NULL
    ORDER BY r.id
    """
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="List or remove legacy synchronous resume imports."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="delete listed objects, versions, and resumes",
    )
    args = parser.parse_args()
    settings = load_settings()
    engine = build_engine(settings.sqlalchemy_url)
    storage = AssetStorage(settings)
    with engine.connect() as connection:
        rows = connection.execute(LIST_SQL).mappings().all()

    mode = "execute" if args.execute else "dry-run"
    print(f"legacy resume imports: mode={mode} count={len(rows)}")
    for row in rows:
        print(
            "legacy resume import: "
            f"resume_id={row['id']} user_id={row['user_id']} "
            f"versions={row['version_count']} object={row['source_object_key']}"
        )
    if not args.execute:
        return 0

    failed = 0
    for row in rows:
        try:
            storage.delete(row["source_object_key"])
        except Exception as error:
            failed += 1
            print(
                "legacy resume import cleanup failed: "
                f"resume_id={row['id']} error={type(error).__name__}"
            )
            continue
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM resume_versions WHERE resume_id = :resume_id"),
                {"resume_id": row["id"]},
            )
            connection.execute(
                text(
                    "DELETE FROM resumes WHERE id = :resume_id "
                    "AND source_type = 'import' "
                    "AND NOT EXISTS ("
                    "SELECT 1 FROM resume_imports "
                    "WHERE result_resume_id = :resume_id)"
                ),
                {"resume_id": row["id"]},
            )
    print(f"legacy resume import cleanup complete: failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
