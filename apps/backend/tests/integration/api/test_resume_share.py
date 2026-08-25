from contextlib import ExitStack

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.resumes.models import Resume, ResumeTemplate
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass

    def delete(self, _object_name: str) -> None:
        pass

    def delete_prefix(self, _prefix: str) -> None:
        pass


def build_app():
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="resume-share-test-secret-32-bytes",
            resume_version_limit=10,
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    with app.state.session_factory() as session:
        template = ResumeTemplate(
            key="share-test",
            name="分享测试模板",
            description="分享接口集成测试使用的模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style().model_dump(mode="json"),
            is_active=1,
        )
        session.add(template)
        session.commit()
        app.state.test_template_id = str(template.id)
    return app


def register(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def create_resume(client: TestClient, app):
    response = client.post(
        "/api/resumes",
        json={"title": "分享测试简历", "template_id": app.state.test_template_id},
    )
    assert response.status_code == 201
    return response


def open_clients(app, *emails: str) -> tuple[TestClient, ...]:
    stack = ExitStack()
    clients = [stack.enter_context(TestClient(app)) for _ in emails]
    for client, email in zip(clients, emails):
        register(client, email)
    return (*clients,)


def test_create_share_public_read_and_overwrite() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "owner@example.com")

        resume_id = create_resume(owner, app).json()["resume"]["id"]

        # 未分享时查询为空
        assert owner.get(f"/api/resumes/{resume_id}/share").json()["share"] is None

        created = owner.post(f"/api/resumes/{resume_id}/share")
        assert created.status_code == 200
        share = created.json()["share"]
        assert share["share_visibility"] == "public"
        assert share["share_expires_at"] is None
        assert share["share_created_at"]
        first_token = share["share_token"]
        assert len(first_token) >= 20

        # 公开免登录读取，响应只含脱敏字段
        public = guest.get(f"/api/share/{first_token}")
        assert public.status_code == 200
        payload = public.json()
        assert set(payload) == {"data", "style", "sharer"}
        assert set(payload["sharer"]) == {"nickname", "avatar_url"}
        assert payload["sharer"]["nickname"]
        assert payload["data"]["semantic_sections"]
        assert payload["style"]["manifest"]["renderer_key"] == "flow"

        # 覆盖：新 token 生效，旧 token 立即失效
        overwritten = owner.post(f"/api/resumes/{resume_id}/share")
        assert overwritten.status_code == 200
        second_token = overwritten.json()["share"]["share_token"]
        assert second_token != first_token
        assert guest.get(f"/api/share/{first_token}").status_code == 404
        assert guest.get(f"/api/share/{second_token}").status_code == 200

        # 不存在的 token 同样 404
        assert guest.get("/api/share/not-a-real-token").status_code == 404


def test_create_share_with_requested_visibility() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "owner@example.com")

        resume_id = create_resume(owner, app).json()["resume"]["id"]

        # 创建时指定仅自己可见，公开访问立即失效
        created = owner.post(
            f"/api/resumes/{resume_id}/share",
            json={"visibility": "private"},
        )
        assert created.status_code == 200
        share = created.json()["share"]
        assert share["share_visibility"] == "private"
        token = share["share_token"]
        assert guest.get(f"/api/share/{token}").status_code == 404

        # 覆盖时同样可指定可见性：改为所有人可见后公开可读
        overwritten = owner.post(
            f"/api/resumes/{resume_id}/share",
            json={"visibility": "public"},
        )
        assert overwritten.status_code == 200
        new_token = overwritten.json()["share"]["share_token"]
        assert overwritten.json()["share"]["share_visibility"] == "public"
        assert guest.get(f"/api/share/{new_token}").status_code == 200


def test_create_share_with_requested_expiry() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "owner@example.com")

        resume_id = create_resume(owner, app).json()["resume"]["id"]

        # 创建时指定有效期（7 天后过期）
        expires_at = "2099-01-01T00:00:00+00:00"
        created = owner.post(
            f"/api/resumes/{resume_id}/share",
            json={"expires_at": expires_at},
        )
        assert created.status_code == 200
        share = created.json()["share"]
        assert share["share_expires_at"].startswith("2099-01-01T00:00:00")

        # 未过期时公开可读
        token = share["share_token"]
        assert guest.get(f"/api/share/{token}").status_code == 200

        # 已过期的时间创建后立即失效
        expired = owner.post(
            f"/api/resumes/{resume_id}/share",
            json={"expires_at": "2000-01-01T00:00:00+00:00"},
        )
        assert expired.status_code == 200
        expired_token = expired.json()["share"]["share_token"]
        assert guest.get(f"/api/share/{expired_token}").status_code == 404


def test_private_visibility_access_matrix() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        other = stack.enter_context(TestClient(app))
        register(owner, "owner@example.com")
        register(other, "other@example.com")

        resume_id = create_resume(owner, app).json()["resume"]["id"]
        token = owner.post(f"/api/resumes/{resume_id}/share").json()["share"][
            "share_token"
        ]

        updated = owner.patch(
            f"/api/resumes/{resume_id}/share", json={"visibility": "private"}
        )
        assert updated.status_code == 200
        assert updated.json()["share"]["share_visibility"] == "private"

        # 未登录与非所有者一律失效
        assert guest.get(f"/api/share/{token}").status_code == 404
        assert other.get(f"/api/share/{token}").status_code == 404
        # 所有者登录可读
        assert owner.get(f"/api/share/{token}").status_code == 200

        # 改回 public 后免登录可读
        owner.patch(f"/api/resumes/{resume_id}/share", json={"visibility": "public"})
        assert guest.get(f"/api/share/{token}").status_code == 200


def test_expiry_renew_and_delete() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "owner@example.com")

        resume_id = create_resume(owner, app).json()["resume"]["id"]
        token = owner.post(f"/api/resumes/{resume_id}/share").json()["share"][
            "share_token"
        ]

        # 指定过去时间 → 已过期，访问失效
        expired = owner.patch(
            f"/api/resumes/{resume_id}/share",
            json={"expires_at": "2020-01-01T00:00:00Z"},
        )
        assert expired.status_code == 200
        assert guest.get(f"/api/share/{token}").status_code == 404

        # 续期到未来 → 恢复可访问
        renewed = owner.patch(
            f"/api/resumes/{resume_id}/share",
            json={"expires_at": "2099-01-01T00:00:00Z"},
        )
        assert renewed.status_code == 200
        assert renewed.json()["share"]["share_expires_at"] is not None
        assert guest.get(f"/api/share/{token}").status_code == 200

        # 续期为 null → 长期有效
        permanent = owner.patch(
            f"/api/resumes/{resume_id}/share", json={"expires_at": None}
        )
        assert permanent.status_code == 200
        assert permanent.json()["share"]["share_expires_at"] is None

        # 删除后失效且状态为空
        deleted = owner.delete(f"/api/resumes/{resume_id}/share")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}
        assert guest.get(f"/api/share/{token}").status_code == 404
        assert owner.get(f"/api/resumes/{resume_id}/share").json()["share"] is None

        # 重复删除保持幂等
        assert owner.delete(f"/api/resumes/{resume_id}/share").status_code == 200


def test_share_content_tracks_latest_formal_version() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "owner@example.com")

        created = create_resume(owner, app)
        resume = created.json()["resume"]
        resume_id = resume["id"]
        token = owner.post(f"/api/resumes/{resume_id}/share").json()["share"][
            "share_token"
        ]

        # 草稿修改（未保存正式版本）：分享内容不变
        draft_data = resume["data"]
        draft_data["basics"]["headline"] = "草稿改动"
        owner.put(
            f"/api/resumes/{resume_id}",
            json={"data": draft_data, "base_lock_version": 1},
        )
        assert (
            guest.get(f"/api/share/{token}").json()["data"]["basics"]["headline"]
            != "草稿改动"
        )

        # 保存正式版本：分享内容更新为最新正式版本
        manual = owner.post(f"/api/resumes/{resume_id}/versions")
        assert manual.status_code == 201
        assert (
            guest.get(f"/api/share/{token}").json()["data"]["basics"]["headline"]
            == "草稿改动"
        )


def test_delete_resume_invalidates_share_and_ownership_is_enforced() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        other = stack.enter_context(TestClient(app))
        register(owner, "owner@example.com")
        register(other, "other@example.com")

        resume_id = create_resume(owner, app).json()["resume"]["id"]
        token = owner.post(f"/api/resumes/{resume_id}/share").json()["share"][
            "share_token"
        ]

        # 非所有者无法管理分享
        assert other.get(f"/api/resumes/{resume_id}/share").status_code == 404
        assert other.post(f"/api/resumes/{resume_id}/share").status_code == 404
        assert (
            other.patch(
                f"/api/resumes/{resume_id}/share", json={"visibility": "public"}
            ).status_code
            == 404
        )
        assert other.delete(f"/api/resumes/{resume_id}/share").status_code == 404

        # 删除简历后旧链接失效
        assert owner.delete(f"/api/resumes/{resume_id}").status_code == 200
        assert other.get(f"/api/share/{token}").status_code == 404

        # 分享字段随简历删除，未残留孤儿 token
        with app.state.session_factory() as session:
            assert session.scalar(
                select(Resume).where(Resume.share_token == token)
            ) is None
