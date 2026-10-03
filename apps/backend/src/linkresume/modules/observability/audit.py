from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request


@dataclass(frozen=True)
class AuditAction:
    action: str
    target_type: str
    target_param: str | None = None
    target_actor: bool = False


AUDIT_ACTIONS: dict[tuple[str, str], AuditAction] = {
    ("POST", "/api/interview-sessions/{session_id}/assets/{dataset_id}/transcription"): AuditAction("interview.transcription_create", "dataset", "dataset_id"),
    ("POST", "/api/interview-sessions/{session_id}/assets/{dataset_id}/transcription/cancel"): AuditAction("interview.transcription_cancel", "dataset", "dataset_id"),
    ("POST", "/api/auth/register"): AuditAction("auth.register", "user"),
    ("POST", "/api/auth/login"): AuditAction("auth.login", "user"),
    ("POST", "/api/auth/admin-login"): AuditAction("auth.admin_login", "user"),
    ("POST", "/api/auth/refresh"): AuditAction("auth.session_refresh", "session"),
    ("POST", "/api/auth/logout"): AuditAction("auth.logout", "session"),
    ("PATCH", "/api/account/profile"): AuditAction(
        "account.profile_update", "user", target_actor=True
    ),
    ("PUT", "/api/account/avatar"): AuditAction(
        "account.avatar_upload", "user", target_actor=True
    ),
    ("DELETE", "/api/account/avatar"): AuditAction(
        "account.avatar_delete", "user", target_actor=True
    ),
    ("POST", "/api/account/change-password"): AuditAction(
        "account.password_change", "user", target_actor=True
    ),
    ("POST", "/api/assets"): AuditAction(
        "account.asset_upload", "user", target_actor=True
    ),
    ("POST", "/api/resumes"): AuditAction("resume.create", "resume"),
    ("POST", "/api/resumes/import"): AuditAction("resume.import", "resume_import"),
    ("PUT", "/api/resumes/{resume_id}"): AuditAction(
        "resume.update", "resume", "resume_id"
    ),
    ("DELETE", "/api/resumes/{resume_id}"): AuditAction(
        "resume.delete", "resume", "resume_id"
    ),
    ("GET", "/api/resumes/{resume_id}/pdf"): AuditAction(
        "resume.pdf_export", "resume", "resume_id"
    ),
    ("POST", "/api/resumes/{resume_id}/assets"): AuditAction(
        "resume.asset_upload", "resume", "resume_id"
    ),
    ("DELETE", "/api/resumes/{resume_id}/assets/{asset_name}"): AuditAction(
        "resume.asset_delete", "resume", "resume_id"
    ),
    ("POST", "/api/job-descriptions"): AuditAction("job.create", "job"),
    ("POST", "/api/job-descriptions/import"): AuditAction(
        "job.import_from_extension", "job"
    ),
    ("PUT", "/api/job-descriptions/{job_id}"): AuditAction(
        "job.update", "job", "job_id"
    ),
    ("DELETE", "/api/job-descriptions/{job_id}"): AuditAction(
        "job.delete", "job", "job_id"
    ),
    ("POST", "/api/job-applications"): AuditAction(
        "interview.application_create", "job_application"
    ),
    ("PUT", "/api/job-applications/{application_id}"): AuditAction(
        "interview.application_update", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/advance"): AuditAction(
        "interview.application_advance", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/offer"): AuditAction(
        "interview.offer_update", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/close"): AuditAction(
        "interview.application_close", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/archive"): AuditAction(
        "interview.application_archive", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/restore"): AuditAction(
        "interview.application_restore", "job_application", "application_id"
    ),
    ("DELETE", "/api/job-applications/{application_id}"): AuditAction(
        "interview.application_delete", "job_application", "application_id"
    ),
    (
        "POST",
        "/api/job-applications/{application_id}/interview-sessions",
    ): AuditAction("interview.session_create", "interview_session"),
    ("PUT", "/api/interview-sessions/{session_id}"): AuditAction(
        "interview.session_update", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/reschedule"): AuditAction(
        "interview.session_reschedule", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/complete"): AuditAction(
        "interview.session_complete", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/cancel"): AuditAction(
        "interview.session_cancel", "interview_session", "session_id"
    ),
    ("DELETE", "/api/interview-sessions/{session_id}"): AuditAction(
        "interview.session_delete", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/assets"): AuditAction(
        "interview.asset_upload", "interview_asset"
    ),
    ("DELETE", "/api/interview-assets/{asset_id}"): AuditAction(
        "interview.asset_delete", "interview_asset", "asset_id"
    ),
    ("POST", "/api/mock-interviews"): AuditAction(
        "mock_interview.create", "mock_interview"
    ),
    ("POST", "/api/mock-interviews/{interview_id}/repeat"): AuditAction(
        "mock_interview.create", "mock_interview"
    ),
    ("POST", "/api/mock-interviews/{interview_id}/finish"): AuditAction(
        "mock_interview.finish", "mock_interview", "interview_id"
    ),
    ("DELETE", "/api/mock-interviews/{interview_id}"): AuditAction(
        "mock_interview.delete", "mock_interview", "interview_id"
    ),
    ("POST", "/api/mock-interviews/{interview_id}/transcripts:correct"): AuditAction(
        "mock_interview.transcript_correct", "mock_interview", "interview_id"
    ),
    ("PUT", "/api/mock-interviews/{interview_id}/questions/{question_id}/transcript"): AuditAction(
        "mock_interview.transcript_edit", "mock_interview", "interview_id"
    ),
    ("POST", "/api/mock-interviews/{interview_id}/questions/{question_id}/re-evaluate"): AuditAction(
        "mock_interview.re_evaluate", "mock_interview", "interview_id"
    ),
    ("DELETE", "/api/mock-interviews/{interview_id}/recordings"): AuditAction(
        "mock_interview.recordings_delete", "mock_interview", "interview_id"
    ),
    ("PATCH", "/api/auth/admin/users/{user_id}/status"): AuditAction(
        "admin.user_status_change", "user", "user_id"
    ),
    ("POST", "/api/admin/llm/connections"): AuditAction(
        "admin.llm_connection_create", "llm_connection"
    ),
    ("PATCH", "/api/admin/llm/connections/{connection_id}"): AuditAction(
        "admin.llm_connection_update", "llm_connection", "connection_id"
    ),
    ("DELETE", "/api/admin/llm/connections/{connection_id}"): AuditAction(
        "admin.llm_connection_delete", "llm_connection", "connection_id"
    ),
    ("POST", "/api/admin/llm/connections/{connection_id}/sync"): AuditAction(
        "admin.llm_connection_sync", "llm_connection", "connection_id"
    ),
    ("POST", "/api/admin/llm/models"): AuditAction(
        "admin.llm_model_create", "llm_model"
    ),
    ("PATCH", "/api/admin/llm/models/{model_id}"): AuditAction(
        "admin.llm_model_update", "llm_model", "model_id"
    ),
    ("DELETE", "/api/admin/llm/models/{model_id}"): AuditAction(
        "admin.llm_model_delete", "llm_model", "model_id"
    ),
    ("POST", "/api/admin/llm/routes"): AuditAction(
        "admin.llm_route_create", "llm_route"
    ),
    ("PATCH", "/api/admin/llm/routes/{route_id}"): AuditAction(
        "admin.llm_route_update", "llm_route", "route_id"
    ),
    ("DELETE", "/api/admin/llm/routes/{route_id}"): AuditAction(
        "admin.llm_route_delete", "llm_route", "route_id"
    ),
    # A route can serve several use cases, so binding targets are "<use_case>:<route_id>".
    ("PUT", "/api/admin/llm/use-cases/{use_case}/routes/{route_id}"): AuditAction(
        "admin.llm_binding_upsert", "llm_binding", "route_id"
    ),
    ("PATCH", "/api/admin/llm/use-cases/{use_case}/routes/{route_id}"): AuditAction(
        "admin.llm_binding_update", "llm_binding", "route_id"
    ),
    ("DELETE", "/api/admin/llm/use-cases/{use_case}/routes/{route_id}"): AuditAction(
        "admin.llm_binding_delete", "llm_binding", "route_id"
    ),
    ("POST", "/api/admin/llm/use-cases/{use_case}/routes/{route_id}/probe"): AuditAction(
        "admin.llm_binding_probe", "llm_binding", "route_id"
    ),
    # Plugin release targets are the affected package version.
    ("POST", "/api/admin/plugin-releases"): AuditAction(
        "admin.plugin_release_publish", "plugin_release"
    ),
    ("DELETE", "/api/admin/plugin-releases/current"): AuditAction(
        "admin.plugin_release_unpublish", "plugin_release"
    ),
    ("POST", "/api/admin/plugin-releases/current/publish"): AuditAction(
        "admin.plugin_release_reactivate", "plugin_release"
    ),
    ("DELETE", "/api/admin/plugin-releases/current/package"): AuditAction(
        "admin.plugin_release_delete", "plugin_release"
    ),
    ("POST", "/api/admin/announcements"): AuditAction(
        "admin.announcement_create", "announcement"
    ),
    ("PATCH", "/api/admin/announcements/{announcement_id}"): AuditAction(
        "admin.announcement_update", "announcement", "announcement_id"
    ),
    ("DELETE", "/api/admin/announcements/{announcement_id}"): AuditAction(
        "admin.announcement_delete", "announcement", "announcement_id"
    ),
    ("POST", "/api/admin/announcements/{announcement_id}/publish"): AuditAction(
        "admin.announcement_publish", "announcement", "announcement_id"
    ),
    ("POST", "/api/admin/announcements/{announcement_id}/unpublish"): AuditAction(
        "admin.announcement_unpublish", "announcement", "announcement_id"
    ),
}

AUDIT_ACTION_NAMES = frozenset(action.action for action in AUDIT_ACTIONS.values())
AUDIT_ACTION_NAMES_WITH_CLIENT = frozenset((*AUDIT_ACTION_NAMES, "resume.pdf_export"))


def canonical_route_path(request: Request) -> str:
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if not isinstance(route_path, str):
        return "unmatched"
    if request.url.path.startswith("/api/") and not route_path.startswith("/api/"):
        return f"/api{route_path}"
    return route_path


def audit_action_for(request: Request) -> AuditAction | None:
    return AUDIT_ACTIONS.get((request.method.upper(), canonical_route_path(request)))


def bind_audit_actor(request: Request, user_id: int, *, is_admin: bool = False) -> None:
    request.state.actor_user_id = str(user_id)
    request.state.actor_type = "admin" if is_admin else "user"


def bind_audit_target(request: Request, target_id: object) -> None:
    request.state.audit_target_id = str(target_id)


def audit_target_id(request: Request, action: AuditAction) -> str | None:
    explicit = getattr(request.state, "audit_target_id", None)
    if explicit is not None:
        return str(explicit)
    if action.target_actor:
        actor = getattr(request.state, "actor_user_id", None)
        return str(actor) if actor is not None else None
    if action.target_param:
        value = request.path_params.get(action.target_param)
        if action.target_type == "llm_binding":
            use_case = request.path_params.get("use_case")
            if value is not None and use_case is not None:
                return f"{use_case}:{value}"
        return str(value) if value is not None else None
    return None
