"""Apply the job pool admission scope to jobs stored before it existed.

Run once after deploying the scoped job pool worker:

    uv run --directory apps/backend python scripts/release/close_out_of_scope_jobs.py [--execute]

Jobs outside the scope (overseas-only or not a technology role) are marked
closed, never deleted; copies users already joined are separate rows and stay
untouched. Jobs inside the scope get their technology direction as category and
overseas places removed from the city list. Reruns change nothing new.
"""

import argparse

from sqlalchemy import select

from linkresume.application.job_pool.scope import classify, domestic_places
from linkresume.core.config import load_settings
from linkresume.core.database import build_engine, build_session_factory, utc_now
from linkresume.modules.job_pool.models import GlobalJob

BATCH = 500


def apply_scope(session_factory, *, execute: bool) -> tuple[int, int]:
    closed = updated = 0
    last_id = 0
    while True:
        with session_factory() as db:
            rows = list(db.scalars(select(GlobalJob).where(GlobalJob.id > last_id,
                GlobalJob.availability_status != "closed").order_by(GlobalJob.id).limit(BATCH).with_for_update()))
            if not rows:
                return closed, updated
            now = utc_now()
            for job in rows:
                last_id = job.id
                locations = job.locations or {"schema_version": 1, "cities": [], "raw": []}
                places = domestic_places(locations.get("cities", []))
                if locations.get("raw") and domestic_places(locations["raw"]) is None:
                    places = None
                direction = classify(job.job_title, job.job_category)
                if places is None or direction is None:
                    closed += 1
                    job.availability_status = "closed"
                    job.update_time = now
                elif direction != job.job_category or places != locations.get("cities"):
                    updated += 1
                    job.job_category = direction
                    job.locations = locations | {"cities": places}
                    job.update_time = now
            if execute:
                db.commit()
            else:
                db.rollback()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="write changes; default is a dry run")
    args = parser.parse_args()
    settings = load_settings()
    session_factory = build_session_factory(build_engine(settings.sqlalchemy_url))
    closed, updated = apply_scope(session_factory, execute=args.execute)
    action = "done" if args.execute else "would do"
    print(f"out-of-scope jobs closed ({action}): {closed}; in-scope jobs recategorized ({action}): {updated}")


if __name__ == "__main__":
    main()
