import base64
from collections.abc import Iterator
from contextlib import ExitStack
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.core.config import Settings
from linkresume.main import create_app
from linkresume.modules.resumes.models import Resume, ResumeTemplate
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import canonical_template_payload


class FakeObjectResponse:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def stream(self, _size: int) -> Iterator[bytes]:
        yield self.data

    def close(self) -> None:
        pass

    def release_conn(self) -> None:
        pass


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data

    def get(self, object_name: str) -> FakeObjectResponse:
        return FakeObjectResponse(self.objects[object_name])

    def stat(self, object_name: str) -> SimpleNamespace:
        return SimpleNamespace(size=len(self.objects[object_name]))

    def delete(self, object_name: str) -> None:
        self.objects.pop(object_name, None)

    def delete_prefix(self, prefix: str) -> None:
        for object_name in list(self.objects):
            if object_name.startswith(prefix):
                self.objects.pop(object_name)


class FakeRenderer:
    def __init__(self) -> None:
        self.payloads: list[dict] = []

    def render(self, payload: dict) -> bytes:
        self.payloads.append(payload)
        return b"%PDF-1.3\nshared-resume"


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
    app.state.resume_pdf_renderer = FakeRenderer()
    with app.state.session_factory() as session:
        template_data, template_style = canonical_template_payload(key="share-test")
        template = ResumeTemplate(
            key="share-test",
            name="分享测试模板",
            description="分享接口集成测试使用的模板",
            data_json=template_data,
            style_json=template_style,
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
        assert share["share_allow_download"] is True
        assert share["share_created_at"]
        first_token = share["share_token"]
        assert len(first_token) >= 20

        # 公开免登录读取，响应只含脱敏字段
        public = guest.get(f"/api/share/{first_token}")
        assert public.status_code == 200
        payload = public.json()
        assert set(payload) == {
            "data",
            "style",
            "layout_plan",
            "assets",
            "sharer",
            "allow_download",
        }
        assert payload["allow_download"] is True
        assert payload["assets"] == {}
        assert set(payload["sharer"]) == {"nickname", "avatar_url"}
        assert payload["sharer"]["nickname"]
        assert payload["data"]["schema_version"] == "canonical-resume.v1"
        assert payload["layout_plan"]["schema_version"] == "layout-plan.v1"

        # 覆盖：新 token 生效，旧 token 立即失效
        overwritten = owner.post(f"/api/resumes/{resume_id}/share")
        assert overwritten.status_code == 200
        second_token = overwritten.json()["share"]["share_token"]
        assert second_token != first_token
        assert guest.get(f"/api/share/{first_token}").status_code == 404
        assert guest.get(f"/api/share/{second_token}").status_code == 200

        # 不存在的 token 同样 404
        assert guest.get("/api/share/not-a-real-token").status_code == 404


def test_public_share_embeds_only_images_from_the_current_saved_draft() -> None:
    app = build_app()
    image = b"fictional-png"
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "image-owner@example.com")

        created = create_resume(owner, app).json()["resume"]
        resume_id = created["id"]
        uploaded = owner.post(
            f"/api/resumes/{resume_id}/assets",
            json={
                "file_name": "avatar.png",
                "data_url": (
                    "data:image/png;base64,"
                    + base64.b64encode(image).decode("ascii")
                ),
            },
        )
        assert uploaded.status_code == 201
        asset_url = uploaded.json()["asset"]["url"]

        data = created["data"]
        data["identity"]["avatar"] = {
            "node_id": "node_avatar00000000001",
            "source_refs": [],
            "media_kind": "avatar",
            "src": asset_url,
            "alt": "虚构头像",
            "width": 96,
            "width_unit": "px",
            "height_px": None,
            "align": None,
            "system_fallback": False,
        }
        saved = owner.put(
            f"/api/resumes/{resume_id}",
            json={"data": data, "base_lock_version": created["lock_version"]},
        )
        assert saved.status_code == 200

        token = owner.post(f"/api/resumes/{resume_id}/share").json()["share"][
            "share_token"
        ]
        public = guest.get(f"/api/share/{token}")

        assert public.status_code == 200
        assert public.headers["cache-control"] == "private, no-store"
        assert public.json()["assets"] == {
            asset_url: (
                "data:image/png;base64,"
                + base64.b64encode(image).decode("ascii")
            )
        }


def test_public_share_pdf_uses_server_renderer_and_smart_one_page() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "pdf-share-owner@example.com")

        created = create_resume(owner, app).json()["resume"]
        token = owner.post(f"/api/resumes/{created['id']}/share").json()["share"][
            "share_token"
        ]

        downloaded = guest.get(f"/api/share/{token}/pdf")

        assert downloaded.status_code == 200
        assert downloaded.content == b"%PDF-1.3\nshared-resume"
        assert downloaded.headers["content-type"] == "application/pdf"
        assert downloaded.headers["cache-control"] == "private, no-store"
        assert downloaded.headers["x-content-type-options"] == "nosniff"
        assert downloaded.headers["x-linkresume-pdf-lock-version"] == str(
            created["lock_version"]
        )
        assert "%E5%88%86%E4%BA%AB%E6%B5%8B%E8%AF%95%E7%AE%80%E5%8E%86.pdf" in (
            downloaded.headers["content-disposition"]
        )
        rendered = app.state.resume_pdf_renderer.payloads[-1]
        assert rendered["protocol_version"] == 1
        assert rendered["style"]["portable"]["smart_one_page"] is True
        assert set(rendered) == {
            "protocol_version",
            "title",
            "data",
            "style",
            "layout_plan",
            "assets",
        }


def test_share_download_permission_hides_capability_and_blocks_pdf_for_everyone() -> None:
    app = build_app()
    with ExitStack() as stack:
        owner = stack.enter_context(TestClient(app))
        guest = stack.enter_context(TestClient(app))
        register(owner, "download-owner@example.com")

        created = create_resume(owner, app).json()["resume"]
        share = owner.post(
            f"/api/resumes/{created['id']}/share",
            json={"allow_download": False},
        ).json()["share"]
        token = share["share_token"]
        assert share["share_allow_download"] is False

        public = guest.get(f"/api/share/{token}")
        assert public.status_code == 200
        assert public.json()["allow_download"] is False
        assert guest.get(f"/api/share/{token}/pdf").status_code == 404
        assert owner.get(f"/api/share/{token}/pdf").status_code == 404

        enabled = owner.patch(
            f"/api/resumes/{created['id']}/share",
            json={"allow_download": True},
        )
        assert enabled.status_code == 200
        assert enabled.json()["share"]["share_allow_download"] is True
        assert guest.get(f"/api/share/{token}/pdf").status_code == 200


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
        assert guest.get(f"/api/share/{token}/pdf").status_code == 404
        assert other.get(f"/api/share/{token}/pdf").status_code == 404
        # 所有者登录可读
        assert owner.get(f"/api/share/{token}").status_code == 200
        assert owner.get(f"/api/share/{token}/pdf").status_code == 200

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


def test_share_content_tracks_current_saved_draft() -> None:
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

        # 自动保存草稿后，无需创建正式版本，分享内容立即更新。
        draft_data = resume["data"]
        draft_data["identity"]["headline"] = {
            "node_id": "node_headline00000001",
            "source_refs": [],
            "value": "草稿改动",
        }
        saved = owner.put(
            f"/api/resumes/{resume_id}",
            json={
                "data": draft_data,
                "base_lock_version": resume["lock_version"],
            },
        )
        assert saved.status_code == 200
        assert (
            guest.get(f"/api/share/{token}").json()["data"]["identity"]["headline"]["value"]
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
