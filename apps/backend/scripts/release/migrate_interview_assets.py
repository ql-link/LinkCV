"""Migrate legacy ``interview_assets`` rows and objects into ``user_dataset``.

Run once after the 0064 schema revision and the unified-ingest code deploy:

    uv run --directory apps/backend python scripts/release/migrate_interview_assets.py [--execute]

Per row: copy the object to the ``users/{uid}/datasets/`` namespace, insert a
``document_parse_tasks`` + ``user_dataset`` pair (documents queue for parsing,
media lands in a terminal state), verify the copied object, then delete the
legacy object and row. ``legacy_interview_asset_id`` makes reruns idempotent:
rows already migrated are skipped, and the deterministic target object key
makes a mid-row crash safe to retry.
"""

import argparse
import hashlib
import json
import re
import unicodedata
import uuid
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

from linkresume.core.config import load_settings
from linkresume.core.database import build_engine
from linkresume.core.storage import AssetStorage

LIST_SQL = text(
    """
    SELECT
        a.id,
        a.interview_session_id,
        a.source_type,
        a.asset_type,
        a.original_file_name,
        a.content_type,
        a.file_size,
        a.duration_ms,
        a.object_name,
        a.sha256,
        a.created_at,
        ja.user_id
    FROM interview_assets a
    JOIN interview_sessions s ON s.id = a.interview_session_id
    JOIN job_applications ja ON ja.id = s.application_id
    ORDER BY a.id
    """
)


def _sanitize_component(file_name: str) -> str:
    normalized = unicodedata.normalize("NFKD", Path(file_name).name)
    safe_name = re.sub(r"[^\w.-]+", "-", normalized).strip("-.")[:120]
    return safe_name or "interview-asset.bin"


def migrated_object_name(user_id: int, asset_id: int, file_name: str) -> str:
    return (
        f"users/{user_id}/datasets/"
        f"migrated-{asset_id}-{_sanitize_component(file_name)}"
    )


def migrated_fingerprint(asset_id: int) -> str:
    payload = {"version": 1, "legacy_interview_asset_id": asset_id}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def migrated_idempotency_key(asset_id: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"interview-asset:{asset_id}"))


def migrate(engine: Engine, storage: AssetStorage, *, execute: bool) -> int:
    with engine.connect() as connection:
        rows = connection.execute(LIST_SQL).mappings().all()
        migrated_ids = {
            row[0]
            for row in connection.execute(
                text(
                    "SELECT legacy_interview_asset_id FROM user_dataset "
                    "WHERE legacy_interview_asset_id IS NOT NULL"
                )
            )
        }

    pending = [row for row in rows if row["id"] not in migrated_ids]
    mode = "execute" if execute else "dry-run"
    print(
        f"interview asset migration: mode={mode} "
        f"total={len(rows)} migrated={len(migrated_ids)} pending={len(pending)}"
    )
    for row in pending:
        target = migrated_object_name(
            row["user_id"], row["id"], row["original_file_name"]
        )
        print(
            "interview asset pending: "
            f"id={row['id']} user_id={row['user_id']} "
            f"session={row['interview_session_id']} "
            f"{row['object_name']} -> {target}"
        )
    if not execute:
        return 0

    failed = 0
    for row in pending:
        asset_id = row["id"]
        user_id = row["user_id"]
        target_name = migrated_object_name(
            user_id, asset_id, row["original_file_name"]
        )
        extension = _sanitize_component(row["original_file_name"]).rsplit(".", 1)[-1]
        extension = extension.lower()
        allowed = (
            {"md", "txt", "docx", "pdf"}
            if row["asset_type"] == "document"
            else {"webm", "m4a", "mp3", "wav", "ogg", "mp4", "mov"}
        )
        if extension not in allowed:
            failed += 1
            print(
                f"interview asset unsupported format: id={asset_id} "
                f"file_name={row['original_file_name']}"
            )
            continue
        is_document = row["asset_type"] == "document"
        sha256 = row["sha256"] or hashlib.sha256(b"").hexdigest()
        try:
            storage.stat(row["object_name"])
            storage.copy(row["object_name"], target_name)
            storage.stat(target_name)
        except Exception as error:
            failed += 1
            print(
                f"interview asset object copy failed: id={asset_id} "
                f"error={type(error).__name__}"
            )
            continue
        try:
            with engine.begin() as connection:
                existing = connection.execute(
                    text(
                        "SELECT id FROM user_dataset "
                        "WHERE legacy_interview_asset_id = :asset_id"
                    ),
                    {"asset_id": asset_id},
                ).first()
                if existing is not None:
                    connection.execute(
                        text("DELETE FROM interview_assets WHERE id = :asset_id"),
                        {"asset_id": asset_id},
                    )
                    continue
                cursor = connection.execute(
                    text(
                        """
                        INSERT INTO document_parse_tasks (
                            source_type, user_id, file_name, file_format,
                            object_name, upload_status, upload_duration_ms,
                            parse_status, parse_duration_ms,
                            parse_attempt_count, created_at, updated_at
                        ) VALUES (
                            'dataset', :user_id, :file_name, :file_format,
                            :object_name, 'succeeded', 0,
                            :parse_status, :parse_duration_ms,
                            0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        """
                    ),
                    {
                        "user_id": user_id,
                        "file_name": row["original_file_name"],
                        "file_format": extension,
                        "object_name": target_name,
                        "parse_status": "queued" if is_document else "succeeded",
                        "parse_duration_ms": None if is_document else 0,
                    },
                )
                task_id = cursor.lastrowid
                connection.execute(
                    text(
                        """
                        INSERT INTO user_dataset (
                            user_id, folder_id, idempotency_key,
                            request_fingerprint, parse_task_id,
                            file_name, file_format, content_type,
                            file_size, object_name, sha256,
                            asset_kind, interview_session_id,
                            interview_source_type, duration_ms,
                            legacy_interview_asset_id, created_at
                        ) VALUES (
                            :user_id, NULL, :idempotency_key,
                            :request_fingerprint, :parse_task_id,
                            :file_name, :file_format, :content_type,
                            :file_size, :object_name, :sha256,
                            :asset_kind, :interview_session_id,
                            :interview_source_type, :duration_ms,
                            :legacy_interview_asset_id, :created_at
                        )
                        """
                    ),
                    {
                        "user_id": user_id,
                        "idempotency_key": migrated_idempotency_key(asset_id),
                        "request_fingerprint": migrated_fingerprint(asset_id),
                        "parse_task_id": task_id,
                        "file_name": row["original_file_name"],
                        "file_format": extension,
                        "content_type": row["content_type"],
                        "file_size": row["file_size"],
                        "object_name": target_name,
                        "sha256": sha256,
                        "asset_kind": row["asset_type"],
                        "interview_session_id": row["interview_session_id"],
                        "interview_source_type": row["source_type"],
                        "duration_ms": row["duration_ms"],
                        "legacy_interview_asset_id": asset_id,
                        "created_at": row["created_at"],
                    },
                )
                connection.execute(
                    text("DELETE FROM interview_assets WHERE id = :asset_id"),
                    {"asset_id": asset_id},
                )
        except Exception as error:
            failed += 1
            print(
                f"interview asset row migration failed: id={asset_id} "
                f"error={type(error).__name__}"
            )
            continue
        try:
            storage.delete(row["object_name"])
        except Exception as error:
            failed += 1
            print(
                f"interview asset legacy object delete failed: id={asset_id} "
                f"error={type(error).__name__}"
            )

    with engine.connect() as connection:
        leftover_rows = connection.execute(
            text("SELECT COUNT(*) FROM interview_assets")
        ).scalar_one()
    leftover_objects = [
        name for name in storage.list_names("users/") if "/interviews/" in name
    ]
    print(
        "interview asset migration complete: "
        f"failed={failed} remaining_rows={leftover_rows} "
        f"remaining_interviews_objects={len(leftover_objects)}"
    )
    for name in leftover_objects[:20]:
        print(f"  leftover object: {name}")
    return 1 if failed or leftover_rows or leftover_objects else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate interview_assets rows into user_dataset."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="copy objects and insert dataset rows (default is dry-run)",
    )
    args = parser.parse_args()
    settings = load_settings()
    engine = build_engine(settings.sqlalchemy_url)
    storage = AssetStorage(settings)
    return migrate(engine, storage, execute=args.execute)


if __name__ == "__main__":
    raise SystemExit(main())
