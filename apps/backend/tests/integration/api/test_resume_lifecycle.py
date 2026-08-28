from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.application.resumes import service as resume_service
from linkcv.core.config import Settings
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.llm.dependencies import get_llm_service
from linkcv.modules.llm.service import LLMError
from linkcv.modules.resumes.models import Resume, ResumeTemplate, ResumeVersion
from linkcv.modules.resumes.routes import resume_content_hash
from linkcv.modules.resumes.schemas import (
    SemanticClassificationModelResult,
    SemanticClassificationSuggestion,
)
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


class FakeSemanticClassificationService:
    def __init__(self, *, unavailable: bool = False, on_call=None) -> None:
        self.unavailable = unavailable
        self.on_call = on_call
        self.calls = 0

    async def structured_chat(self, *_args, **_kwargs):
        self.calls += 1
        if self.on_call is not None:
            self.on_call()
        if self.unavailable:
            raise LLMError("LLM_UNAVAILABLE", "llmcall_semantic_test")
        return SimpleNamespace(
            value=SemanticClassificationModelResult(
                suggestions=[
                    SemanticClassificationSuggestion(
                        section_id="semantic_growth",
                        semantic_kind="work",
                        confidence=0.92,
                        reason="正文描述了企业工作职责",
                    )
                ]
            )
        )


def add_unclassified_section(client: TestClient, resume: dict) -> dict:
    data = resume["data"]
    data["sections"]["custom_sections"].append(
        {
            "id": "custom_growth",
            "title": "成长轨迹",
            "items": [
                {
                    "id": "custom_growth_item",
                    "title": None,
                    "subtitle": None,
                    "content": {
                        "format": "markdown",
                        "content": "在虚构公司负责客户运营和数据复盘",
                    },
                    "source_refs": [],
                }
            ],
        }
    )
    data["semantic_sections"].append(
        {
            "id": "semantic_growth",
            "semantic_kind": "custom",
            "display_title": "成长轨迹",
            "semantic_source": "import",
            "semantic_confidence": None,
            "content_key": "custom_sections",
            "custom_section_id": "custom_growth",
        }
    )
    response = client.put(
        f"/api/resumes/{resume['id']}",
        json={"data": data, "base_lock_version": resume["lock_version"]},
    )
    assert response.status_code == 200
    return response.json()["resume"]


def test_blank_create_update_versions_and_restore() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        created = create_resume(client, app)
        assert created.status_code == 201
        resume = created.json()["resume"]
        assert resume["data"]["semantic_sections"][0]["semantic_kind"] == "basics"
        assert resume["style"]["manifest"]["renderer_key"] == "flow"
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


def test_update_normalizes_tiptap_ordered_list_noop_type() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume = create_resume(client, app).json()["resume"]
        data = resume["data"]
        data["sections"]["custom_sections"] = [
            {
                "id": "blk_1111111111111111",
                "title": "工作经历",
                "items": [
                    {
                        "id": "item_1111111111111111",
                        "title": None,
                        "subtitle": None,
                        "content": {
                            "format": "tiptap-json",
                            "content": {
                                "type": "doc",
                                "content": [
                                    {
                                        "type": "orderedList",
                                        "attrs": {"start": 1, "type": None},
                                        "content": [
                                            {
                                                "type": "listItem",
                                                "content": [
                                                    {
                                                        "type": "paragraph",
                                                        "content": [
                                                            {
                                                                "type": "text",
                                                                "text": "第一项",
                                                            }
                                                        ],
                                                    }
                                                ],
                                            }
                                        ],
                                    }
                                ],
                            },
                        },
                        "source_refs": [],
                    }
                ],
            }
        ]
        data["semantic_sections"].append(
            {
                "id": "sem_1111111111111111",
                "semantic_kind": "work",
                "display_title": "工作经历",
                "semantic_source": "user",
                "semantic_confidence": None,
                "content_key": "custom_sections",
                "custom_section_id": "blk_1111111111111111",
            }
        )

        response = client.put(
            f"/api/resumes/{resume['id']}",
            json={"data": data, "base_lock_version": resume["lock_version"]},
        )

        assert response.status_code == 200
        saved_content = response.json()["resume"]["data"]["sections"][
            "custom_sections"
        ][0]["items"][0]["content"]["content"]
        assert saved_content["content"][0]["attrs"] == {"start": 1}


def test_semantic_classification_returns_scoped_suggestion_without_writing_resume() -> None:
    app = build_app()
    service = FakeSemanticClassificationService()
    app.dependency_overrides[get_llm_service] = lambda: service
    with TestClient(app) as client:
        register(client)
        resume = add_unclassified_section(
            client,
            create_resume(client, app).json()["resume"],
        )
        content_hash = resume_content_hash(resume["data"])

        response = client.post(
            f"/api/resumes/{resume['id']}/semantic-classification",
            json={"content_hash": content_hash, "section_ids": ["semantic_growth"]},
        )

        assert response.status_code == 200
        assert response.json() == {
            "content_hash": content_hash,
            "suggestions": [
                {
                    "section_id": "semantic_growth",
                    "semantic_kind": "work",
                    "confidence": 0.92,
                    "reason": "正文描述了企业工作职责",
                }
            ],
        }
        unchanged = client.get(f"/api/resumes/{resume['id']}").json()["resume"]
        assert unchanged["lock_version"] == resume["lock_version"]
        assert unchanged["data"] == resume["data"]

        repeated = client.post(
            f"/api/resumes/{resume['id']}/semantic-classification",
            json={"content_hash": content_hash, "section_ids": ["semantic_growth"]},
        )
        assert repeated.json() == response.json()
        assert service.calls == 1


def test_semantic_classification_rejects_stale_content_and_service_failure() -> None:
    app = build_app()
    service = FakeSemanticClassificationService(unavailable=True)
    app.dependency_overrides[get_llm_service] = lambda: service
    with TestClient(app) as client:
        register(client)
        resume = add_unclassified_section(
            client,
            create_resume(client, app).json()["resume"],
        )

        stale = client.post(
            f"/api/resumes/{resume['id']}/semantic-classification",
            json={"content_hash": "sha256:" + "0" * 64},
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "RESUME_SEMANTIC_CLASSIFICATION_STALE"}

        unavailable = client.post(
            f"/api/resumes/{resume['id']}/semantic-classification",
            json={"content_hash": resume_content_hash(resume["data"])},
        )
        assert unavailable.status_code == 503
        assert unavailable.json() == {
            "error": "RESUME_SEMANTIC_CLASSIFICATION_UNAVAILABLE"
        }


def test_semantic_classification_rechecks_content_after_model_returns() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume = add_unclassified_section(
            client,
            create_resume(client, app).json()["resume"],
        )

        def edit_during_model_call() -> None:
            with app.state.session_factory() as db:
                stored = db.get(Resume, int(resume["id"]))
                assert stored is not None
                next_data = dict(stored.data_json)
                next_data["basics"] = {
                    **next_data["basics"],
                    "headline": "模型调用期间的新编辑",
                }
                stored.data_json = next_data
                stored.lock_version += 1
                db.commit()

        service = FakeSemanticClassificationService(on_call=edit_during_model_call)
        app.dependency_overrides[get_llm_service] = lambda: service
        response = client.post(
            f"/api/resumes/{resume['id']}/semantic-classification",
            json={"content_hash": resume_content_hash(resume["data"])},
        )

        assert response.status_code == 409
        assert response.json() == {"error": "RESUME_SEMANTIC_CLASSIFICATION_STALE"}


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


def test_apply_template_atomically_preserves_content_and_updates_provenance() -> None:
    app = build_app()
    target_style = default_resume_style().model_copy(
        update={"template_key": "target-template-cn", "accent_color": "#3476D2"}
    )
    with app.state.session_factory() as session:
        target = ResumeTemplate(
            key="target-template-cn",
            name="目标模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=target_style.model_dump(mode="json"),
            is_active=1,
        )
        inactive = ResumeTemplate(
            key="inactive-target-cn",
            name="停用目标模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=target_style.model_dump(mode="json"),
            is_active=0,
        )
        session.add_all([target, inactive])
        session.commit()
        target_id = str(target.id)
        inactive_id = str(inactive.id)

    with TestClient(app) as client:
        register(client)
        original = create_resume(client, app).json()["resume"]
        original_data = original["data"]
        edited_data = {
            **original_data,
            "basics": {
                **original_data["basics"],
                "headline": "原子切换保留的最新内容",
            },
        }

        switched = client.post(
            f"/api/resumes/{original['id']}/apply-template",
            json={
                "template_id": target_id,
                "base_lock_version": 1,
                "title": "原子切换后的简历",
                "data": edited_data,
            },
        )
        assert switched.status_code == 200
        resume = switched.json()["resume"]
        assert resume["title"] == "原子切换后的简历"
        assert resume["data"] == edited_data
        assert resume["template_id"] == target_id
        assert resume["style"]["template_key"] == "target-template-cn"
        assert resume["lock_version"] == 2

        conflict = client.post(
            f"/api/resumes/{original['id']}/apply-template",
            json={"template_id": app.state.test_template_id, "base_lock_version": 1},
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_EDIT_CONFLICT"}

        rejected = client.post(
            f"/api/resumes/{original['id']}/apply-template",
            json={"template_id": inactive_id, "base_lock_version": 2},
        )
        assert rejected.status_code == 422
        assert rejected.json() == {"error": "TEMPLATE_INACTIVE"}


def test_apply_template_composition_failure_keeps_original_snapshot(monkeypatch) -> None:
    app = build_app()
    target_style = default_resume_style().model_copy(
        update={"template_key": "composition-failure-cn"}
    )
    with app.state.session_factory() as session:
        target = ResumeTemplate(
            key="composition-failure-cn",
            name="组合失败模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=target_style.model_dump(mode="json"),
            is_active=1,
        )
        session.add(target)
        session.commit()
        target_id = str(target.id)

    with TestClient(app) as client:
        register(client)
        original = create_resume(client, app).json()["resume"]

        def reject_composition(*_args, **_kwargs):
            raise ValueError("invalid composition")

        monkeypatch.setattr(resume_service, "template_content_assignments", reject_composition)
        rejected = client.post(
            f"/api/resumes/{original['id']}/apply-template",
            json={"template_id": target_id, "base_lock_version": 1},
        )

        assert rejected.status_code == 422
        assert rejected.json() == {"error": "TEMPLATE_COMPOSITION_INVALID"}
        current = client.get(f"/api/resumes/{original['id']}").json()["resume"]
        assert current["template_id"] == original["template_id"]
        assert current["style"] == original["style"]
        assert current["data"] == original["data"]
        assert current["lock_version"] == original["lock_version"]


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
