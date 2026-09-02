from __future__ import annotations

import hashlib
from datetime import datetime, time, timedelta
from io import BytesIO
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import delete

from linkcv.core.config import Settings
from linkcv.core.storage import StreamUploadResult
from linkcv.main import create_app
from linkcv.modules.resumes.models import ResumeTemplate, ResumeVersion
from tests.canonical_resume_fixtures import canonical_template_payload
from tests.fakes import FakeRedis


TEST_TIMEZONE = ZoneInfo("Asia/Shanghai")
future_date = (datetime.now(TEST_TIMEZONE) + timedelta(days=14)).date()
FIXTURE_WEEK_START = future_date - timedelta(days=future_date.weekday())


def fixture_datetime(day_offset: int, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(
        FIXTURE_WEEK_START + timedelta(days=day_offset),
        time(hour, minute),
        tzinfo=TEST_TIMEZONE,
    )


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def ensure_bucket(self) -> None:
        pass

    def upload_stream(
        self,
        object_name: str,
        stream: BytesIO,
        content_type: str,
        *,
        max_bytes: int,
    ) -> StreamUploadResult:
        del content_type
        data = stream.read()
        if len(data) > max_bytes:
            raise ValueError("too large")
        self.objects[object_name] = data
        return StreamUploadResult(len(data), hashlib.sha256(data).hexdigest())

    def delete(self, object_name: str) -> None:
        self.objects.pop(object_name, None)


class FailingUploadStorage(FakeStorage):
    def upload_stream(
        self,
        object_name: str,
        stream: BytesIO,
        content_type: str,
        *,
        max_bytes: int,
    ) -> StreamUploadResult:
        del object_name, stream, content_type, max_bytes
        raise RuntimeError("simulated storage outage")


def build_app(storage: FakeStorage | None = None):
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="integration-test-secret-with-32-bytes",
        ),
        storage=storage or FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    with app.state.session_factory() as session:
        template_data, template_style = canonical_template_payload(
            key="interview-test"
        )
        template = ResumeTemplate(
            key="interview-test",
            name="求职测试模板",
            description="求职进程集成测试使用的模板",
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
    assert response.status_code == 201, response.text


def create_job(client: TestClient, company: str) -> str:
    response = client.post(
        "/api/job-descriptions",
        json={
            "job_title": "后端开发工程师",
            "company_name": company,
            "description": "负责虚构业务的后端系统设计与开发。",
            "source_type": "manual",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["job_description"]["id"]


def create_resume(
    client: TestClient, app, title: str = "求职测试简历"
) -> dict[str, object]:
    response = client.post(
        "/api/resumes",
        json={"title": title, "template_id": app.state.test_template_id},
    )
    assert response.status_code == 201, response.text
    return response.json()["resume"]


def list_resume_versions(client: TestClient, resume_id: str) -> list[dict[str, object]]:
    response = client.get(f"/api/resumes/{resume_id}/versions")
    assert response.status_code == 200, response.text
    return response.json()["versions"]


def create_resume_version(
    client: TestClient, resume_id: str, name: str
) -> dict[str, object]:
    response = client.post(
        f"/api/resumes/{resume_id}/versions", json={"name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()["version"]


def create_application(client: TestClient, job_id: str) -> dict[str, object]:
    response = client.post(
        "/api/job-applications",
        json={
            "job_description_id": job_id,
            "current_stage_type": "interview",
            "current_round_no": 1,
            "current_stage_label": "一面",
            "stage_state": "awaiting_schedule",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["application"]


def session_payload(
    request_id: str, *, allow_conflict: bool = False
) -> dict[str, object]:
    return {
        "client_request_id": request_id,
        "stage_type": "interview",
        "round_no": 1,
        "stage_label": "一面",
        "start_at": fixture_datetime(0, 10).isoformat(),
        "end_at": fixture_datetime(0, 11).isoformat(),
        "timezone": "Asia/Shanghai",
        "mode": "video",
        "meeting_url": "https://meeting.example/interview",
        "allow_conflict": allow_conflict,
    }


def test_interview_lifecycle_conflict_overview_and_assets_share_one_record() -> None:
    storage = FakeStorage()
    app = build_app(storage)
    with TestClient(app) as client:
        register(client, "zhangsan-interview@example.test")
        first_application = create_application(client, create_job(client, "示例科技"))
        second_application = create_application(
            client, create_job(client, "虚构云计算")
        )
        assert isinstance(first_application["id"], str)
        assert isinstance(first_application["job_description_id"], str)

        created = client.post(
            f"/api/job-applications/{first_application['id']}/interview-sessions",
            json=session_payload("11111111-1111-4111-8111-111111111111"),
        )
        assert created.status_code == 201, created.text
        first_session = created.json()["session"]
        assert isinstance(first_session["id"], str)
        assert first_session["application_id"] == first_application["id"]
        assert first_session["status"] == "scheduled"
        assert first_session["start_at"].endswith(("Z", "+00:00"))

        duplicate_stage = client.post(
            f"/api/job-applications/{first_application['id']}/interview-sessions",
            json=session_payload("44444444-4444-4444-8444-444444444444"),
        )
        assert duplicate_stage.status_code == 409
        assert duplicate_stage.json()["error"] == "INTERVIEW_INVALID_TRANSITION"

        conflict = client.post(
            f"/api/job-applications/{second_application['id']}/interview-sessions",
            json=session_payload("22222222-2222-4222-8222-222222222222"),
        )
        assert conflict.status_code == 409
        assert conflict.json()["error"] == "INTERVIEW_TIME_CONFLICT"
        assert conflict.json()["conflicts"][0]["id"] == first_session["id"]
        assert conflict.json()["conflicts"][0]["start_at"].endswith(
            ("Z", "+00:00")
        )

        confirmed = client.post(
            f"/api/job-applications/{second_application['id']}/interview-sessions",
            json=session_payload(
                "22222222-2222-4222-8222-222222222222", allow_conflict=True
            ),
        )
        assert confirmed.status_code == 201, confirmed.text

        completed = client.post(
            f"/api/interview-sessions/{first_session['id']}/complete",
            json={
                "questions_markdown": "如何保证接口幂等？",
                "review_summary": "整体表达清晰。",
                "improvement_markdown": "补充分布式事务失败边界。",
                "base_lock_version": first_session["lock_version"],
            },
        )
        assert completed.status_code == 200, completed.text
        completed_body = completed.json()
        assert completed_body["session"]["status"] == "completed"
        assert completed_body["application"]["current_stage_label"] == "一面"
        assert completed_body["application"]["stage_state"] == "awaiting_result"

        advanced = client.post(
            f"/api/job-applications/{first_application['id']}/advance",
            json={
                "target_stage_type": "interview",
                "target_round_no": 2,
                "target_stage_label": "二面",
                "base_lock_version": completed_body["application"]["lock_version"],
            },
        )
        assert advanced.status_code == 200, advanced.text
        assert advanced.json()["application"]["current_stage_label"] == "二面"
        assert advanced.json()["application"]["stage_state"] == "awaiting_schedule"
        advanced_round_detail = client.get(
            f"/api/interview-sessions/{first_session['id']}"
        )
        assert advanced_round_detail.json()["session"]["round_result"] == "passed"

        uploaded = client.post(
            f"/api/interview-sessions/{first_session['id']}/assets",
            data={"source_type": "recorded", "duration_ms": "60000"},
            files={"file": ("interview.webm", b"fake-audio", "audio/webm")},
        )
        assert uploaded.status_code == 201, uploaded.text
        asset = uploaded.json()["asset"]
        assert isinstance(asset["id"], str)
        assert asset["interview_session_id"] == first_session["id"]
        assert asset["source_type"] == "recorded"
        assert asset["file_size"] == len(b"fake-audio")
        assert len(storage.objects) == 1

        detail = client.get(f"/api/interview-sessions/{first_session['id']}")
        assert detail.status_code == 200
        assert detail.json()["session"]["questions_markdown"] == "如何保证接口幂等？"
        assert detail.json()["assets"][0]["id"] == asset["id"]

        overview = client.get(
            f"/api/interview-overview?week_start={FIXTURE_WEEK_START.isoformat()}&timezone=Asia%2FShanghai"
        )
        assert overview.status_code == 200, overview.text
        assert overview.json()["metrics"] == {
            "weekly_interviews": 2,
            "upcoming_interviews": 1,
            "completed_interviews": 1,
            "written_offers": 0,
        }

        blocked_delete = client.delete(f"/api/interview-sessions/{first_session['id']}")
        assert blocked_delete.status_code == 409
        assert blocked_delete.json() == {"error": "INTERVIEW_SESSION_NOT_EMPTY"}


def test_schedule_accepts_arbitrary_minutes_for_create_and_reschedule() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "arbitrary-minute-interview@example.test")
        application = create_application(client, create_job(client, "任意分钟公司"))
        payload = session_payload("17171717-1717-4171-8171-171717171717")
        payload.update(
            {
                "start_at": fixture_datetime(0, 9, 17).isoformat(),
                "end_at": fixture_datetime(0, 10, 17).isoformat(),
            }
        )

        created = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=payload,
        )
        assert created.status_code == 201, created.text
        created_session = created.json()["session"]
        assert datetime.fromisoformat(created_session["start_at"]).minute == 17

        invalid_clock = client.post(
            f"/api/interview-sessions/{created_session['id']}/reschedule",
            json={
                "start_at": "2026-09-01T09:60:00+08:00",
                "end_at": "2026-09-01T10:17:00+08:00",
                "timezone": "Asia/Shanghai",
                "base_lock_version": created_session["lock_version"],
            },
        )
        assert invalid_clock.status_code == 400
        assert invalid_clock.json() == {"error": "INVALID_INTERVIEW_REQUEST"}

        invalid_precision = client.post(
            f"/api/interview-sessions/{created_session['id']}/reschedule",
            json={
                "start_at": fixture_datetime(0, 9, 17).replace(second=1).isoformat(),
                "end_at": fixture_datetime(0, 10, 17).isoformat(),
                "timezone": "Asia/Shanghai",
                "base_lock_version": created_session["lock_version"],
            },
        )
        assert invalid_precision.status_code == 400
        assert invalid_precision.json() == {"error": "INVALID_INTERVIEW_TIME"}

        reversed_range = client.post(
            f"/api/interview-sessions/{created_session['id']}/reschedule",
            json={
                "start_at": fixture_datetime(1, 12, 17).isoformat(),
                "end_at": fixture_datetime(1, 11, 17).isoformat(),
                "timezone": "Asia/Shanghai",
                "base_lock_version": created_session["lock_version"],
            },
        )
        assert reversed_range.status_code == 400
        assert reversed_range.json() == {"error": "INVALID_INTERVIEW_REQUEST"}

        rescheduled = client.post(
            f"/api/interview-sessions/{created_session['id']}/reschedule",
            json={
                "start_at": fixture_datetime(1, 12, 17).isoformat(),
                "end_at": fixture_datetime(1, 13, 17).isoformat(),
                "timezone": "Asia/Shanghai",
                "base_lock_version": created_session["lock_version"],
            },
        )
        assert rescheduled.status_code == 200, rescheduled.text
        assert datetime.fromisoformat(rescheduled.json()["session"]["start_at"]).minute == 17


def test_other_users_cannot_discover_interview_resources() -> None:
    app = build_app()
    with TestClient(app) as owner:
        register(owner, "owner-interview@example.test")
        application = create_application(owner, create_job(owner, "所有者公司"))
        created = owner.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=session_payload("33333333-3333-4333-8333-333333333333"),
        )
        session_id = created.json()["session"]["id"]

        with TestClient(app) as stranger:
            register(stranger, "stranger-interview@example.test")
            assert (
                stranger.get(f"/api/job-applications/{application['id']}").status_code
                == 404
            )
            assert (
                stranger.get(f"/api/interview-sessions/{session_id}").status_code == 404
            )


def test_deleting_an_old_round_does_not_rewind_the_current_round() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "old-round-interview@example.test")
        application = create_application(client, create_job(client, "历史轮次公司"))
        created = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=session_payload("55555555-5555-4555-8555-555555555555"),
        ).json()
        completed = client.post(
            f"/api/interview-sessions/{created['session']['id']}/complete",
            json={"base_lock_version": created["session"]["lock_version"]},
        ).json()
        advanced = client.post(
            f"/api/job-applications/{application['id']}/advance",
            json={
                "target_stage_type": "interview",
                "target_round_no": 2,
                "target_stage_label": "二面",
                "base_lock_version": completed["application"]["lock_version"],
            },
        )
        assert advanced.status_code == 200, advanced.text

        second_payload = session_payload("66666666-6666-4666-8666-666666666666")
        second_payload.update(
            {
                "round_no": 2,
                "stage_label": "二面",
                "start_at": fixture_datetime(0, 12).isoformat(),
                "end_at": fixture_datetime(0, 13).isoformat(),
            }
        )
        second = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=second_payload,
        )
        assert second.status_code == 201, second.text
        second_completed = client.post(
            f"/api/interview-sessions/{second.json()['session']['id']}/complete",
            json={"base_lock_version": second.json()["session"]["lock_version"]},
        )
        assert second_completed.status_code == 200, second_completed.text

        deleted = client.delete(f"/api/interview-sessions/{created['session']['id']}")
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["application"]["current_stage_label"] == "二面"
        assert deleted.json()["application"]["stage_state"] == "awaiting_result"


def test_application_creation_enforces_reachable_initial_states_and_screening_can_advance() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "screening-state@example.test")
        job_id = create_job(client, "筛选状态公司")

        invalid_interview = client.post(
            "/api/job-applications",
            json={
                "job_description_id": job_id,
                "current_stage_type": "interview",
                "current_round_no": 1,
                "current_stage_label": "一面",
                "stage_state": "scheduled",
            },
        )
        assert invalid_interview.status_code == 400
        assert invalid_interview.json() == {"error": "INVALID_INTERVIEW_REQUEST"}

        pending = client.post(
            "/api/job-applications",
            json={
                "job_description_id": job_id,
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        )
        assert pending.status_code == 201, pending.text
        pending_application = pending.json()["application"]
        assert pending_application["current_stage_type"] == "screening"
        assert pending_application["current_round_no"] is None
        assert pending_application["current_stage_label"] == "待投递"
        assert pending_application["stage_state"] == "awaiting_schedule"
        assert pending_application["applied_at"] is None

        invalid_screening = client.post(
            "/api/job-applications",
            json={
                "job_description_id": job_id,
                "current_stage_type": "screening",
                "current_stage_label": "筛选中",
                "stage_state": "awaiting_schedule",
            },
        )
        assert invalid_screening.status_code == 400

        created = client.post(
            "/api/job-applications",
            json={"job_description_id": job_id},
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]
        assert application["stage_state"] == "awaiting_result"

        advanced = client.post(
            f"/api/job-applications/{application['id']}/advance",
            json={
                "target_stage_type": "interview",
                "target_round_no": 1,
                "target_stage_label": "一面",
                "base_lock_version": application["lock_version"],
            },
        )
        assert advanced.status_code == 200, advanced.text
        assert advanced.json()["application"]["stage_state"] == "awaiting_schedule"


def test_application_creation_rejects_a_pending_placeholder_with_applied_at() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-create-boundary@example.test")
        job_id = create_job(client, "创建边界公司")

        with_applied_at = client.post(
            "/api/job-applications",
            json={
                "job_description_id": job_id,
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
                "applied_at": "2026-08-22T04:00:00Z",
            },
        )
        assert with_applied_at.status_code == 400
        assert with_applied_at.json() == {"error": "INVALID_INTERVIEW_REQUEST"}

        wrong_state = client.post(
            "/api/job-applications",
            json={
                "job_description_id": job_id,
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_result",
            },
        )
        assert wrong_state.status_code == 400
        assert wrong_state.json() == {"error": "INVALID_INTERVIEW_REQUEST"}

        legacy_applied = client.post(
            "/api/job-applications",
            json={
                "job_description_id": job_id,
                "current_stage_type": "screening",
                "current_stage_label": "筛选中",
                "stage_state": "awaiting_result",
                "applied_at": "2026-08-22T04:00:00Z",
            },
        )
        assert legacy_applied.status_code == 201, legacy_applied.text
        assert legacy_applied.json()["application"]["current_stage_label"] == "筛选中"


def test_marking_an_application_applied_normalizes_to_screening() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-screening@example.test")
        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "投递占位公司"),
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]
        marked = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-22T12:00:00+08:00",
                "base_lock_version": application["lock_version"],
            },
        )
        assert marked.status_code == 200, marked.text
        marked_application = marked.json()["application"]
        assert marked_application["applied_at"].endswith("Z")
        assert marked_application["resume_version_id"] is None
        assert marked_application["resume_title_snapshot"] is None
        assert marked_application["current_stage_type"] == "screening"
        assert marked_application["current_round_no"] is None
        assert marked_application["current_stage_label"] == "筛选中"
        assert marked_application["stage_state"] == "awaiting_result"
        assert marked_application["lock_version"] == application["lock_version"] + 1

        changed_date = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-23T12:00:00+08:00",
                "base_lock_version": marked_application["lock_version"],
            },
        )
        assert changed_date.status_code == 200, changed_date.text
        assert changed_date.json()["application"]["current_stage_label"] == "筛选中"

        legacy = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "旧筛选占位公司"),
                "current_stage_type": "screening",
                "current_stage_label": "筛选中",
                "stage_state": "awaiting_result",
            },
        )
        assert legacy.status_code == 201, legacy.text
        legacy_application = legacy.json()["application"]
        legacy_resume = create_resume(client, app, "旧筛选占位简历")
        legacy_marked = client.put(
            f"/api/job-applications/{legacy_application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_id": legacy_resume["id"],
                "base_lock_version": legacy_application["lock_version"],
            },
        )
        assert legacy_marked.status_code == 200, legacy_marked.text
        assert legacy_marked.json()["application"]["current_stage_label"] == "筛选中"


def test_marking_an_application_with_resume_id_binds_the_latest_formal_version() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-latest-resume@example.test")
        resume = create_resume(client, app, "后端岗位简历")
        resume_id = str(resume["id"])
        create_resume_version(client, resume_id, "后端岗位初版")
        latest = create_resume_version(client, resume_id, "后端岗位终版")
        versions = list_resume_versions(client, resume_id)
        assert versions[0]["id"] == latest["id"]
        assert versions[0]["version_no"] > versions[1]["version_no"]

        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "最新版本绑定公司"),
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        marked = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_id": resume_id,
                "base_lock_version": application["lock_version"],
            },
        )
        assert marked.status_code == 200, marked.text
        bound = marked.json()["application"]
        assert bound["resume_version_id"] == latest["id"]
        assert bound["resume_title_snapshot"] == "后端岗位终版"


def test_marking_an_application_without_a_resume_succeeds() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-resume-required@example.test")
        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "可选绑定简历公司"),
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        marked = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "base_lock_version": application["lock_version"],
            },
        )
        assert marked.status_code == 200, marked.text
        updated = marked.json()["application"]
        assert updated["applied_at"] == "2026-08-22T04:00:00Z"
        assert updated["resume_version_id"] is None
        assert updated["resume_title_snapshot"] is None
        assert updated["lock_version"] == application["lock_version"] + 1


def test_marking_an_application_rejects_a_resume_without_a_formal_version() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-no-resume-version@example.test")
        resume = create_resume(client, app, "没有版本的简历")
        resume_id = str(resume["id"])
        with app.state.session_factory() as db:
            db.execute(
                delete(ResumeVersion).where(ResumeVersion.resume_id == int(resume_id))
            )
            db.commit()

        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "无版本简历公司"),
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        rejected = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_id": resume_id,
                "base_lock_version": application["lock_version"],
            },
        )
        assert rejected.status_code == 409
        assert rejected.json() == {"error": "INTERVIEW_RESUME_VERSION_REQUIRED"}


def test_marking_an_application_cannot_bind_another_users_resume() -> None:
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "application-resume-owner@example.test")
        register(other, "application-resume-other@example.test")
        other_resume = create_resume(other, app, "他人简历")

        created = owner.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(owner, "他人简历隔离公司"),
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        rejected = owner.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_id": other_resume["id"],
                "base_lock_version": application["lock_version"],
            },
        )
        assert rejected.status_code == 404
        assert rejected.json() == {"error": "INTERVIEW_NOT_FOUND"}


def test_marking_an_application_keeps_explicit_resume_version_id_compatibility() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-version-compatibility@example.test")
        resume = create_resume(client, app, "兼容版本简历")
        version = list_resume_versions(client, str(resume["id"]))[0]
        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "兼容版本公司"),
                "current_stage_type": "screening",
                "current_stage_label": "待投递",
                "stage_state": "awaiting_schedule",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        marked = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_version_id": version["id"],
                "base_lock_version": application["lock_version"],
            },
        )
        assert marked.status_code == 200, marked.text
        bound = marked.json()["application"]
        assert bound["resume_version_id"] == version["id"]
        assert bound["resume_title_snapshot"] == version["name"]


def test_application_update_rejects_resume_id_and_resume_version_id_together() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-resume-fields-exclusive@example.test")
        resume = create_resume(client, app, "互斥字段简历")
        version = list_resume_versions(client, str(resume["id"]))[0]
        application = create_application(client, create_job(client, "互斥字段公司"))

        rejected = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "resume_id": resume["id"],
                "resume_version_id": version["id"],
                "calendar_color": "green",
                "base_lock_version": application["lock_version"],
            },
        )
        assert rejected.status_code == 400
        assert rejected.json() == {"error": "INVALID_INTERVIEW_REQUEST"}


def test_marking_an_application_does_not_rewind_explicit_current_stages() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-stage-preservation@example.test")
        resume = create_resume(client, app)
        interview = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "面试阶段公司"),
                "current_stage_type": "interview",
                "current_round_no": 2,
                "current_stage_label": "二面",
                "stage_state": "awaiting_schedule",
            },
        )
        assert interview.status_code == 201, interview.text
        interview_application = interview.json()["application"]

        marked_interview = client.put(
            f"/api/job-applications/{interview_application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_id": resume["id"],
                "base_lock_version": interview_application["lock_version"],
            },
        )
        assert marked_interview.status_code == 200, marked_interview.text
        preserved_interview = marked_interview.json()["application"]
        assert preserved_interview["current_stage_type"] == "interview"
        assert preserved_interview["current_round_no"] == 2
        assert preserved_interview["current_stage_label"] == "二面"
        assert preserved_interview["stage_state"] == "awaiting_schedule"

        screening = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "明确筛选公司"),
                "current_stage_type": "screening",
                "current_stage_label": "初筛",
                "stage_state": "awaiting_result",
            },
        )
        assert screening.status_code == 201, screening.text
        screening_application = screening.json()["application"]

        marked_screening = client.put(
            f"/api/job-applications/{screening_application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_id": resume["id"],
                "base_lock_version": screening_application["lock_version"],
            },
        )
        assert marked_screening.status_code == 200, marked_screening.text
        preserved_screening = marked_screening.json()["application"]
        assert preserved_screening["current_stage_type"] == "screening"
        assert preserved_screening["current_round_no"] is None
        assert preserved_screening["current_stage_label"] == "初筛"
        assert preserved_screening["stage_state"] == "awaiting_result"


def test_screening_quick_add_waits_for_result_and_can_be_rejected() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "screening-quick-add@example.test")
        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "快速筛选公司"),
                "current_stage_type": "screening",
                "current_stage_label": "等待后续通知",
                "stage_state": "awaiting_result",
                "applied_at": "2026-08-22T04:00:00Z",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        added = client.post(
            f"/api/job-applications/{application['id']}/advance",
            json={
                "target_stage_type": "screening",
                "target_round_no": None,
                "target_stage_label": "初筛",
                "base_lock_version": application["lock_version"],
            },
        )
        assert added.status_code == 200, added.text
        added_application = added.json()["application"]
        assert added_application["current_stage_label"] == "初筛"
        assert added_application["stage_state"] == "awaiting_result"

        rejected = client.post(
            f"/api/job-applications/{application['id']}/close",
            json={
                "status": "rejected",
                "base_lock_version": added_application["lock_version"],
            },
        )
        assert rejected.status_code == 200, rejected.text
        assert rejected.json()["application"]["status"] == "rejected"


def test_assessment_quick_add_remains_waiting_to_be_scheduled() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "assessment-quick-add@example.test")
        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "测评公司"),
                "current_stage_type": "screening",
                "current_stage_label": "等待后续通知",
                "stage_state": "awaiting_result",
                "applied_at": "2026-08-22T04:00:00Z",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        added = client.post(
            f"/api/job-applications/{application['id']}/advance",
            json={
                "target_stage_type": "screening",
                "target_round_no": None,
                "target_stage_label": "测评",
                "base_lock_version": application["lock_version"],
            },
        )
        assert added.status_code == 200, added.text
        assert added.json()["application"]["current_stage_type"] == "screening"
        assert added.json()["application"]["current_stage_label"] == "测评"
        assert added.json()["application"]["stage_state"] == "awaiting_schedule"


def test_stale_application_write_cannot_rewind_a_normalized_or_advanced_stage() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "application-stage-lock@example.test")
        resume = create_resume(client, app)
        created = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "阶段并发公司"),
                "current_stage_type": "screening",
                "current_stage_label": "筛选中",
                "stage_state": "awaiting_result",
            },
        )
        assert created.status_code == 201, created.text
        application = created.json()["application"]

        marked = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": "2026-08-22T04:00:00Z",
                "resume_id": resume["id"],
                "base_lock_version": application["lock_version"],
            },
        )
        assert marked.status_code == 200, marked.text
        marked_application = marked.json()["application"]

        advanced = client.post(
            f"/api/job-applications/{application['id']}/advance",
            json={
                "target_stage_type": "screening",
                "target_round_no": None,
                "target_stage_label": "复筛",
                "base_lock_version": marked_application["lock_version"],
            },
        )
        assert advanced.status_code == 200, advanced.text
        advanced_application = advanced.json()["application"]

        stale = client.put(
            f"/api/job-applications/{application['id']}",
            json={
                "applied_at": None,
                "base_lock_version": marked_application["lock_version"],
            },
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "INTERVIEW_EDIT_CONFLICT"}
        current = client.get(f"/api/job-applications/{application['id']}")
        assert current.status_code == 200
        assert current.json()["application"]["current_stage_label"] == "复筛"
        assert current.json()["application"]["stage_state"] == "awaiting_result"
        assert current.json()["application"]["lock_version"] == advanced_application[
            "lock_version"
        ]


def test_archived_applications_are_hidden_and_cannot_receive_new_schedules() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "archived-interview@example.test")
        with_session = create_application(client, create_job(client, "历史场次公司"))
        created = client.post(
            f"/api/job-applications/{with_session['id']}/interview-sessions",
            json=session_payload("77777777-7777-4777-8777-777777777777"),
        )
        assert created.status_code == 201, created.text
        created_body = created.json()
        completed = client.post(
            f"/api/interview-sessions/{created_body['session']['id']}/complete",
            json={"base_lock_version": created_body["session"]["lock_version"]},
        )
        assert completed.status_code == 200, completed.text
        archived = client.post(
            f"/api/job-applications/{with_session['id']}/archive",
            json={
                "base_lock_version": completed.json()["application"]["lock_version"]
            },
        )
        assert archived.status_code == 200, archived.text

        offer_application = client.post(
            "/api/job-applications",
            json={
                "job_description_id": create_job(client, "历史 Offer 公司"),
                "current_stage_type": "offer",
                "current_stage_label": "Offer",
                "stage_state": "negotiating",
            },
        )
        assert offer_application.status_code == 201, offer_application.text
        offered = client.post(
            f"/api/job-applications/{offer_application.json()['application']['id']}/offer",
            json={
                "offer_status": "written_offer_received",
                "base_lock_version": offer_application.json()["application"][
                    "lock_version"
                ],
            },
        )
        assert offered.status_code == 200, offered.text
        archived_offer = client.post(
            f"/api/job-applications/{offered.json()['application']['id']}/archive",
            json={
                "base_lock_version": offered.json()["application"]["lock_version"]
            },
        )
        assert archived_offer.status_code == 200, archived_offer.text

        overview = client.get(
            "/api/interview-overview",
            params={
                "week_start": FIXTURE_WEEK_START.isoformat(),
                "timezone": "Asia/Shanghai",
            },
        )
        assert overview.status_code == 200, overview.text
        assert overview.json()["metrics"] == {
            "weekly_interviews": 0,
            "upcoming_interviews": 0,
            "completed_interviews": 0,
            "written_offers": 0,
        }

        default_sessions = client.get("/api/interview-sessions")
        assert default_sessions.status_code == 200
        assert default_sessions.json()["items"] == []
        history_sessions = client.get(
            "/api/interview-sessions?include_archived=true"
        )
        assert [item["id"] for item in history_sessions.json()["items"]] == [
            created_body["session"]["id"]
        ]
        assert client.get("/api/job-applications").json()["items"] == []
        assert len(client.get("/api/job-applications?scope=all").json()["items"]) == 2

        without_session = create_application(client, create_job(client, "已归档待排期公司"))
        archived_without_session = client.post(
            f"/api/job-applications/{without_session['id']}/archive",
            json={"base_lock_version": without_session["lock_version"]},
        )
        assert archived_without_session.status_code == 200
        blocked = client.post(
            f"/api/job-applications/{without_session['id']}/interview-sessions",
            json=session_payload("88888888-8888-4888-8888-888888888888"),
        )
        assert blocked.status_code == 409
        assert blocked.json() == {"error": "INTERVIEW_INVALID_TRANSITION"}


def test_interview_list_cursors_are_stable_bound_to_filters_and_reject_invalid_values() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "interview-cursor@example.test")
        session_ids: list[str] = []
        for index in range(3):
            application = create_application(
                client, create_job(client, f"分页公司 {index + 1}")
            )
            payload = session_payload(
                f"99999999-9999-4999-8999-99999999999{index}"
            )
            payload.update(
                {
                    "start_at": fixture_datetime(1, 9 + index).isoformat(),
                    "end_at": fixture_datetime(1, 10 + index).isoformat(),
                }
            )
            created = client.post(
                f"/api/job-applications/{application['id']}/interview-sessions",
                json=payload,
            )
            assert created.status_code == 201, created.text
            session_ids.append(created.json()["session"]["id"])

        first_application_page = client.get("/api/job-applications?limit=2")
        assert first_application_page.status_code == 200
        application_body = first_application_page.json()
        assert len(application_body["items"]) == 2
        assert application_body["next_cursor"]
        second_application_page = client.get(
            "/api/job-applications",
            params={"limit": 2, "cursor": application_body["next_cursor"]},
        )
        assert second_application_page.status_code == 200
        all_application_ids = {
            item["id"]
            for item in application_body["items"]
            + second_application_page.json()["items"]
        }
        assert len(all_application_ids) == 3

        first_session_page = client.get("/api/interview-sessions?limit=2")
        assert first_session_page.status_code == 200
        session_body = first_session_page.json()
        assert [item["id"] for item in session_body["items"]] == session_ids[:2]
        assert session_body["next_cursor"]
        second_session_page = client.get(
            "/api/interview-sessions",
            params={"limit": 2, "cursor": session_body["next_cursor"]},
        )
        assert [item["id"] for item in second_session_page.json()["items"]] == [
            session_ids[2]
        ]
        wrong_filter = client.get(
            "/api/interview-sessions",
            params={
                "limit": 2,
                "cursor": session_body["next_cursor"],
                "include_archived": "true",
            },
        )
        assert wrong_filter.status_code == 400
        assert client.get("/api/job-applications?cursor=not-a-cursor").status_code == 400
        invalid_application_filter = client.get(
            "/api/interview-sessions?application_id=01"
        )
        assert invalid_application_filter.status_code == 400
        assert invalid_application_filter.json() == {
            "error": "INVALID_INTERVIEW_QUERY"
        }
        assert client.get("/api/job-applications?status=unknown").status_code == 400
        assert client.get("/api/interview-sessions?status=unknown").status_code == 400
        reversed_range = client.get(
            "/api/interview-sessions",
            params={
                "start_at": fixture_datetime(2, 12).isoformat(),
                "end_at": fixture_datetime(2, 11).isoformat(),
            },
        )
        assert reversed_range.status_code == 400
        assert reversed_range.json() == {"error": "INVALID_INTERVIEW_QUERY"}


def test_session_create_retries_are_idempotent_but_cannot_change_the_bound_payload() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "interview-idempotency@example.test")
        application = create_application(client, create_job(client, "幂等公司"))
        payload = session_payload("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        first = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=payload,
        )
        repeated = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=payload,
        )
        assert first.status_code == repeated.status_code == 201
        assert first.json()["session"]["id"] == repeated.json()["session"]["id"]

        changed = {**payload, "end_at": fixture_datetime(0, 11, 30).isoformat()}
        rejected_replay = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=changed,
        )
        assert rejected_replay.status_code == 409
        assert rejected_replay.json() == {"error": "INTERVIEW_EDIT_CONFLICT"}


def test_archived_history_can_be_cleaned_only_from_child_to_parent() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "interview-cleanup@example.test")
        application = create_application(client, create_job(client, "清理公司"))
        created = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=session_payload("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        ).json()
        archived = client.post(
            f"/api/job-applications/{application['id']}/archive",
            json={"base_lock_version": created["application"]["lock_version"]},
        )
        assert archived.status_code == 200
        blocked_parent = client.delete(
            f"/api/job-applications/{application['id']}"
        )
        assert blocked_parent.status_code == 409

        deleted_session = client.delete(
            f"/api/interview-sessions/{created['session']['id']}"
        )
        assert deleted_session.status_code == 200
        deleted_parent = client.delete(
            f"/api/job-applications/{application['id']}"
        )
        assert deleted_parent.status_code == 200


def test_optimistic_lock_rejects_a_second_application_write_from_a_stale_page() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "interview-edit-conflict@example.test")
        application = create_application(client, create_job(client, "并发编辑公司"))

        first = client.put(
            f"/api/job-applications/{application['id']}",
            json={"calendar_color": "green", "base_lock_version": 1},
        )
        assert first.status_code == 200, first.text
        stale = client.put(
            f"/api/job-applications/{application['id']}",
            json={"calendar_color": "purple", "base_lock_version": 1},
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "INTERVIEW_EDIT_CONFLICT"}

        null_color = client.put(
            f"/api/job-applications/{application['id']}",
            json={"calendar_color": None, "base_lock_version": 2},
        )
        assert null_color.status_code == 400
        assert null_color.json() == {"error": "INVALID_INTERVIEW_REQUEST"}

        scheduled = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=session_payload("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
        )
        assert scheduled.status_code == 201, scheduled.text
        null_mode = client.put(
            f"/api/interview-sessions/{scheduled.json()['session']['id']}",
            json={
                "mode": None,
                "base_lock_version": scheduled.json()["session"]["lock_version"],
            },
        )
        assert null_mode.status_code == 400
        assert null_mode.json() == {"error": "INVALID_INTERVIEW_REQUEST"}


def test_asset_storage_failure_does_not_create_visible_metadata() -> None:
    storage = FailingUploadStorage()
    app = build_app(storage)
    with TestClient(app) as client:
        register(client, "interview-storage-failure@example.test")
        application = create_application(client, create_job(client, "存储失败公司"))
        created = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=session_payload("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        )
        assert created.status_code == 201, created.text
        session_id = created.json()["session"]["id"]

        failed = client.post(
            f"/api/interview-sessions/{session_id}/assets",
            data={"source_type": "uploaded"},
            files={"file": ("interview.webm", b"fake-audio", "audio/webm")},
        )
        assert failed.status_code == 502
        assert failed.json() == {"error": "INTERVIEW_ASSET_UPLOAD_FAILED"}
        detail = client.get(f"/api/interview-sessions/{session_id}")
        assert detail.status_code == 200
        assert detail.json()["assets"] == []
        assert storage.objects == {}


def test_media_recorder_ogg_audio_uses_the_shared_asset_store() -> None:
    storage = FakeStorage()
    app = build_app(storage)
    with TestClient(app) as client:
        register(client, "interview-ogg@example.test")
        application = create_application(client, create_job(client, "录音兼容公司"))
        created = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=session_payload("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
        )
        assert created.status_code == 201, created.text

        uploaded = client.post(
            f"/api/interview-sessions/{created.json()['session']['id']}/assets",
            data={"source_type": "recorded", "duration_ms": "30000"},
            files={"file": ("interview.ogg", b"fake-ogg", "audio/ogg")},
        )
        assert uploaded.status_code == 201, uploaded.text
        assert uploaded.json()["asset"]["asset_type"] == "audio"
        assert len(storage.objects) == 1
