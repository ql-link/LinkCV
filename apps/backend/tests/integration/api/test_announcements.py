"""In-app announcements: admin lifecycle, user visibility, read-through time and audit."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from drawoffer.core.config import Settings
from drawoffer.main import create_app
from drawoffer.modules.announcements.models import Announcement
from drawoffer.modules.identity.models import User
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class CapturingEmitter:
    def __init__(self) -> None:
        self.system_events: list[dict[str, object]] = []
        self.audit_events: list[dict[str, object]] = []

    def system(self, level: str, message: str, **fields: object) -> bool:
        self.system_events.append({"level": level, "message": message, **fields})
        return True

    def audit(self, **fields: object) -> tuple[bool, str]:
        event_id = uuid4().hex
        self.audit_events.append({"event_id": event_id, **fields})
        return True, event_id

    def emit(self, **fields: object) -> tuple[bool, dict[str, object]]:
        event = {"event_id": uuid4().hex, **fields}
        self.system_events.append(event)
        return True, event


def build_app():
    emitter = CapturingEmitter()
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="announcement-test-secret-with-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        event_emitter=emitter,
        create_schema=True,
    )
    return app, emitter


def register(client: TestClient, email: str) -> int:
    response = client.post(
        "/api/auth/register", json={"email": email, "password": "password-123"}
    )
    assert response.status_code == 201
    return int(response.json()["user"]["id"])


def make_admin(app, user_id: int) -> None:
    with app.state.session_factory() as db:
        db.execute(update(User).where(User.id == user_id).values(is_admin=True))
        db.commit()


def admin_client(app) -> TestClient:
    client = TestClient(app)
    client.__enter__()
    user_id = register(client, "admin@example.test")
    make_admin(app, user_id)
    return client


def user_client(app, email: str = "zhangsan@example.test") -> TestClient:
    client = TestClient(app)
    client.__enter__()
    register(client, email)
    return client


def create(admin: TestClient, **fields) -> dict:
    payload = {"title": "DrawOffer v2.4 上线", "body": "新版编辑器已上线。\n支持换行。", **fields}
    response = admin.post("/api/admin/announcements", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["announcement"]


def iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def test_permissions_for_admin_and_user_endpoints() -> None:
    app, _ = build_app()
    anonymous = TestClient(app)
    with anonymous:
        assert anonymous.get("/api/admin/announcements").status_code == 401
        assert anonymous.get("/api/announcements").status_code == 401
        assert anonymous.get("/api/announcements/unread-count").status_code == 401
        assert anonymous.post("/api/announcements/read-all").status_code == 401
    user = user_client(app)
    assert user.get("/api/admin/announcements").status_code == 403
    assert user.post("/api/admin/announcements", json={"title": "x", "body": "y"}).status_code == 403
    assert user.get("/api/admin/announcements/stats").status_code == 403


def test_draft_can_be_edited_and_deleted_and_validation_rejects_bad_input() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    draft = create(admin)
    assert draft["status"] == "draft"
    assert draft["visibility"] == "draft"
    assert draft["level"] == "normal"
    assert draft["publishedAt"] is None

    patched = admin.patch(
        f"/api/admin/announcements/{draft['id']}",
        json={"title": "维护通知", "level": "important"},
    )
    assert patched.status_code == 200
    assert patched.json()["announcement"]["title"] == "维护通知"
    assert patched.json()["announcement"]["level"] == "important"

    for bad in (
        {"title": "", "body": "x"},
        {"title": "   ", "body": "x"},
        {"title": "x" * 121, "body": "x"},
        {"title": "x", "body": "y" * 5001},
        {"title": "x", "body": "y", "level": "urgent"},
        {"title": "x", "body": "y", "startsAt": "2026-10-01T00:00:00"},
    ):
        assert admin.post("/api/admin/announcements", json=bad).status_code == 422, bad

    window = admin.post(
        "/api/admin/announcements",
        json={"title": "x", "body": "y", "startsAt": "2026-10-02T00:00:00Z",
              "endsAt": "2026-10-01T00:00:00Z"},
    )
    assert window.status_code == 422
    assert window.json()["error"] == "ANNOUNCEMENT_WINDOW_INVALID"

    assert admin.delete(f"/api/admin/announcements/{draft['id']}").status_code == 204
    assert admin.get(f"/api/admin/announcements/{draft['id']}").status_code == 404
    assert admin.delete(f"/api/admin/announcements/{draft['id']}").status_code == 404


def test_publish_makes_announcement_visible_to_existing_and_new_users() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    existing = user_client(app, "existing@example.test")
    draft = create(admin)

    assert existing.get("/api/announcements").json() == {"items": [], "unreadCount": 0}

    published = admin.post(f"/api/admin/announcements/{draft['id']}/publish")
    assert published.status_code == 200
    body = published.json()["announcement"]
    assert body["status"] == "published"
    assert body["visibility"] == "active"
    assert body["publishedAt"] is not None

    items = existing.get("/api/announcements").json()
    assert [item["id"] for item in items["items"]] == [draft["id"]]
    assert items["unreadCount"] == 1
    assert items["items"][0]["read"] is False
    assert "createdBy" not in items["items"][0]
    assert "readCount" not in items["items"][0]

    newcomer = user_client(app, "newcomer@example.test")
    assert newcomer.get("/api/announcements/unread-count").json() == {"unreadCount": 1}


def test_published_and_unpublished_cannot_be_edited_deleted_or_republished() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    row = create(admin)
    path = f"/api/admin/announcements/{row['id']}"
    assert admin.post(f"{path}/unpublish").status_code == 409  # draft cannot be unpublished
    assert admin.post(f"{path}/publish").status_code == 200

    for method, url, kwargs in (
        ("patch", path, {"json": {"title": "改标题"}}),
        ("delete", path, {}),
        ("post", f"{path}/publish", {}),
    ):
        response = getattr(admin, method)(url, **kwargs)
        assert response.status_code == 409, (method, url)
        assert response.json()["error"] == "ANNOUNCEMENT_STATE_CONFLICT"

    first = admin.post(f"{path}/unpublish")
    assert first.status_code == 200
    assert first.json()["announcement"]["status"] == "unpublished"
    again = admin.post(f"{path}/unpublish")
    assert again.status_code == 200
    assert again.json()["announcement"]["unpublishedAt"] == first.json()["announcement"]["unpublishedAt"]
    assert admin.post(f"{path}/publish").status_code == 409
    assert admin.patch(path, json={"title": "x"}).status_code == 409


def test_unpublish_hides_announcement_from_users() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    user = user_client(app)
    row = create(admin)
    admin.post(f"/api/admin/announcements/{row['id']}/publish")
    assert user.get("/api/announcements/unread-count").json()["unreadCount"] == 1
    admin.post(f"/api/admin/announcements/{row['id']}/unpublish")
    assert user.get("/api/announcements").json() == {"items": [], "unreadCount": 0}


def test_time_window_controls_visibility() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    user = user_client(app)
    now = datetime.now(timezone.utc)

    scheduled = create(admin, startsAt=iso(now + timedelta(days=1)))
    admin.post(f"/api/admin/announcements/{scheduled['id']}/publish")
    assert admin.get(f"/api/admin/announcements/{scheduled['id']}").json()["announcement"][
        "visibility"
    ] == "scheduled"

    expiring = create(admin, endsAt=iso(now + timedelta(days=1)))
    admin.post(f"/api/admin/announcements/{expiring['id']}/publish")
    assert [i["id"] for i in user.get("/api/announcements").json()["items"]] == [expiring["id"]]

    # Move the end time into the past; the row must disappear without any job running.
    with app.state.session_factory() as db:
        db.execute(
            update(Announcement)
            .where(Announcement.id == int(expiring["id"]))
            .values(ends_at=now - timedelta(minutes=1))
        )
        db.commit()
    assert user.get("/api/announcements").json()["items"] == []
    assert admin.get(f"/api/admin/announcements/{expiring['id']}").json()["announcement"][
        "visibility"
    ] == "expired"

    past = create(admin, endsAt=iso(now - timedelta(minutes=1)))
    rejected = admin.post(f"/api/admin/announcements/{past['id']}/publish")
    assert rejected.status_code == 422
    assert rejected.json()["error"] == "ANNOUNCEMENT_WINDOW_INVALID"
    assert admin.get(f"/api/admin/announcements/{past['id']}").json()["announcement"][
        "status"
    ] == "draft"


def test_user_list_orders_important_first() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    user = user_client(app)
    older = create(admin, title="普通旧")
    admin.post(f"/api/admin/announcements/{older['id']}/publish")
    important = create(admin, title="重要", level="important")
    admin.post(f"/api/admin/announcements/{important['id']}/publish")
    newer = create(admin, title="普通新")
    admin.post(f"/api/admin/announcements/{newer['id']}/publish")

    titles = [item["title"] for item in user.get("/api/announcements").json()["items"]]
    assert titles == ["重要", "普通新", "普通旧"]


def test_read_all_clears_unread_per_user_and_is_idempotent() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    user = user_client(app)
    for index in range(3):
        row = create(admin, title=f"公告 {index}")
        admin.post(f"/api/admin/announcements/{row['id']}/publish")
    create(admin, title="草稿")

    assert user.get("/api/announcements/unread-count").json() == {"unreadCount": 3}
    assert user.post("/api/announcements/read-all").json() == {"unreadCount": 0}
    assert user.post("/api/announcements/read-all").json() == {"unreadCount": 0}
    assert all(item["read"] for item in user.get("/api/announcements").json()["items"])
    # Single-announcement read receipts no longer exist.
    assert user.post("/api/announcements/1/read").status_code in (404, 405)

    other = user_client(app, "other@example.test")
    assert other.get("/api/announcements/unread-count").json() == {"unreadCount": 3}


def test_read_through_time_decides_what_counts_as_new() -> None:
    from drawoffer.modules.announcements import service

    app, _ = build_app()
    admin = admin_client(app)
    user_client(app)
    t0 = datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)
    ids = {
        # Published before the user opened the bell.
        "old": create(admin, title="旧公告")["id"],
        # Draft scheduled for the past but only published later: new when it goes live.
        "backdated": create(admin, title="补发", startsAt=iso(t0 - timedelta(days=3)))["id"],
        # Published early but scheduled to start after the user's read time.
        "scheduled": create(admin, title="预约", startsAt=iso(t0 + timedelta(hours=2)))["id"],
    }
    with app.state.session_factory() as db:
        manager = db.scalar(select(User).where(User.email == "admin@example.test"))
        user = db.scalar(select(User).where(User.email == "zhangsan@example.test"))
        service.publish(db, manager, int(ids["old"]), now=t0 - timedelta(hours=1))
        service.publish(db, manager, int(ids["scheduled"]), now=t0 - timedelta(hours=1))
        assert service.unread_count(db, user, now=t0) == 1

        assert service.mark_all_read(db, user, now=t0) == 0
        # An older timestamp never moves the read-through time backwards.
        assert service.mark_all_read(db, user, now=t0 - timedelta(days=1)) == 0
        assert service.read_through(db, user) == t0

        service.publish(db, manager, int(ids["backdated"]), now=t0 + timedelta(minutes=5))
        later = t0 + timedelta(hours=3)
        read = {str(row.id): flag for row, flag in service.list_active(db, user, now=later)}
        assert read == {ids["old"]: True, ids["backdated"]: False, ids["scheduled"]: False}
        assert service.unread_count(db, user, now=later) == 2


def test_admin_list_filters_paginates_and_reports_stats() -> None:
    app, _ = build_app()
    admin = admin_client(app)

    assert admin.get("/api/admin/announcements/stats").json() == {
        "draft": 0, "published": 0, "unpublished": 0, "active": 0, "scheduled": 0,
    }

    published = create(admin, title="已发布")
    admin.post(f"/api/admin/announcements/{published['id']}/publish")
    offline = create(admin, title="已下线")
    admin.post(f"/api/admin/announcements/{offline['id']}/publish")
    admin.post(f"/api/admin/announcements/{offline['id']}/unpublish")
    create(admin, title="草稿 1")
    create(admin, title="草稿 2")
    drafts = admin.get("/api/admin/announcements", params={"status": "draft"}).json()
    assert {item["title"] for item in drafts["items"]} == {"草稿 1", "草稿 2"}

    detail = admin.get(f"/api/admin/announcements/{published['id']}").json()["announcement"]
    assert "readCount" not in detail

    first = admin.get("/api/admin/announcements", params={"limit": 3}).json()
    assert len(first["items"]) == 3 and first["nextCursor"]
    second = admin.get(
        "/api/admin/announcements", params={"limit": 3, "cursor": first["nextCursor"]}
    ).json()
    assert len(second["items"]) == 1 and second["nextCursor"] is None
    seen = [i["id"] for i in first["items"] + second["items"]]
    assert len(set(seen)) == 4
    assert admin.get("/api/admin/announcements", params={"cursor": "bad"}).status_code == 400

    later = create(admin, title="定时", startsAt="2099-01-01T00:00:00Z")
    admin.post(f"/api/admin/announcements/{later['id']}/publish")
    assert admin.get("/api/admin/announcements/stats").json() == {
        "draft": 2, "published": 2, "unpublished": 1, "active": 1, "scheduled": 1,
    }


def test_admin_writes_are_audited_with_announcement_target() -> None:
    app, emitter = build_app()
    admin = admin_client(app)
    row = create(admin)
    path = f"/api/admin/announcements/{row['id']}"
    admin.patch(path, json={"title": "改"})
    admin.post(f"{path}/publish")
    admin.post(f"{path}/unpublish")
    doomed = create(admin, title="待删")
    admin.delete(f"/api/admin/announcements/{doomed['id']}")

    events = [
        (event["action"], event["target_id"])
        for event in emitter.audit_events
        if str(event.get("action", "")).startswith("admin.announcement_")
    ]
    assert events == [
        ("admin.announcement_create", row["id"]),
        ("admin.announcement_update", row["id"]),
        ("admin.announcement_publish", row["id"]),
        ("admin.announcement_unpublish", row["id"]),
        ("admin.announcement_create", doomed["id"]),
        ("admin.announcement_delete", doomed["id"]),
    ]
    assert all(
        event["actor_type"] == "admin"
        for event in emitter.audit_events
        if str(event.get("action", "")).startswith("admin.announcement_")
    )


def test_concurrent_publish_changes_state_only_once() -> None:
    app, _ = build_app()
    admin = admin_client(app)
    row = create(admin)
    from drawoffer.modules.announcements import service

    with app.state.session_factory() as db:
        admin_user = db.scalar(select(User).where(User.email == "admin@example.test"))
        assert service._transition(
            db, int(row["id"]), "draft",
            {"status": "published", "published_at": datetime.now(timezone.utc),
             "published_by": admin_user.id, "updated_by": admin_user.id},
        ) is True
        assert service._transition(
            db, int(row["id"]), "draft",
            {"status": "published", "published_at": datetime.now(timezone.utc),
             "published_by": admin_user.id, "updated_by": admin_user.id},
        ) is False
    assert admin.post(f"/api/admin/announcements/{row['id']}/publish").status_code == 409
