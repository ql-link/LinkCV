import argparse

from sqlalchemy import text

from linkcv.core.config import load_settings
from linkcv.core.database import build_engine
from linkcv.core.storage import AssetStorage


LIST_SQL = text(
    """
    SELECT id, user_id, object_name
    FROM user_dataset
    ORDER BY id
    """
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="List or remove user datasets created before parsing support."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="delete listed source objects; database rows are removed by migration 0022",
    )
    args = parser.parse_args()
    settings = load_settings()
    engine = build_engine(settings.sqlalchemy_url)
    storage = AssetStorage(settings)
    with engine.connect() as connection:
        rows = connection.execute(LIST_SQL).mappings().all()

    mode = "execute" if args.execute else "dry-run"
    print(f"legacy user datasets: mode={mode} count={len(rows)}")
    for row in rows:
        print(
            "legacy user dataset: "
            f"dataset_id={row['id']} user_id={row['user_id']} "
            f"object={row['object_name']}"
        )
    if not args.execute:
        return 0

    failed = 0
    for row in rows:
        try:
            storage.delete(row["object_name"])
        except Exception as error:
            failed += 1
            print(
                "legacy user dataset cleanup failed: "
                f"dataset_id={row['id']} error={type(error).__name__}"
            )
    print(f"legacy user dataset cleanup complete: failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
