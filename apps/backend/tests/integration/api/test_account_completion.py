from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from drawoffer.core.database import utc_now
from drawoffer.core.security import verify_password
from drawoffer.modules.identity.models import AccountDeletionJob, AccountPreference, User
from drawoffer.modules.identity import wechat_action_service as actions
from drawoffer.modules.resumes.models import ResumeTemplate
from drawoffer.workers.account_deletion_worker import AccountDeletionProcessor
from tests.integration.api.test_account_routes import build_test_app, FakeWechatClient


def register(client, email="account@example.com"):
    response = client.post("/api/auth/register", json={"email": email, "password": "password-123"})
    assert response.status_code == 201
    return int(response.json()["user"]["id"])


def enable_deletion(app):
    app.state.settings = app.state.settings.model_copy(update={"account_deletion_enabled": True})


def production(app):
    app.state.settings = app.state.settings.model_copy(update={
        "app_environment": "production", "wechat_appid": "wx-fictional",
        "wechat_secret": SecretStr("fictional-wechat-secret"), "account_deletion_enabled": True,
    })
    app.state.wechat_client = FakeWechatClient({"owner-code": "openid-owner", "wrong-code": "openid-other"})


def processor(app, rag_client=None):
    return AccountDeletionProcessor(
        session_factory=app.state.session_factory, storage=app.state.storage,
        redis=app.state.redis, rag_client=rag_client, settings=app.state.settings,
    )


def delete_password(client, password="password-123"):
    return client.post("/api/account/deletion", json={
        "method": "password", "current_password": password, "confirmation": "注销账号",
    })


def test_real_metadata_contact_email_and_independent_preferences():
    app = build_test_app()
    with TestClient(app) as client:
        uid = register(client)
        profile = client.get("/api/account/profile").json()
        assert profile["user"]["registered_at"].endswith("Z")
        assert profile["current_session"]["device_label"] == "当前浏览器"
        assert profile["capabilities"]["auth_mode"] == "password"
        assert profile["user"]["wechat_status"] == "unavailable"
        assert client.get("/api/account/preferences").json() == {
            "locale": "zh-CN", "interview_reminder_enabled": False, "notifications_available": False,
        }
        with app.state.session_factory() as db:
            assert db.scalar(select(AccountPreference).where(AccountPreference.user_id == uid)) is None
        assert client.put("/api/account/contact-email", json={"email": " contact@example.org "}).json() == {"contact_email": "contact@example.org"}
        client.patch("/api/account/preferences", json={"locale": "en-US"})
        client.patch("/api/account/preferences", json={"interview_reminder_enabled": True})
        assert client.get("/api/account/preferences").json()["locale"] == "en-US"
        assert client.get("/api/account/preferences").json()["interview_reminder_enabled"] is True
        assert client.put("/api/account/contact-email", json={"email": "invalid"}).status_code == 400
        assert client.get("/api/account/profile").json()["user"]["contact_email"] == "contact@example.org"
        assert client.put("/api/account/contact-email", json={"email": " "}).json() == {"contact_email": None}
        with app.state.session_factory() as db:
            assert db.get(User, uid).email == "account@example.com"
            assert db.scalar(select(AccountPreference).where(AccountPreference.user_id == uid)).locale == "en-US"


@pytest.mark.parametrize("payload", [{}, {"locale": "fr"}, {"locale": None}, {"interview_reminder_enabled": 1}, {"unknown": True}])
def test_preferences_reject_invalid_values(payload):
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        response = client.patch("/api/account/preferences", json=payload)
        assert response.status_code == 400
        assert response.json()["error"] == "INVALID_ACCOUNT_PREFERENCES"


def test_environment_policy_including_direct_calls_and_legacy_test_flag():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        assert client.get("/api/auth/capabilities").json() == {"password_login_enabled": True, "wechat_login_enabled": False}
        for path in ["/api/auth/wechat/qrcode", "/api/auth/wechat/miniprogram/login", "/api/account/wechat/verification-request", "/api/account/wechat/bind-request"]:
            assert client.post(path, json={"code": "owner-code", "action": "delete_account"}).status_code == 404
        production(app)
        assert app.state.legacy_identity_test_routes is True
        assert client.get("/api/auth/capabilities").json() == {"password_login_enabled": False, "wechat_login_enabled": True}
        for path, payload in [
            ("/api/auth/login", {"email": "account@example.com", "password": "password-123"}),
            ("/api/auth/register", {"email": "second@example.com", "password": "password-123"}),
            ("/api/account/change-password", {"current_password": "password-123", "new_password": "password-456", "confirm_password": "password-456"}),
        ]:
            assert client.post(path, json=payload).status_code == 404
        assert client.get("/api/account/profile").json()["capabilities"]["can_change_password"] is False
        app.state.settings = app.state.settings.model_copy(update={"app_environment": "unknown"})
        assert client.get("/api/auth/capabilities").json() == {"password_login_enabled": False, "wechat_login_enabled": False}


def test_development_password_change_revokes_all_web_sessions():
    app = build_test_app()
    with TestClient(app) as client, TestClient(app) as second:
        uid = register(client)
        assert second.post("/api/auth/login", json={"email": "account@example.com", "password": "password-123"}).status_code == 200
        changed = client.post("/api/account/change-password", json={
            "current_password": "password-123", "new_password": "replacement-456", "confirm_password": "replacement-456",
        })
        assert changed.status_code == 200
        assert client.get("/api/auth/me").json()["user"] is None
        assert second.get("/api/auth/me").json()["user"] is None
        with app.state.session_factory() as db:
            assert verify_password("replacement-456", db.get(User, uid).password_hash)


@pytest.mark.parametrize("new_password", ["中文中文中文12", "abcdefgh１２", "abcdef1"])
def test_password_strength_matches_web_ascii_letters_and_numbers(new_password):
    app = build_test_app()
    with TestClient(app) as client:
        uid = register(client)
        response = client.post("/api/account/change-password", json={
            "current_password": "password-123", "new_password": new_password,
            "confirm_password": new_password,
        })
        assert response.status_code == 400
        assert response.json()["error"] == "WEAK_PASSWORD"
        assert client.get("/api/auth/me").json()["user"]["id"] == str(uid)
        with app.state.session_factory() as db:
            assert verify_password("password-123", db.get(User, uid).password_hash)


def test_password_deletion_rejects_wrong_identity_and_cross_environment_method():
    app = build_test_app()
    enable_deletion(app)
    with TestClient(app) as client:
        uid = register(client)
        assert delete_password(client, "wrong").status_code == 400
        response = client.post("/api/account/deletion", json={"method": "wechat", "action_token": "anything", "confirmation": "注销账号"})
        assert response.status_code == 400
        with app.state.session_factory() as db:
            assert db.get(User, uid).status == 1
            assert db.scalar(select(AccountDeletionJob)) is None


def test_deletion_denies_sessions_and_share_then_cleans_only_owner():
    app = build_test_app()
    enable_deletion(app)
    with TestClient(app) as client, TestClient(app) as other:
        uid = register(client)
        other_uid = register(other, "other@example.com")
        created = client.post("/api/resumes", json={"title": "张三的简历", "template_id": app.state.test_template_id}).json()["resume"]
        share = client.post(f"/api/resumes/{created['id']}/share", json={}).json()
        with app.state.session_factory() as db:
            from drawoffer.modules.resumes.models import Resume
            token = db.get(Resume, int(created["id"])).share_token
        app.state.storage.objects[f"users/{uid}/assets/example.png"] = b"fictional"
        app.state.storage.objects[f"users/{other_uid}/assets/example.png"] = b"other"
        app.state.storage.objects["system/company-logo.png"] = b"shared"
        app.state.storage.objects[f"mock-interviews/{uid}/example/1.wav"] = b"voice"
        app.state.storage.objects[f"mock-interviews/{other_uid}/example/1.wav"] = b"other-voice"
        result = delete_password(client)
        assert result.status_code == 202
        receipt = result.json()
        assert client.get("/api/auth/me").json()["user"] is None
        assert client.get(f"/api/share/{token}").status_code == 404
        assert client.post("/api/auth/login", json={"email": "account@example.com", "password": "password-123"}).status_code == 401
        assert client.post("/api/account/deletion-status", json={"job_id": receipt["job_id"], "receipt_token": "wrong"}).status_code == 404
        assert processor(app).run_once() is True
        status = client.post("/api/account/deletion-status", json={"job_id": receipt["job_id"], "receipt_token": receipt["receipt_token"]}).json()
        assert status == {"status": "completed", "phase": "complete"}
        with app.state.session_factory() as db:
            assert db.get(User, uid) is None
            assert db.get(User, other_uid) is not None
            assert db.get(ResumeTemplate, int(app.state.test_template_id)) is not None
        assert list(app.state.storage.objects) == [f"users/{other_uid}/assets/example.png", "system/company-logo.png", f"mock-interviews/{other_uid}/example/1.wav"]


def test_failed_object_cleanup_is_durable_and_retry_finishes():
    app = build_test_app()
    enable_deletion(app)
    with TestClient(app) as client:
        uid = register(client)
        app.state.storage.objects[f"users/{uid}/file.md"] = b"fictional"
        receipt = delete_password(client).json()
        app.state.storage.fail_cleanup = True
        assert processor(app).run_once()
        with app.state.session_factory() as db:
            job = db.scalar(select(AccountDeletionJob))
            assert job.status == "retry_wait"
            assert job.phase == "objects"
            assert db.get(User, uid) is None
            assert job.cleanup_manifest["object_prefix"] == f"users/{uid}/"
            job.next_attempt_at = utc_now() - timedelta(seconds=1)
            db.commit()
        app.state.storage.fail_cleanup = False
        assert processor(app).run_once()
        status = client.post("/api/account/deletion-status", json={"job_id": receipt["job_id"], "receipt_token": receipt["receipt_token"]}).json()
        assert status["status"] == "completed"


def test_wechat_confirmation_is_owner_session_bound_and_cancel_invalidates_proof():
    app = build_test_app()
    with TestClient(app) as client, TestClient(app) as same_user:
        uid = register(client)
        same_user.post("/api/auth/login", json={"email": "account@example.com", "password": "password-123"})
        with app.state.session_factory() as db:
            db.get(User, uid).wechat_openid = "openid-owner"
            db.commit()
        production(app)
        response = client.post("/api/account/wechat/verification-request", json={"action": "delete_account"})
        assert response.status_code == 200
        proof = response.json()
        poll = {"scene": proof["scene"], "poll_token": proof["poll_token"]}
        assert same_user.post("/api/account/wechat/verification-status", json=poll).status_code == 404
        assert client.post("/api/account/wechat/verification-confirm", json={"scene": proof["scene"], "code": "wrong-code"}).status_code == 403
        assert client.post("/api/account/wechat/verification-status", json=poll).json()["status"] == "pending"
        assert client.post("/api/account/wechat/verification-confirm", json={"scene": proof["scene"], "code": "owner-code"}).status_code == 200
        token = client.post("/api/account/wechat/verification-status", json=poll).json()["action_token"]
        assert client.post("/api/account/wechat/verification-cancel", json=poll).json()["status"] == "cancelled"
        assert client.post("/api/account/deletion", json={"method": "wechat", "action_token": token, "confirmation": "注销账号"}).status_code == 403
        with app.state.session_factory() as db:
            assert db.get(User, uid).status == 1


def test_production_wechat_proof_accepts_only_once():
    app = build_test_app()
    with TestClient(app) as client:
        uid = register(client)
        with app.state.session_factory() as db:
            db.get(User, uid).wechat_openid = "openid-owner"
            db.commit()
        production(app)
        proof = client.post("/api/account/wechat/verification-request", json={"action": "delete_account"}).json()
        client.post("/api/account/wechat/verification-confirm", json={"scene": proof["scene"], "code": "owner-code"})
        token = client.post("/api/account/wechat/verification-status", json={"scene": proof["scene"], "poll_token": proof["poll_token"]}).json()["action_token"]
        request = {"method": "wechat", "action_token": token, "confirmation": "注销账号"}
        assert client.post("/api/account/deletion", json=request).status_code == 202
        assert client.post("/api/account/deletion", json=request).status_code == 401
        with app.state.session_factory() as db:
            assert len(db.scalars(select(AccountDeletionJob)).all()) == 1


def test_expired_refreshed_and_logged_out_wechat_proofs_are_rejected():
    app = build_test_app()
    with TestClient(app) as client:
        uid = register(client)
        with app.state.session_factory() as db:
            db.get(User, uid).wechat_openid = "openid-owner"; db.commit()
        production(app)
        first = client.post("/api/account/wechat/verification-request", json={"action": "delete_account"}).json()
        second = client.post("/api/account/wechat/verification-request", json={"action": "delete_account"}).json()
        assert client.post("/api/account/wechat/verification-status", json={"scene": first["scene"], "poll_token": first["poll_token"]}).json()["status"] == "cancelled"
        assert client.post("/api/account/wechat/verification-confirm", json={"scene": first["scene"], "code": "owner-code"}).status_code == 409
        app.state.redis.delete(actions.action_key(second["scene"]))
        assert client.post("/api/account/wechat/verification-confirm", json={"scene": second["scene"], "code": "owner-code"}).status_code == 410
        third = client.post("/api/account/wechat/verification-request", json={"action": "delete_account"}).json()
        client.post("/api/auth/logout")
        assert client.post("/api/account/wechat/verification-confirm", json={"scene": third["scene"], "code": "owner-code"}).status_code == 410
        with app.state.session_factory() as db:
            assert db.get(User, uid).status == 1
            assert db.scalar(select(AccountDeletionJob)) is None


def test_admin_active_ai_and_shared_resource_accounts_cannot_be_deleted():
    from drawoffer.modules.agent.models import AgentSession, AgentRun
    from drawoffer.modules.announcements.models import Announcement
    app = build_test_app()
    with TestClient(app) as client:
        uid = register(client); enable_deletion(app)
        with app.state.session_factory() as db:
            user = db.get(User, uid); user.is_admin = 1; db.commit()
        assert delete_password(client).json()["error"] == "ACCOUNT_DELETION_FORBIDDEN"
        with app.state.session_factory() as db:
            db.get(User, uid).is_admin = 0
            conversation = AgentSession(user_id=uid, title="虚构任务", public_id="fictional-session")
            db.add(conversation); db.flush()
            run = AgentRun(session_id=conversation.id, status="running", idempotency_key="fictional-run", public_id="fictional-run", started_at=utc_now())
            db.add(run); db.commit()
        result = delete_password(client)
        assert result.status_code == 409
        assert result.json()["error"] == "ACCOUNT_BUSY"
        with app.state.session_factory() as db:
            db.get(AgentRun, run.id).status = "succeeded"
            db.add(Announcement(title="虚构公共公告", body="示例", created_by=uid, updated_by=uid)); db.commit()
        assert delete_password(client).json()["error"] == "ACCOUNT_SHARED_RESOURCE_OWNER"
        with app.state.session_factory() as db:
            assert db.get(User, uid).status == 1
            assert db.scalar(select(AccountDeletionJob)) is None


def test_password_revocation_failure_rolls_back_password(monkeypatch):
    from redis.exceptions import ConnectionError
    app = build_test_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        uid = register(client)
        def broken(*args, **kwargs): raise ConnectionError("fictional unavailable")
        monkeypatch.setattr("drawoffer.modules.identity.account_routes.revoke_user_sessions", broken)
        response = client.post("/api/account/change-password", json={"current_password": "password-123", "new_password": "fictional456", "confirm_password": "fictional456"})
        assert response.status_code == 500
        with app.state.session_factory() as db:
            assert verify_password("password-123", db.get(User, uid).password_hash)


def test_rag_failure_attention_retry_and_receipt_retention():
    from drawoffer.modules.datasets.models import UserDatasetRagSync
    from drawoffer.workers.account_deletion_worker import retry_job
    from tests.fakes import FakeLinkRag
    app = build_test_app(); enable_deletion(app)
    with TestClient(app) as client:
        uid = register(client)
        with app.state.session_factory() as db:
            # RAG mapping deliberately has no dataset FK and may outlive its source.
            db.add(UserDatasetRagSync(dataset_id=999, user_id=uid, status="ready", content_revision=1, rag_file_id=5001))
            db.commit()
        receipt = delete_password(client).json()
        assert processor(app).run_once()
        with app.state.session_factory() as db:
            job = db.scalar(select(AccountDeletionJob))
            assert job.status == "needs_attention" and job.phase == "rag"
            assert job.cleanup_manifest["rag_file_ids"] == [5001]
            assert db.get(User, uid) is None
        assert retry_job(app.state.session_factory, receipt["job_id"])
        rag = FakeLinkRag(); rag.files[5001] = {"user_id": uid}; rag.fail.add("delete_file")
        assert processor(app, rag).run_once()
        with app.state.session_factory() as db:
            job = db.scalar(select(AccountDeletionJob))
            assert job.status == "retry_wait" and job.phase == "rag"
            job.next_attempt_at = utc_now() - timedelta(seconds=1); db.commit()
        rag.fail.clear(); assert processor(app, rag).run_once()
        assert rag.deleted == [5001]
        with app.state.session_factory() as db:
            job = db.scalar(select(AccountDeletionJob))
            assert job.status == "completed" and job.cleanup_manifest == {}
            job.completed_at = utc_now() - timedelta(days=8); db.commit()
        assert processor(app, rag).run_once() is False
        assert client.post("/api/account/deletion-status", json={"job_id": receipt["job_id"], "receipt_token": receipt["receipt_token"]}).status_code == 404


def test_lost_cleanup_lease_cannot_report_completion_and_expired_job_recovers():
    app = build_test_app(); enable_deletion(app)
    with TestClient(app) as client:
        uid = register(client)
        name = f"users/{uid}/fictional.md"
        app.state.storage.objects[name] = b"fictional"
        delete_password(client)
        backing = app.state.storage
        class LostLeaseStorage:
            def list_names(self, prefix):
                return [key for key in backing.objects if key.startswith(prefix)]
            def delete(self, key):
                backing.delete(key)
                with app.state.session_factory() as db:
                    job = db.scalar(select(AccountDeletionJob))
                    job.lease_until = utc_now() - timedelta(seconds=1); db.commit()
        worker = processor(app); worker.storage = LostLeaseStorage()
        assert worker.run_once()
        with app.state.session_factory() as db:
            job = db.scalar(select(AccountDeletionJob))
            assert job.status == "processing" and job.phase == "objects"
            assert job.completed_at is None
        assert processor(app).run_once()
        with app.state.session_factory() as db:
            assert db.scalar(select(AccountDeletionJob)).status == "completed"
        assert name not in backing.objects


def test_deletion_removes_rows_that_used_to_rely_on_database_cascades():
    """Without database foreign keys, cleanup must delete these rows explicitly."""
    from drawoffer.modules.interviews.models import (
        InterviewRecordingTranscription,
        InterviewReviewQuestionNote,
        JobApplicationOfferMaterial,
    )
    from tests.integration.api.test_interviews import create_application, create_job

    app = build_test_app()
    enable_deletion(app)
    with TestClient(app) as client, TestClient(app) as other:
        uid = register(client)
        other_uid = register(other, "other@example.com")
        application_id = int(create_application(client, create_job(client, "示例公司"))["id"])
        now = utc_now()
        with app.state.session_factory() as db:
            for owner in (uid, other_uid):
                db.add(InterviewRecordingTranscription(
                    user_id=owner, session_id=900000 + owner, dataset_id=910000 + owner,
                    status="queued", attempts=0, next_attempt_at=now,
                ))
                db.add(InterviewReviewQuestionNote(
                    user_id=owner, session_id=900000 + owner,
                    question_key="a" * 64, question_text="虚构的面试问题",
                ))
            db.add(JobApplicationOfferMaterial(application_id=application_id, dataset_id=920000))
            db.commit()
        assert delete_password(client).status_code == 202
        assert processor(app).run_once() is True
        with app.state.session_factory() as db:
            transcription_owners = db.scalars(select(InterviewRecordingTranscription.user_id)).all()
            note_owners = db.scalars(select(InterviewReviewQuestionNote.user_id)).all()
            assert transcription_owners == [other_uid]
            assert note_owners == [other_uid]
            assert db.scalars(select(JobApplicationOfferMaterial)).all() == []
