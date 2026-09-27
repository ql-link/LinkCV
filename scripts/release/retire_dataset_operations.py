#!/usr/bin/env python3
"""One-time 0089 preparation. Stop API/Workers and back up before --execute."""
from __future__ import annotations

import argparse

from sqlalchemy import create_engine, inspect, text

from linkresume.core.config import load_settings
from linkresume.core.storage import AssetStorage


def retire_operations(connection, storage=None, *, execute=False):
    tables = set(inspect(connection).get_table_names())
    operations = (
        connection.execute(text("SELECT * FROM dataset_replacements")).mappings().all()
        if "dataset_replacements" in tables else []
    )
    tickets = (
        connection.execute(text("SELECT * FROM dataset_object_cleanup")).mappings().all()
        if "dataset_object_cleanup" in tables else []
    )
    retired_tasks = {}
    objects = {}
    for operation in operations:
        task_id = operation["parse_task_id"]
        if task_id is None:
            continue
        task = connection.execute(
            text("SELECT * FROM document_parse_tasks WHERE id = :id"), {"id": task_id}
        ).mappings().first()
        if task is None:
            continue
        if task["source_type"] != "dataset" or task["user_id"] != operation["user_id"]:
            raise RuntimeError("Legacy replacement task ownership is inconsistent")
        if connection.scalar(text("SELECT COUNT(*) FROM user_dataset WHERE parse_task_id = :id"), {"id": task_id}):
            continue  # The adopted source remains current.
        retired_tasks[task_id] = task
        for key in (task["object_name"], task["converted_object_name"], f"users/{task['user_id']}/datasets/converted/{task_id}.md"):
            if key:
                objects[key] = task["user_id"]
    for ticket in tickets:
        objects[ticket["object_name"]] = ticket["user_id"]

    deletions = []
    for key, user_id in objects.items():
        if not key.startswith(f"users/{user_id}/datasets/"):
            raise RuntimeError("Legacy cleanup object is outside the user's dataset prefix")
        # Use all users for reference checks; never delete a currently used key.
        if connection.scalar(text(
            "SELECT COUNT(*) FROM user_dataset WHERE object_name = :key OR content_object_name = :key"
        ), {"key": key}):
            continue
        refs = connection.execute(text(
            "SELECT id FROM document_parse_tasks WHERE object_name = :key OR converted_object_name = :key"
        ), {"key": key}).scalars()
        if any(task_id not in retired_tasks for task_id in refs):
            continue
        deletions.append(key)

    summary = {"replacements": len(operations), "cleanup_records": len(tickets),
               "unused_tasks": len(retired_tasks), "unused_objects": len(deletions)}
    if not execute:
        return summary
    if storage is None:
        raise ValueError("Storage is required for execution")
    # A failed synchronous delete aborts the SQL transaction. Rerunning is safe:
    # MinIO remove_object tolerates an already missing object.
    for key in deletions:
        storage.delete(key)
    if "dataset_replacements" in tables:
        connection.execute(text("DELETE FROM dataset_replacements"))
    for task_id in retired_tasks:
        connection.execute(text("DELETE FROM document_parse_tasks WHERE id = :id"), {"id": task_id})
    if "dataset_object_cleanup" in tables:
        connection.execute(text("DELETE FROM dataset_object_cleanup"))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Delete unused legacy files and drain operation tables; default is read-only")
    args = parser.parse_args()
    settings = load_settings()
    engine = create_engine(settings.sqlalchemy_url)
    storage = AssetStorage(settings) if args.execute else None
    try:
        with engine.begin() as connection:
            summary = retire_operations(connection, storage, execute=args.execute)
        print({"executed": args.execute, **summary})
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
