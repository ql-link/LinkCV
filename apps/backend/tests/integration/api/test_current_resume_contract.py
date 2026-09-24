"""Current content, independent copies and live application resume links."""
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.application.resumes.copy_service import copy_resume
from linkresume.core.errors import ApiError
from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.resumes.models import Resume, ResumeVersion
from tests.integration.api.test_interviews import build_app, register, create_job, create_resume


class ImageStorage:
    def __init__(self):
        self.objects = {}
        self.fail_copy = False

    def ensure_bucket(self):
        pass

    def stat(self, key):
        return SimpleNamespace(size=len(self.objects[key]))

    def get(self, key):
        content = self.objects[key]
        return SimpleNamespace(stream=lambda _: iter([content]), close=lambda: None, release_conn=lambda: None)

    def copy(self, source, target):
        self.objects[target] = self.objects[source]
        if self.fail_copy:
            raise RuntimeError("uncertain copy response")

    def delete(self, key):
        self.objects.pop(key, None)

    def delete_prefix(self, prefix):
        for key in list(self.objects):
            if key.startswith(prefix):
                self.delete(key)


def test_application_link_reads_current_title_and_can_clear_rebind_or_delete():
    app = build_app(ImageStorage())
    with TestClient(app) as client, TestClient(app) as other:
        register(client, "link-owner@example.test")
        register(other, "link-other@example.test")
        source = create_resume(client, app)
        foreign = create_resume(other, app)
        result = client.post("/api/job-applications", json={
            "job_description_id": create_job(client, "虚构关联公司"),
            "resume_id": source["id"],
        })
        assert result.status_code == 201, result.text
        application = result.json()["application"]
        url = f"/api/job-applications/{application['id']}"
        assert application["resume_id"] == source["id"]
        assert "resume_snapshot" not in application
        assert client.put(f"/api/resumes/{source['id']}", json={
            "title": "当前名称", "base_lock_version": source["lock_version"],
        }).status_code == 200
        application = client.get(url).json()["application"]
        assert application["resume_title_snapshot"] == "当前名称"
        updated = client.put(url, json={"notes": "保持关联", "base_lock_version": application["lock_version"]})
        assert updated.status_code == 200, updated.text
        application = updated.json()["application"]
        assert application["resume_id"] == source["id"]
        denied = client.put(url, json={"resume_id": foreign["id"], "base_lock_version": application["lock_version"]})
        assert denied.status_code == 404
        assert client.get(url).json()["application"]["resume_id"] == source["id"]
        cleared = client.put(url, json={"resume_id": None, "base_lock_version": application["lock_version"]})
        assert cleared.status_code == 200, cleared.text
        application = cleared.json()["application"]
        assert application["resume_id"] is None
        rebound = client.put(url, json={"resume_id": source["id"], "base_lock_version": application["lock_version"]})
        assert rebound.status_code == 200, rebound.text
        assert client.delete(f"/api/resumes/{source['id']}").status_code == 200
        retained = client.get(url)
        assert retained.status_code == 200
        assert retained.json()["application"]["resume_id"] is None
        assert retained.json()["application"]["resume_title_snapshot"] is None
        with app.state.session_factory() as db:
            assert db.get(JobApplication, int(application["id"])) is not None


def test_application_binding_does_not_copy_images_or_require_content_lock():
    storage = ImageStorage()
    storage.fail_copy = True
    app = build_app(storage)
    with TestClient(app) as client:
        register(client, "link-image@example.test")
        source = create_resume(client, app)
        with app.state.session_factory() as db:
            row = db.get(Resume, int(source["id"]))
            key = f"users/{row.user_id}/resumes/{row.id}/assets/avatar.png"
            storage.objects[key] = b"fixture-image-bytes"
            data = deepcopy(row.data_json)
            data["identity"]["avatar"] = {
                "node_id": "node_currentavatar0001", "source_refs": [], "media_kind": "avatar",
                "src": f"/api/resumes/{row.id}/assets/avatar.png", "alt": "张三",
                "width": None, "width_unit": None, "height_px": None,
                "align": None, "system_fallback": False,
            }
            row.data_json = data
            row.lock_version += 10
            db.commit()
        result = client.post("/api/job-applications", json={
            "job_description_id": create_job(client, "虚构无复制公司"),
            "resume_id": source["id"],
        })
        assert result.status_code == 201, result.text
        assert result.json()["application"]["resume_id"] == source["id"]
        assert storage.objects == {key: b"fixture-image-bytes"}


def copy_payload(resume, title="独立简历"):
    return {"title": title, "base_lock_version": resume["lock_version"],
            "client_request_id": str(uuid4())}


@pytest.mark.parametrize("failure", ["refresh", "commit_ack", "copy", "validation"])
def test_copy_compensation_respects_commit_boundary(monkeypatch, failure):
    storage = ImageStorage()
    app = build_app(storage)
    with TestClient(app) as client:
        register(client, "copy-boundary@example.test")
        source = create_resume(client, app)
        with app.state.session_factory() as db:
            row = db.get(Resume, int(source["id"]))
            user_id = row.user_id
            source_key = f"users/{user_id}/resumes/{row.id}/assets/avatar.png"
            storage.objects[source_key] = b"fixture-image-bytes"
            data = deepcopy(row.data_json)
            data["identity"]["avatar"] = {
                "node_id": "node_currentavatar0001", "source_refs": [], "media_kind": "avatar",
                "src": f"/api/resumes/{row.id}/assets/avatar.png", "alt": "张三",
                "width": None, "width_unit": None, "height_px": None, "align": None,
                "system_fallback": False,
            }
            row.data_json = data
            db.commit()

        payload = copy_payload(source)

        def fail(*args, **kwargs):
            raise RuntimeError("simulated copy boundary failure")

        with app.state.session_factory() as db, monkeypatch.context() as patch:
            if failure == "refresh":
                patch.setattr(db, "refresh", fail)
            elif failure == "commit_ack":
                original_commit = db.commit

                def commit_then_fail():
                    original_commit()
                    fail()

                patch.setattr(db, "commit", commit_then_fail)
            elif failure == "copy":
                storage.fail_copy = True
            else:
                patch.setattr(
                    "linkresume.application.resumes.copy_service.validate_resume_pdf_asset_contract",
                    fail,
                )
            expected_error = RuntimeError if failure in {"refresh", "commit_ack"} else ApiError
            with pytest.raises(expected_error):
                copy_resume(db, storage, user_id=user_id, resume_id=source["id"], **payload)

        with app.state.session_factory() as db:
            copied = db.scalar(select(Resume).where(
                Resume.creation_request_id == payload["client_request_id"],
            ))
            if failure in {"copy", "validation"}:
                assert copied is None
                assert storage.objects == {source_key: b"fixture-image-bytes"}
            else:
                assert copied is not None
                copied_id = str(copied.id)
                target_key = f"users/{user_id}/resumes/{copied.id}/assets/avatar.png"
                assert copied.data_json["identity"]["avatar"]["src"] == f"/api/resumes/{copied.id}/assets/avatar.png"
                assert storage.objects[target_key] == storage.objects[source_key]

        if failure in {"refresh", "commit_ack"}:
            retry = client.post(f"/api/resumes/{source['id']}/copy", json=payload)
            assert retry.status_code == 200, retry.text
            assert retry.json()["resume"]["id"] == copied_id
            assert storage.objects[target_key] == b"fixture-image-bytes"
            with app.state.session_factory() as db:
                assert len(db.scalars(select(Resume)).all()) == 2


def test_copy_is_independent_and_retry_does_not_duplicate_after_source_change():
    app = build_app()
    with TestClient(app) as client:
        register(client, "current-owner@example.test")
        source = create_resume(client, app)
        url = f"/api/resumes/{source['id']}"
        payload = copy_payload(source)
        result = client.post(url + "/copy", json=payload)
        assert result.status_code == 201, result.text
        copied = result.json()["resume"]
        assert copied["id"] != source["id"]
        assert copied["data"] == source["data"]
        assert copied["lock_version"] == 1
        assert client.put(url, json={"title": "已修改", "base_lock_version": 1}).status_code == 200
        retried = client.post(url + "/copy", json=payload)
        assert retried.status_code == 200
        assert retried.json()["resume"]["id"] == copied["id"]
        assert client.post(url + "/copy", json={**payload, "title": "不相同"}).status_code == 409
        assert client.post(url + "/copy", json=copy_payload(source, "过期复制")).status_code == 409
        with app.state.session_factory() as db:
            assert len(db.scalars(select(Resume)).all()) == 2
            assert not db.scalars(select(ResumeVersion)).all()


@pytest.mark.parametrize("method,suffix,body", [
    ("POST", "/versions", {}), ("PATCH", "/versions/1", {"name": "归档"}),
    ("DELETE", "/versions/1", None), ("POST", "/versions/1/restore", None),
])
def test_retired_history_writes_are_owned_and_never_mutate(method, suffix, body):
    app = build_app()
    with TestClient(app) as client, TestClient(app) as other:
        register(client, "owner-retired@example.test")
        register(other, "other-retired@example.test")
        resume = create_resume(client, app)
        url = f"/api/resumes/{resume['id']}"
        assert other.request(method, url + suffix, json=body).status_code == 404
        rejected = client.request(method, url + suffix, json=body)
        assert rejected.status_code == 410
        assert rejected.json() == {"error": "RESUME_VERSION_RETIRED"}
        assert client.get(url).json()["resume"] == resume


def test_legacy_archive_is_readable_and_only_copied_to_a_new_resume():
    app = build_app()
    with TestClient(app) as client:
        register(client, "current-owner@example.test")
        source = create_resume(client, app)
        with app.state.session_factory() as db:
            row = db.get(Resume, int(source["id"]))
            db.add(ResumeVersion(resume_id=row.id, template_id=row.template_id,
                                 version_no=8, name="存量内容", reason="manual",
                                 data_json=deepcopy(row.data_json), style_json=deepcopy(row.style_json)))
            db.commit()
        url = f"/api/resumes/{source['id']}"
        assert client.get(url + "/versions/8").status_code == 200
        payload = {"title": "取回的简历", "client_request_id": str(uuid4())}
        result = client.post(url + "/versions/8/copy", json=payload)
        assert result.status_code == 201, result.text
        assert result.json()["resume"]["data"] == source["data"]
        assert client.post(url + "/versions/8/copy", json=payload).status_code == 200
        assert client.get(url).json()["resume"] == source
