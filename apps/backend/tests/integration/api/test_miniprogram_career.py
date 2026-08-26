import uuid
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


def create_job(app, email: str, title: str = "前端工程师", company: str = "字节跳动") -> int:
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
        overview_data = client.get("/api/miniprogram/career/overview", headers=headers).json()
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
