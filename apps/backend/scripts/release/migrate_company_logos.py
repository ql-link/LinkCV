"""Finish the 0122 company logo migration.

Run once after the 0122 schema revision and the unified company logo code deploy:

    uv run --directory apps/backend python scripts/release/migrate_company_logos.py [--execute]

1. Admin-entered external logos are downloaded through the same restricted
   fetcher as the admin API, normalized, and stored as
   `/api/company-logos/{sha256}.webp`. Failures keep the original address.
2. Site-hosted logos without a fingerprint get `logo_dhash` from the stored
   image, so marking a placeholder can find them.

Failures are reported by company ID only. Reruns skip finished companies.
"""

import argparse
import hashlib
import re

from sqlalchemy import select

from linkresume.application.job_descriptions.company_service import public_logo_url
from linkresume.application.job_descriptions.logo_fetch import fetch_logo
from linkresume.application.job_descriptions.logo_service import (
    MAX_STORED_LOGO_BYTES,
    logo_dhash,
    normalize_logo,
    store_public_logo,
)
from linkresume.core.config import load_settings
from linkresume.core.database import build_engine, build_session_factory, utc_now
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage
from linkresume.modules.job_descriptions.models import GlobalCompany

HOSTED = re.compile(r"/api/company-logos/([0-9a-f]{64})\.webp")


def _locked(db, company_id: int):
    return db.scalar(select(GlobalCompany).where(GlobalCompany.id == company_id).with_for_update()
        .execution_options(populate_existing=True))


def migrate_admin_links(session_factory, storage, *, execute: bool, fetch=fetch_logo) -> tuple[list[int], list[int]]:
    moved, failed = [], []
    with session_factory() as db:
        candidates = list(db.scalars(select(GlobalCompany.id).where(GlobalCompany.logo_source == "admin",
            GlobalCompany.logo_url.like("https://%")).order_by(GlobalCompany.id)))
    for company_id in candidates:
        with session_factory() as db:
            url = db.get(GlobalCompany, company_id).logo_url
            try:
                normalized = normalize_logo(fetch(url))
            except ApiError:
                failed.append(company_id)
                continue
            if not execute:
                moved.append(company_id)
                continue
            try:
                public_url = store_public_logo(db, storage, normalized, hashlib.sha256(normalized).hexdigest())
                company = _locked(db, company_id)
                # Skip if an admin changed the logo while the image was downloading.
                if company.logo_source != "admin" or company.logo_url != url:
                    db.rollback()
                    continue
                company.logo_url = public_url
                company.logo_dhash = logo_dhash(normalized)
                company.lock_version += 1
                company.update_time = utc_now()
                db.commit()
                moved.append(company_id)
            except Exception:
                db.rollback()
                failed.append(company_id)
    return moved, failed


def backfill_fingerprints(session_factory, storage, *, execute: bool) -> tuple[list[int], list[int]]:
    filled, failed = [], []
    with session_factory() as db:
        candidates = list(db.execute(select(GlobalCompany.id, GlobalCompany.logo_url).where(
            GlobalCompany.logo_dhash.is_(None), GlobalCompany.logo_url.like("/api/company-logos/%")).order_by(GlobalCompany.id)))
    for company_id, url in candidates:
        match = HOSTED.fullmatch(url or "")
        if match is None:
            failed.append(company_id)
            continue
        try:
            remote = storage.get(f"public-company-logos/{match[1]}.webp")
            try:
                data = remote.read(MAX_STORED_LOGO_BYTES + 1)
            finally:
                remote.close()
                remote.release_conn()
            dhash = logo_dhash(data)
        except Exception:
            failed.append(company_id)
            continue
        if not execute:
            filled.append(company_id)
            continue
        with session_factory() as db:
            company = _locked(db, company_id)
            if company.logo_url != public_logo_url(match[1]) or company.logo_dhash is not None:
                db.rollback()
                continue
            company.logo_dhash = dhash
            db.commit()
            filled.append(company_id)
    return filled, failed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="write changes; default is a dry run")
    args = parser.parse_args()
    settings = load_settings()
    session_factory = build_session_factory(build_engine(settings.sqlalchemy_url))
    storage = AssetStorage(settings)
    action = "done" if args.execute else "would do"
    moved, failed = migrate_admin_links(session_factory, storage, execute=args.execute)
    print(f"admin external logos {action}: {len(moved)}; failed (kept external address): {len(failed)} {failed}")
    filled, missing = backfill_fingerprints(session_factory, storage, execute=args.execute)
    print(f"hosted logo fingerprints {action}: {len(filled)}; failed: {len(missing)} {missing}")


if __name__ == "__main__":
    main()
