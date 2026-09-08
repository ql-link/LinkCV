import uuid
from decimal import Decimal
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.identity.session_service import MINIPROGRAM_CHANNEL, issue_session
from linkcv.modules.job_descriptions.models import JobDescription
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


def build_app():
    return create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="mini-career-test-secret-with-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )


def mini_headers(app, email: str) -> dict[str, str]:
    with app.state.session_factory() as session:
        user = session.scalar(select(User).where(User.email == email))
        assert user is not None
        credentials = issue_session(
            user,
            app.state.settings,
            app.state.redis,
            channel=MINIPROGRAM_CHANNEL,
        )
    return {"Authorization": f"Bearer {credentials.access_token}"}


def register_user(web_client: TestClient, email: str) -> None:
    response = web_client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201
    web_client.cookies.clear()


def create_job(
    app, email: str, title: str = "前端工程师", company: str = "字节跳动"
) -> int:
    with app.state.session_factory() as session:
        user = session.scalar(select(User).where(User.email == email))
        assert user is not None
        job = JobDescription(
            user_id=user.id,
            job_title=title,
            company_name=company,
            description="职位描述内容",
            source_type="manual",
            skills=[],
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        return job.id


def test_career_overview_and_lists_require_miniprogram_auth() -> None:
    app = build_app()
    with TestClient(app) as client:
        register_user(client, "user@example.test")
        headers = mini_headers(app, "user@example.test")

        # 未登录/匿名访问返回 401
        unauthorized = client.get("/api/miniprogram/career/overview")
        assert unauthorized.status_code == 401

        # 小程序有效 Bearer 访问成功
        overview_resp = client.get("/api/miniprogram/career/overview", headers=headers)
        assert overview_resp.status_code == 200
        overview_data = overview_resp.json()
        assert "metrics" in overview_data
        assert "pipeline" in overview_data
        assert "week_sessions" in overview_data

        # 列表接口访问成功
        apps_resp = client.get("/api/miniprogram/career/applications", headers=headers)
        assert apps_resp.status_code == 200
        assert "items" in apps_resp.json()

        sessions_resp = client.get("/api/miniprogram/career/sessions", headers=headers)
        assert sessions_resp.status_code == 200
        assert "items" in sessions_resp.json()


def test_career_workflow_advance_close_and_complete() -> None:
    app = build_app()
    with TestClient(app) as client:
        register_user(client, "user@example.test")
        headers = mini_headers(app, "user@example.test")
        job_id = create_job(app, "user@example.test", "全栈工程师", "腾讯")

        # 1. 在 Web 端创建投递及面试会话
        # 登录 Web 获得 Cookie
        login_resp = client.post(
            "/api/auth/login",
            json={"email": "user@example.test", "password": "password-123"},
        )
        assert login_resp.status_code == 200
        cookies = login_resp.cookies

        # 创建投递
        create_app_resp = client.post(
            "/api/job-applications",
            cookies=cookies,
            json={
                "job_description_id": str(job_id),
                "current_stage_type": "screening",
                "current_stage_label": "简历初筛",
                "stage_state": "awaiting_result",
            },
        )
        assert create_app_resp.status_code == 201
        app_id = create_app_resp.json()["application"]["id"]
        lock_version = create_app_resp.json()["application"]["lock_version"]

        # 2. 小程序端推进阶段至面试 (advance)
        client.cookies.clear()
        advance_resp = client.post(
            f"/api/miniprogram/career/applications/{app_id}/advance",
            headers=headers,
            json={
                "base_lock_version": lock_version,
                "target_stage_type": "interview",
                "target_round_no": 1,
                "target_stage_label": "技术一面",
            },
        )
        assert advance_resp.status_code == 200
        adv_data = advance_resp.json()["application"]
        assert adv_data["current_stage_type"] == "interview"
        assert adv_data["current_round_no"] == 1
        new_lock_version = adv_data["lock_version"]

        # 3. 创建面试会话（模拟 Web 端或日程创建）
        from zoneinfo import ZoneInfo

        shanghai_tz = ZoneInfo("Asia/Shanghai")
        start_dt = datetime(2026, 8, 28, 14, 0, 0, tzinfo=shanghai_tz)
        end_dt = datetime(2026, 8, 28, 15, 0, 0, tzinfo=shanghai_tz)
        start_at = start_dt.isoformat()
        end_at = end_dt.isoformat()
        create_session_resp = client.post(
            f"/api/job-applications/{app_id}/interview-sessions",
            cookies=cookies,
            json={
                "client_request_id": str(uuid.uuid4()),
                "stage_type": "interview",
                "round_no": 1,
                "stage_label": "技术一面",
                "start_at": start_at,
                "end_at": end_at,
                "timezone": "Asia/Shanghai",
                "mode": "video",
                "meeting_url": "https://meeting.tencent.com/dm/123456",
            },
        )
        assert create_session_resp.status_code == 201
        session_id = create_session_resp.json()["session"]["id"]
        session_lock_version = create_session_resp.json()["session"]["lock_version"]

        # 4. 小程序端查询日程列表
        client.cookies.clear()
        sessions_list = client.get("/api/miniprogram/career/sessions", headers=headers)
        assert sessions_list.status_code == 200
        items = sessions_list.json()["items"]
        assert len(items) == 1
        assert items[0]["company_name"] == "腾讯"
        assert items[0]["job_title"] == "全栈工程师"
        assert items[0]["meeting_url"] == "https://meeting.tencent.com/dm/123456"

        # 5. 小程序端标记完成面试 (complete)
        complete_resp = client.post(
            f"/api/miniprogram/career/sessions/{session_id}/complete",
            headers=headers,
            json={
                "base_lock_version": session_lock_version,
            },
        )
        assert complete_resp.status_code == 200
        assert complete_resp.json()["session"]["status"] == "completed"

        # 6. 小程序端关闭投递 (close)
        # 先获取最新 application lock_version
        overview_data = client.get(
            "/api/miniprogram/career/overview", headers=headers
        ).json()
        current_app = [a for a in overview_data["pipeline"] if a["id"] == app_id][0]

        close_resp = client.post(
            f"/api/miniprogram/career/applications/{app_id}/close",
            headers=headers,
            json={
                "base_lock_version": current_app["lock_version"],
                "status": "closed",
            },
        )
        assert close_resp.status_code == 200
        assert close_resp.json()["application"]["status"] == "closed"


def _pending_application(client, app, email="owner@example.test"):
    register_user(client, email)
    job_id = create_job(app, email, company="星河示例科技")
    client.post("/api/auth/login", json={"email": email, "password": "password-123"})
    response = client.post(
        "/api/job-applications",
        json={
            "job_description_id": str(job_id),
            "current_stage_type": "screening",
            "current_stage_label": "待投递",
            "stage_state": "awaiting_schedule",
        },
    )
    assert response.status_code == 201, response.text
    client.cookies.clear()
    return response.json()["application"], mini_headers(app, email)


def test_mini_stage_schedule_review_and_conflict_workflow():
    app = build_app()
    root = "/api/miniprogram/career"
    with TestClient(app) as client:
        application, headers = _pending_application(client, app)
        aid = application["id"]
        stage_payload = {
            "base_lock_version": application["lock_version"],
            "client_request_id": str(uuid.uuid4()),
            "stage_type": "interview",
            "stage_label": "HR 面",
        }
        response = client.post(
            f"{root}/applications/{aid}/stages", headers=headers, json=stage_payload
        )
        assert response.status_code == 200, response.text
        staged = response.json()["application"]
        assert staged["phase"] == "applied"
        assert staged["current_stage"]["stage_label"] == "HR 面"
        assert staged["current_stage"]["interview_round_no"] is None
        duplicate = client.post(
            f"{root}/applications/{aid}/stages", headers=headers, json=stage_payload
        )
        assert len(duplicate.json()["application"]["stages"]) == 1
        now = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(days=1)
        payload = {
            "client_request_id": str(uuid.uuid4()),
            "application_stage_id": staged["current_stage"]["id"],
            "stage_type": "interview",
            "round_no": 1,
            "stage_label": "HR 面",
            "start_at": now.isoformat(),
            "end_at": (now + timedelta(hours=1)).isoformat(),
            "timezone": "Asia/Shanghai",
            "mode": "video",
        }
        response = client.post(
            f"{root}/applications/{aid}/sessions", headers=headers, json=payload
        )
        assert response.status_code == 201, response.text
        session = response.json()["session"]
        sid = session["id"]
        duplicate = client.post(
            f"{root}/applications/{aid}/sessions", headers=headers, json=payload
        )
        assert duplicate.json()["session"]["id"] == sid
        listing = client.get(
            f"{root}/sessions", params={"application_id": aid}, headers=headers
        ).json()
        assert [item["id"] for item in listing["items"]] == [sid]
        detail = client.get(f"{root}/sessions/{sid}", headers=headers).json()
        assert (
            detail["application"]["current_stage"]["id"]
            == staged["current_stage"]["id"]
        )
        update = {
            "base_lock_version": session["lock_version"],
            "questions_markdown": "虚构面试记录",
            "preparation_note": "复习基础知识",
        }
        saved = client.put(f"{root}/sessions/{sid}", headers=headers, json=update)
        assert saved.status_code == 200, saved.text
        assert saved.json()["session"]["status"] == "scheduled"
        assert (
            saved.json()["application"]["current_stage"]["id"]
            == staged["current_stage"]["id"]
        )
        stale = client.put(f"{root}/sessions/{sid}", headers=headers, json=update)
        assert stale.status_code == 409
        assert stale.json()["error"] == "INTERVIEW_EDIT_CONFLICT"
        moved = client.post(
            f"{root}/sessions/{sid}/reschedule",
            headers=headers,
            json={
                "base_lock_version": saved.json()["session"]["lock_version"],
                "start_at": (now + timedelta(hours=2)).isoformat(),
                "end_at": (now + timedelta(hours=3)).isoformat(),
                "timezone": "Asia/Shanghai",
            },
        )
        assert moved.status_code == 200, moved.text
        completed = client.post(
            f"{root}/sessions/{sid}/complete",
            headers=headers,
            json={"base_lock_version": moved.json()["session"]["lock_version"]},
        )
        assert completed.status_code == 200
        assert completed.json()["session"]["questions_markdown"] == "虚构面试记录"
        summary = client.get(f"{root}/applications", headers=headers).json()["items"][0]
        assert summary["current_session_status"] == "completed"
        assert summary["current_stage"]["stage_label"] == "HR 面"
        terminated = client.post(
            f"{root}/applications/{aid}/terminate",
            headers=headers,
            json={
                "base_lock_version": completed.json()["application"]["lock_version"],
                "client_request_id": str(uuid.uuid4()),
                "reason": "user_withdrew",
            },
        )
        assert terminated.status_code == 200, terminated.text
        assert terminated.json()["application"]["lifecycle_status"] == "terminated"
        assert (
            client.get(f"{root}/sessions/{sid}", headers=headers).json()["session"][
                "questions_markdown"
            ]
            == "虚构面试记录"
        )


def test_mini_career_owner_channel_and_version_boundaries():
    app = build_app()
    root = "/api/miniprogram/career"
    with TestClient(app) as client:
        application, owner = _pending_application(client, app)
        aid = application["id"]
        register_user(client, "other@example.test")
        other = mini_headers(app, "other@example.test")
        for path in [f"/applications/{aid}", f"/applications/{aid}/resume-preview.png"]:
            assert client.get(root + path).status_code == 401
            assert client.get(root + path, headers=other).status_code == 404
        stage = {
            "base_lock_version": 1,
            "client_request_id": str(uuid.uuid4()),
            "stage_type": "assessment",
        }
        assert (
            client.post(
                f"{root}/applications/{aid}/stages", headers=other, json=stage
            ).status_code
            == 404
        )
        assert (
            client.post(
                f"{root}/applications/{aid}/terminate",
                headers=other,
                json={
                    "base_lock_version": 1,
                    "client_request_id": str(uuid.uuid4()),
                    "reason": "other",
                },
            ).status_code
            == 404
        )
        assert (
            client.post(
                f"{root}/applications/{aid}/offer",
                headers=other,
                json={"base_lock_version": 1},
            ).status_code
            == 404
        )
        assert (
            client.get(
                f"{root}/applications/{aid}/resume-preview.png", headers=owner
            ).status_code
            == 409
        )
        assert (
            client.get(f"/api/job-applications/{aid}", headers=owner).status_code == 401
        )
        assert (
            client.get(
                f"{root}/sessions",
                params={"start_at": "2026-09-10T10:00:00"},
                headers=owner,
            ).status_code
            == 400
        )
        assert (
            client.get(
                f"{root}/sessions",
                params={
                    "start_at": "2026-09-10T10:00:00Z",
                    "end_at": "2026-09-09T10:00:00Z",
                },
                headers=owner,
            ).status_code
            == 400
        )


def test_mini_time_conflict_cancel_and_offer():
    app = build_app()
    root = "/api/miniprogram/career"
    with TestClient(app) as client:
        first, headers = _pending_application(client, app)
        # A second application belongs to the same user; create via Web channel.
        job_id = create_job(app, "owner@example.test", company="云杉示例实验室")
        client.post(
            "/api/auth/login",
            json={"email": "owner@example.test", "password": "password-123"},
        )
        second = client.post(
            "/api/job-applications",
            json={
                "job_description_id": str(job_id),
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        ).json()["application"]
        client.cookies.clear()
        sessions = []
        now = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(days=3)
        for index, application in enumerate([first, second]):
            aid = application["id"]
            staged = client.post(
                f"{root}/applications/{aid}/stages",
                headers=headers,
                json={
                    "client_request_id": str(uuid.uuid4()),
                    "base_lock_version": application["lock_version"],
                    "stage_type": "assessment",
                },
            ).json()["application"]
            payload = {
                "client_request_id": str(uuid.uuid4()),
                "application_stage_id": staged["current_stage"]["id"],
                "stage_type": "other",
                "stage_label": "测评",
                "start_at": now.isoformat(),
                "end_at": (now + timedelta(hours=1)).isoformat(),
                "timezone": "Asia/Shanghai",
                "mode": "other",
            }
            response = client.post(
                f"{root}/applications/{aid}/sessions", headers=headers, json=payload
            )
            if index:
                assert response.status_code == 409
                assert response.json()["error"] == "INTERVIEW_TIME_CONFLICT"
                assert (
                    len(
                        client.get(
                            f"{root}/applications/{aid}", headers=headers
                        ).json()["application"]["stages"]
                    )
                    == 1
                )
                response = client.post(
                    f"{root}/applications/{aid}/sessions",
                    headers=headers,
                    json={**payload, "allow_conflict": True},
                )
            assert response.status_code == 201, response.text
            sessions.append(response.json()["session"])
        # Foreign users cannot read or mutate the sessions, even with valid locks.
        register_user(client, "outsider@example.test")
        other = mini_headers(app, "outsider@example.test")
        sid = sessions[0]["id"]
        assert client.get(f"{root}/sessions/{sid}", headers=other).status_code == 404
        assert (
            client.put(
                f"{root}/sessions/{sid}",
                headers=other,
                json={"base_lock_version": 1, "questions_markdown": "no"},
            ).status_code
            == 404
        )
        for action in ["cancel", "complete"]:
            assert (
                client.post(
                    f"{root}/sessions/{sid}/{action}",
                    headers=other,
                    json={"base_lock_version": 1},
                ).status_code
                == 404
            )
        cancelled = client.post(
            f"{root}/sessions/{sid}/cancel",
            headers=headers,
            json={"base_lock_version": sessions[0]["lock_version"]},
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["session"]["status"] == "cancelled"
        application = cancelled.json()["application"]
        assert application["lifecycle_status"] == "active"
        offer_stage = client.post(
            f"{root}/applications/{first['id']}/stages",
            headers=headers,
            json={
                "client_request_id": str(uuid.uuid4()),
                "base_lock_version": application["lock_version"],
                "stage_type": "offer",
            },
        ).json()["application"]
        offer = client.post(
            f"{root}/applications/{first['id']}/offer",
            headers=headers,
            json={
                "base_lock_version": offer_stage["lock_version"],
                "salary": "20000",
                "salary_currency": "CNY",
                "salary_period": "month",
            },
        )
        assert offer.status_code == 200, offer.text
        assert Decimal(offer.json()["application"]["offer_salary"]) == Decimal("20000")


def test_application_resume_preview_uses_attached_version_not_latest():
    from tests.integration.api.test_miniprogram_resume_pdf import (
        build_app as build_pdf_app,
    )

    app = build_pdf_app()
    with TestClient(app) as client:
        application, headers = _pending_application(client, app)
        aid = application["id"]
        client.post(
            "/api/auth/login",
            json={"email": "owner@example.test", "password": "password-123"},
        )
        resume = client.post(
            "/api/resumes",
            json={"title": "张三的投递简历", "template_id": app.state.test_template_id},
        ).json()["resume"]
        rid = resume["id"]
        initial = client.get(f"/api/resumes/{rid}/versions").json()["versions"][0]
        client.cookies.clear()
        staged = client.post(
            f"/api/miniprogram/career/applications/{aid}/stages",
            headers=headers,
            json={
                "client_request_id": str(uuid.uuid4()),
                "base_lock_version": application["lock_version"],
                "stage_type": "screening",
                "resume_id": rid,
            },
        )
        assert staged.status_code == 200, staged.text
        assert staged.json()["application"]["resume_version_id"] == initial["id"]
        client.post(
            "/api/auth/login",
            json={"email": "owner@example.test", "password": "password-123"},
        )
        data = resume["data"]
        data["identity"]["name"] = {
            "node_id": "node_name0000000000001",
            "source_refs": [],
            "value": "后续新版本",
        }
        assert (
            client.put(
                f"/api/resumes/{rid}",
                json={"data": data, "base_lock_version": resume["lock_version"]},
            ).status_code
            == 200
        )
        latest = client.post(f"/api/resumes/{rid}/versions", json={}).json()["version"]
        assert latest["id"] != initial["id"]
        client.cookies.clear()
        preview = client.get(
            f"/api/miniprogram/career/applications/{aid}/resume-preview.png",
            params={"version_id": latest["id"]},
            headers=headers,
        )
        assert preview.status_code == 200, preview.text
        assert preview.headers["x-linkcv-preview-version-id"] == initial["id"]
        assert preview.headers["cache-control"] == "private, no-store"
        assert (
            app.state.resume_pdf_renderer.payloads[-1]["data"]["identity"]["name"]
            is None
        )
