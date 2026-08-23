from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.llm.service import LLMError
from linkcv.modules.resumes.models import ResumeTemplate, ResumeVersion
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass

    def delete(self, _object_name: str) -> None:
        pass

    def delete_prefix(self, _prefix: str) -> None:
        pass


def build_app(version_limit: int = 10):
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="resume-lifecycle-test-secret-32-bytes",
            resume_version_limit=version_limit,
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    with app.state.session_factory() as session:
        template = ResumeTemplate(
            key="blank-cn",
            name="空白简历",
            description="测试默认模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style().model_dump(mode="json"),
            is_active=1,
        )
        session.add(template)
        session.commit()
        app.state.test_template_id = str(template.id)
    return app


def register(client: TestClient, email: str = "owner@example.com") -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def create_resume(client: TestClient, app, title: str = "测试简历"):
    return client.post(
        "/api/resumes",
        json={"title": title, "template_id": app.state.test_template_id},
    )


class FakeResumeAiService:
    def __init__(self, replacement: str = "负责核心接口建设，将响应耗时降低 30%。") -> None:
        self.replacement = replacement
        self.calls = []
        self.error_code: str | None = None

    async def structured_chat(self, user_id, messages, *, source, response_model):
        self.calls.append({"user_id": user_id, "messages": messages, "source": source})
        if self.error_code:
            raise LLMError(self.error_code, "llmcall_resume_ai_fixture")
        return SimpleNamespace(
            value=response_model(replacement=self.replacement),
            call_id="llmcall_resume_ai_fixture",
        )


def test_resume_inline_ai_edit_uses_owned_resume_and_selected_text_only() -> None:
    app = build_app()
    fake_llm = FakeResumeAiService()
    app.state.llm_service = fake_llm
    with TestClient(app) as client:
        register(client)
        resume_id = create_resume(client, app).json()["resume"]["id"]

        response = client.post(
            f"/api/resumes/{resume_id}/ai-edit",
            json={
                "selected_text": "负责核心接口建设",
                "instruction": "增加量化结果，但不要虚构事实",
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "replacement": fake_llm.replacement,
            "call_id": "llmcall_resume_ai_fixture",
        }
        assert len(fake_llm.calls) == 1
        call = fake_llm.calls[0]
        assert call["source"] == "resume_inline_edit"
        prompt = "\n".join(message.content for message in call["messages"])
        assert "负责核心接口建设" in prompt
        assert "增加量化结果" in prompt
        assert "测试简历" not in prompt

        client.post("/api/auth/logout")
        register(client, "stranger@example.com")
        forbidden = client.post(
            f"/api/resumes/{resume_id}/ai-edit",
            json={"selected_text": "原文", "instruction": "精简"},
        )
        assert forbidden.status_code == 404
        assert forbidden.json() == {"error": "RESUME_NOT_FOUND"}
        assert len(fake_llm.calls) == 1


def test_resume_inline_ai_edit_validates_payload_and_maps_unavailable_model() -> None:
    app = build_app()
    fake_llm = FakeResumeAiService()
    fake_llm.error_code = "LLM_CHAT_NOT_CONFIGURED"
    app.state.llm_service = fake_llm
    with TestClient(app) as client:
        register(client)
        resume_id = create_resume(client, app).json()["resume"]["id"]

        invalid = client.post(
            f"/api/resumes/{resume_id}/ai-edit",
            json={"selected_text": "   ", "instruction": "精简"},
        )
        assert invalid.status_code == 422
        assert fake_llm.calls == []

        unavailable = client.post(
            f"/api/resumes/{resume_id}/ai-edit",
            json={"selected_text": "原文", "instruction": "精简"},
        )
        assert unavailable.status_code == 503
        assert unavailable.json() == {
            "error": "LLM_CHAT_NOT_CONFIGURED",
            "callId": "llmcall_resume_ai_fixture",
        }


def test_blank_create_update_versions_and_restore() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        created = create_resume(client, app)
        assert created.status_code == 201
        resume = created.json()["resume"]
        assert resume["data"]["schema_version"] == "1.0"
        assert resume["style"]["schema_version"] == "1.0"
        assert resume["lock_version"] == 1
        resume_id = resume["id"]

        with app.state.session_factory() as session:
            initial = session.scalar(
                select(ResumeVersion).where(ResumeVersion.resume_id == int(resume_id))
            )
            assert initial is not None
            assert (initial.version_no, initial.reason) == (1, "initial")
            assert initial.name == "初始版本"

        first_data = resume["data"]
        first_data["basics"]["headline"] = "第一次保存"
        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={"data": first_data, "base_lock_version": 1},
        )
        assert updated.status_code == 200
        assert updated.json()["resume"]["lock_version"] == 2

        conflict = client.put(
            f"/api/resumes/{resume_id}",
            json={"title": "过期写入", "base_lock_version": 1},
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_EDIT_CONFLICT"}

        versions_before_manual = client.get(
            f"/api/resumes/{resume_id}/versions"
        ).json()["versions"]
        assert [(item["version_no"], item["reason"]) for item in versions_before_manual] == [
            (1, "initial")
        ]

        invalid = client.put(
            f"/api/resumes/{resume_id}",
            json={
                "data": {**first_data, "schema_version": "99.0"},
                "base_lock_version": 2,
            },
        )
        assert invalid.status_code == 400
        assert invalid.json() == {"error": "INVALID_RESUME_DOCUMENT"}

        manual = client.post(
            f"/api/resumes/{resume_id}/versions",
            json={"name": "  投递 版本  "},
        )
        assert manual.status_code == 201
        assert manual.json()["version"]["reason"] == "manual"
        assert manual.json()["version"]["version_no"] == 2
        assert manual.json()["version"]["name"] == "投递 版本"

        second_data = updated.json()["resume"]["data"]
        second_data["basics"]["headline"] = "尚未保存版本的草稿"
        saved = client.put(
            f"/api/resumes/{resume_id}",
            json={"data": second_data, "base_lock_version": 2},
        )
        assert saved.status_code == 200

        restored = client.post(f"/api/resumes/{resume_id}/versions/1/restore")
        assert restored.status_code == 200
        restored_resume = restored.json()["resume"]
        assert restored_resume["data"]["basics"]["headline"] == "后端开发工程师"
        assert restored_resume["lock_version"] == 4

        versions = client.get(f"/api/resumes/{resume_id}/versions").json()["versions"]
        assert [(item["version_no"], item["reason"]) for item in versions] == [
            (2, "manual"),
            (1, "initial"),
        ]


def test_manual_version_name_rejects_blank_and_overlong_values() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume_id = create_resume(client, app).json()["resume"]["id"]

        blank = client.post(
            f"/api/resumes/{resume_id}/versions",
            json={"name": " \t\n"},
        )
        assert blank.status_code == 400
        assert blank.json() == {"error": "INVALID_RESUME_VERSION_NAME"}

        overlong = client.post(
            f"/api/resumes/{resume_id}/versions",
            json={"name": "名" * 81},
        )
        assert overlong.status_code == 400
        assert overlong.json() == {"error": "INVALID_RESUME_VERSION_NAME"}
        assert [
            item["version_no"]
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [1]


def test_historical_version_can_be_renamed_without_changing_snapshot() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume_id = create_resume(client, app).json()["resume"]["id"]
        created = client.post(
            f"/api/resumes/{resume_id}/versions",
            json={"name": "投递初版"},
        )
        assert created.status_code == 201
        original_data = created.json()["version"]["data"]

        renamed = client.patch(
            f"/api/resumes/{resume_id}/versions/2",
            json={"name": "  投递终版  "},
        )
        assert renamed.status_code == 200
        assert renamed.json()["version"]["name"] == "投递终版"
        assert renamed.json()["version"]["data"] == original_data

        blank = client.patch(
            f"/api/resumes/{resume_id}/versions/2",
            json={"name": " \t\n"},
        )
        assert blank.status_code == 400
        assert blank.json() == {"error": "INVALID_RESUME_VERSION_NAME"}

        versions = client.get(f"/api/resumes/{resume_id}/versions").json()["versions"]
        assert versions[0]["name"] == "投递终版"


def test_template_creation_copies_snapshot_and_filters_inactive_templates() -> None:
    app = build_app()
    with app.state.session_factory() as session:
        active = ResumeTemplate(
            key="classic-cn",
            name="经典中文",
            description="示例模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style().model_dump(mode="json"),
            is_active=1,
        )
        inactive = ResumeTemplate(
            key="inactive",
            name="已停用",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style().model_dump(mode="json"),
            is_active=0,
        )
        session.add_all([active, inactive])
        session.commit()
        active_id = str(active.id)
        inactive_id = str(inactive.id)

    with TestClient(app) as client:
        register(client)
        listed = client.get("/api/resume-templates")
        assert listed.status_code == 200
        listed_ids = [item["id"] for item in listed.json()["templates"]]
        assert active_id in listed_ids
        assert inactive_id not in listed_ids

        created = client.post(
            "/api/resumes",
            json={"title": "模板简历", "template_id": active_id},
        )
        assert created.status_code == 201
        assert created.json()["resume"]["source_type"] == "template"
        assert created.json()["resume"]["template_id"] == active_id

        rejected = client.post(
            "/api/resumes", json={"title": "停用模板", "template_id": inactive_id}
        )
        assert rejected.status_code == 422
        assert rejected.json() == {"error": "TEMPLATE_INACTIVE"}


def test_resume_limit_rejects_eleventh_and_delete_releases_slot() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume_ids = []
        for index in range(10):
            created = create_resume(client, app, f"简历 {index + 1}")
            assert created.status_code == 201
            resume_ids.append(created.json()["resume"]["id"])

        rejected = create_resume(client, app, "第十一份")
        assert rejected.status_code == 409
        assert rejected.json() == {"error": "RESUME_LIMIT_REACHED"}
        assert len(client.get("/api/resumes").json()["resumes"]) == 10

        assert client.delete(f"/api/resumes/{resume_ids[0]}").status_code == 200
        replacement = create_resume(client, app, "替补简历")
        assert replacement.status_code == 201
        assert len(client.get("/api/resumes").json()["resumes"]) == 10


def test_create_requires_name_and_template_and_rejects_normalized_duplicates() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        missing_name = client.post(
            "/api/resumes", json={"template_id": app.state.test_template_id}
        )
        missing_template = client.post("/api/resumes", json={"title": "测试"})
        created = create_resume(client, app, "  Project   Alpha  ")
        duplicate = create_resume(client, app, "project alpha")

        assert missing_name.status_code == 400
        assert missing_name.json() == {"error": "INVALID_RESUME_TITLE"}
        assert missing_template.status_code == 400
        assert missing_template.json() == {"error": "TEMPLATE_REQUIRED"}
        assert created.status_code == 201
        assert created.json()["resume"]["title"] == "Project Alpha"
        assert duplicate.status_code == 409
        assert duplicate.json() == {"error": "RESUME_TITLE_CONFLICT"}


def test_rename_allows_unchanged_historical_name_but_rejects_another_resume_name() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        first = create_resume(client, app, "第一份").json()["resume"]
        second = create_resume(client, app, "第二份").json()["resume"]

        unchanged = client.put(
            f"/api/resumes/{first['id']}",
            json={"title": "  第一份  ", "base_lock_version": first["lock_version"]},
        )
        conflict = client.put(
            f"/api/resumes/{second['id']}",
            json={"title": "第一份", "base_lock_version": second["lock_version"]},
        )

        assert unchanged.status_code == 200
        assert unchanged.json()["resume"]["title"] == "第一份"
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_TITLE_CONFLICT"}

def test_other_user_cannot_access_resume_versions() -> None:
    app = build_app()
    with TestClient(app) as owner:
        register(owner, "owner@example.com")
        resume_id = create_resume(owner, app).json()["resume"]["id"]

    with TestClient(app) as stranger:
        register(stranger, "stranger@example.com")
        assert stranger.get(f"/api/resumes/{resume_id}").status_code == 404
        assert stranger.put(
            f"/api/resumes/{resume_id}",
            json={"title": "越权修改", "base_lock_version": 1},
        ).status_code == 404
        assert stranger.delete(f"/api/resumes/{resume_id}").status_code == 404
        assert stranger.get(f"/api/resumes/{resume_id}/versions").status_code == 404
        assert stranger.post(f"/api/resumes/{resume_id}/versions").status_code == 404
        assert stranger.delete(f"/api/resumes/{resume_id}/versions/1").status_code == 404
        assert (
            stranger.post(f"/api/resumes/{resume_id}/versions/1/restore").status_code
            == 404
        )


def test_version_limit_requires_user_to_delete_an_old_snapshot() -> None:
    app = build_app(version_limit=3)
    with TestClient(app) as client:
        register(client)
        resume_id = create_resume(client, app).json()["resume"]["id"]

        for _ in range(2):
            assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        rejected = client.post(f"/api/resumes/{resume_id}/versions")
        assert rejected.status_code == 409
        assert rejected.json() == {"error": "RESUME_VERSION_LIMIT_REACHED"}
        versions = client.get(f"/api/resumes/{resume_id}/versions").json()["versions"]
        assert [(item["version_no"], item["reason"]) for item in versions] == [
            (3, "manual"),
            (2, "manual"),
            (1, "initial"),
        ]
        assert [item["name"] for item in versions] == ["版本 3", "版本 2", "初始版本"]

        deleted = client.delete(f"/api/resumes/{resume_id}/versions/1")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}

        replacement = client.post(f"/api/resumes/{resume_id}/versions")
        assert replacement.status_code == 201
        assert replacement.json()["version"]["version_no"] == 4
        assert [
            item["version_no"]
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [4, 3, 2]


def test_latest_version_cannot_be_deleted() -> None:
    app = build_app(version_limit=3)
    with TestClient(app) as client:
        register(client)
        resume_id = create_resume(client, app).json()["resume"]["id"]
        assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        rejected = client.delete(f"/api/resumes/{resume_id}/versions/2")

        assert rejected.status_code == 409
        assert rejected.json() == {"error": "LATEST_RESUME_VERSION_REQUIRED"}
        assert [
            item["version_no"]
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [2, 1]


def test_restore_does_not_create_a_version_for_an_unversioned_draft() -> None:
    app = build_app(version_limit=2)
    with TestClient(app) as client:
        register(client)
        created = create_resume(client, app).json()["resume"]
        resume_id = created["id"]
        assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        draft = created["data"]
        draft["basics"]["headline"] = "尚未建立版本的草稿"
        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={"data": draft, "base_lock_version": 1},
        )
        assert updated.status_code == 200

        restored = client.post(f"/api/resumes/{resume_id}/versions/1/restore")

        assert restored.status_code == 200
        current = client.get(f"/api/resumes/{resume_id}").json()["resume"]
        assert current["data"]["basics"]["headline"] == "后端开发工程师"
        assert current["lock_version"] == 3
        assert [
            (item["version_no"], item["reason"])
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [(2, "manual"), (1, "initial")]


def test_restore_without_unversioned_draft_does_not_need_a_version_slot() -> None:
    app = build_app(version_limit=2)
    with TestClient(app) as client:
        register(client)
        resume_id = create_resume(client, app).json()["resume"]["id"]
        assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        restored = client.post(f"/api/resumes/{resume_id}/versions/1/restore")

        assert restored.status_code == 200
        assert restored.json()["resume"]["lock_version"] == 2
        assert [
            (item["version_no"], item["reason"])
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [(2, "manual"), (1, "initial")]


def test_restore_at_version_limit_still_replaces_the_current_draft() -> None:
    app = build_app(version_limit=3)
    with TestClient(app) as client:
        register(client)
        created = create_resume(client, app).json()["resume"]
        resume_id = created["id"]
        for _ in range(2):
            assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        draft = created["data"]
        draft["basics"]["headline"] = "尚未建立版本的草稿"
        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={"data": draft, "base_lock_version": 1},
        )
        assert updated.status_code == 200

        restored = client.post(f"/api/resumes/{resume_id}/versions/1/restore")

        assert restored.status_code == 200
        current = client.get(f"/api/resumes/{resume_id}").json()["resume"]
        assert current["data"]["basics"]["headline"] == "后端开发工程师"
        assert current["lock_version"] == 3
        assert [
            item["version_no"]
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [3, 2, 1]


def test_overlong_resume_id_is_rejected_without_integer_conversion() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        response = client.get(f"/api/resumes/{'9' * 5000}")

        assert response.status_code == 404
        assert response.json() == {"error": "RESUME_NOT_FOUND"}


def test_smart_one_page_is_persisted_and_restored_with_versions() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume = create_resume(client, app).json()["resume"]
        resume_id = resume["id"]
        style = resume["style"]
        assert style["smart_one_page"] is False

        style["smart_one_page"] = True
        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={"style": style, "base_lock_version": 1},
        )
        assert updated.status_code == 200
        assert updated.json()["resume"]["style"]["smart_one_page"] is True
        version = client.post(f"/api/resumes/{resume_id}/versions")
        assert version.status_code == 201
        assert version.json()["version"]["version_no"] == 2

        style["smart_one_page"] = False
        assert client.put(
            f"/api/resumes/{resume_id}",
            json={"style": style, "base_lock_version": 2},
        ).status_code == 200
        restored = client.post(f"/api/resumes/{resume_id}/versions/2/restore")

        assert restored.status_code == 200
        assert restored.json()["resume"]["style"]["smart_one_page"] is True
