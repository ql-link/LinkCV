"""Owner-scoped, bounded context selection for the Agent API.

The browser submits references only.  This module is the trust boundary that
resolves those references against the authenticated user, checks the stable
version marker, creates the light-weight message snapshot, and prepares the
small allow-listed material sent to Pi.  Message snapshots never contain the
material body.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import parse_persisted_resume_snapshot
from linkresume.core.config import Settings
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.identity.models import UserProfile
from linkresume.modules.identity.schemas import UserProfileData
from linkresume.modules.identity.dependencies import lock_active_user
from linkresume.modules.datasets.routes import read_dataset_markdown
from linkresume.modules.agent.schemas import (
    AgentContextListItem,
    AgentContextMaterial,
    AgentContextRef,
    AgentContextSnapshot,
    AgentContextType,
)
from linkresume.modules.agent.resume_tools import editor_markdown
from linkresume.modules.interviews.models import (
    InterviewSession,
    JobApplication,
    JobApplicationStage,
)
from linkresume.modules.job_descriptions.models import JobDescription
from linkresume.modules.resumes.models import (
    DATASET_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
)


CONTEXT_TYPES: tuple[AgentContextType, ...] = (
    "user_profile",
    "resume",
    "resume_version",
    "dataset",
    "job",
    "application",
    "interview",
)
MAX_CONTEXTS = 10
MAX_ITEM_CHARS = 24_000
MAX_TOTAL_MATERIAL_CHARS = 60_000


@dataclass(frozen=True)
class ResolvedContexts:
    snapshots: list[AgentContextSnapshot]
    materials: list[AgentContextMaterial]

    @property
    def resume_ids(self) -> set[str]:
        return {item.resume_id for item in self.snapshots if item.resume_id is not None}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _clip(value: object, limit: int) -> str:
    text = "" if value is None else str(value)
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"


def _version_markers(
    *,
    version: int | str | None,
    updated_at: datetime,
    extra: tuple[int | str, ...] = (),
) -> set[str]:
    timestamp = _utc(updated_at)
    markers = {
        str(version) if version is not None else "",
        timestamp.isoformat(),
        timestamp.isoformat().replace("+00:00", "Z"),
    }
    markers.update(str(item) for item in extra)
    markers.discard("")
    return markers


def _ensure_fresh(ref: AgentContextRef, markers: set[str]) -> None:
    # A missing marker is tolerated for old handoff clients.  The server still
    # records the authoritative marker in the snapshot, while clients that
    # provide one receive strict stale detection.
    if ref.version is not None and ref.version not in markers:
        raise ApiError(409, "AGENT_CONTEXT_STALE")


def _snapshot(
    *,
    type: AgentContextType,
    id: str,
    version: str,
    lock_version: int | None = None,
    updated_at: datetime,
    label: str,
    description: str | None = None,
    version_id: str | None = None,
    resume_id: str | None = None,
) -> AgentContextSnapshot:
    return AgentContextSnapshot(
        type=type,
        id=id,
        version=version,
        lock_version=lock_version,
        version_id=version_id,
        resume_id=resume_id,
        label=_clip(label.strip(), 255),
        description=_clip(description, 500) if description else None,
        updated_at=_utc(updated_at),
    )


def _list_item(snapshot: AgentContextSnapshot) -> AgentContextListItem:
    return AgentContextListItem.model_validate(
        snapshot.model_dump(exclude={"presentation"})
    )


def _profile_content(profile: UserProfile) -> str:
    # Explicit career-material projection: newly added identity/contact/application facts
    # must never silently enter an existing AI context selection.
    career_fields = {"candidate_cities", "salary_min", "salary_max", "salary_currency", "salary_period",
                     "employment_types", "school", "school_tier", "major", "education_level",
                     "years_experience", "candidate_status", "graduation_year", "languages", "skills",
                     "certifications", "honors", "campus_experiences"}
    values = UserProfileData.model_validate(profile).model_dump(mode="json", include=career_fields)
    lines = [
        f"- {key}: {json.dumps(value, ensure_ascii=False)}"
        for key, value in values.items() if value is not None and value != [] and value != ""
    ]
    return "## Personal career profile\n" + "\n".join(lines) if lines else ""


def _profile_snapshot(profile: UserProfile) -> AgentContextSnapshot:
    return _snapshot(
        type="user_profile", id=str(profile.user_id), version=str(profile.lock_version),
        lock_version=profile.lock_version, updated_at=profile.update_time,
        label="个人画像", description="本人填写的求职资料",
    )


def _resume_item(resume: Resume) -> AgentContextListItem:
    return _list_item(
        _snapshot(
            type="resume",
            id=str(resume.id),
            version=str(resume.lock_version),
            lock_version=resume.lock_version,
            updated_at=resume.update_time,
            label=resume.title,
            description="当前简历",
            resume_id=str(resume.id),
        )
    )


def _dataset_item(
    dataset: UserDataset, task: DocumentParseTask
) -> AgentContextListItem:
    return _list_item(
        _snapshot(
            type="dataset",
            id=str(dataset.id),
            version=dataset.sha256,
            updated_at=task.update_time,
            label=dataset.file_name,
            description="资料库文件",
        )
    )


def _job_item(job: JobDescription) -> AgentContextListItem:
    return _list_item(
        _snapshot(
            type="job",
            id=str(job.id),
            version=str(job.lock_version),
            lock_version=job.lock_version,
            updated_at=job.update_time,
            label=f"{job.company_name} · {job.job_title}",
            description=job.work_city or job.employment_type,
        )
    )


def _application_item(
    application: JobApplication,
    resume_id: int | None = None,
    stage: JobApplicationStage | None = None,
) -> AgentContextListItem:
    return _list_item(
        _snapshot(
            type="application",
            id=str(application.id),
            version=str(application.lock_version),
            lock_version=application.lock_version,
            updated_at=application.update_time,
            label=(
                f"{application.company_name_snapshot} · "
                f"{application.job_title_snapshot}"
            ),
            description=stage.stage_label if stage else "待投递",
            resume_id=str(resume_id) if resume_id is not None else None,
        )
    )


def _interview_item(
    interview: InterviewSession,
    application: JobApplication,
    resume_id: int | None = None,
) -> AgentContextListItem:
    return _list_item(
        _snapshot(
            type="interview",
            id=str(interview.id),
            version=str(interview.lock_version),
            lock_version=interview.lock_version,
            updated_at=interview.update_time,
            label=(
                f"{application.company_name_snapshot} · "
                f"{application.job_title_snapshot} · {interview.stage_label}"
            ),
            description=interview.status,
            resume_id=str(resume_id) if resume_id is not None else None,
        )
    )


def list_contexts(
    db: Session,
    *,
    user_id: int,
    context_type: str | None = None,
    query: str | None = None,
    prefix_match: bool = False,
    limit: int = 50,
) -> list[AgentContextListItem]:
    """List only light-weight records owned by ``user_id``.

    When no type is requested, ``limit`` is applied independently to each
    category so one large resume history cannot hide the other four choices.
    Results are grouped by the stable type order used by the selector.
    """

    if limit < 1 or limit > 100:
        raise ApiError(400, "INVALID_AGENT_CONTEXT_QUERY")
    if context_type is not None and context_type not in CONTEXT_TYPES:
        raise ApiError(400, "INVALID_AGENT_CONTEXT_QUERY")

    normalized_query = query.strip() if query and query.strip() else None
    search_pattern = (
        f"{normalized_query}%" if prefix_match else f"%{normalized_query}%"
    ) if normalized_query else None
    types = (context_type,) if context_type is not None else CONTEXT_TYPES
    if context_type == "resume_version":
        raise ApiError(409, "AGENT_CONTEXT_RETIRED")
    types = tuple(item for item in types if item != "resume_version")
    result: list[AgentContextListItem] = []
    for item_type in types:
        if item_type == "user_profile":
            profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
            if profile is not None and _profile_content(profile) and (
                normalized_query is None or normalized_query.lower() in "个人画像 本人填写的求职资料 career profile"
            ):
                result.append(_list_item(_profile_snapshot(profile)))
        elif item_type == "resume":
            statement = select(Resume).where(Resume.user_id == user_id)
            if search_pattern is not None:
                statement = statement.where(Resume.title.ilike(search_pattern))
            records = db.scalars(
                statement.order_by(Resume.update_time.desc(), Resume.id.desc()).limit(
                    limit
                )
            ).all()
            result.extend(_resume_item(record) for record in records)
        elif item_type == "dataset":
            statement = (
                select(UserDataset, DocumentParseTask)
                .join(
                    DocumentParseTask,
                    DocumentParseTask.id == UserDataset.parse_task_id,
                )
                .where(
                    UserDataset.user_id == user_id,
                    DocumentParseTask.user_id == user_id,
                    DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                    DocumentParseTask.upload_status == "succeeded",
                    DocumentParseTask.parse_status == "succeeded",
                    DocumentParseTask.converted_object_name.is_not(None),
                )
            )
            if search_pattern is not None:
                statement = statement.where(
                    UserDataset.file_name.ilike(search_pattern)
                )
            rows = db.execute(
                statement.order_by(
                    DocumentParseTask.update_time.desc(), UserDataset.id.desc()
                ).limit(limit)
            ).all()
            result.extend(_dataset_item(dataset, task) for dataset, task in rows)
        elif item_type == "job":
            statement = select(JobDescription).where(JobDescription.user_id == user_id)
            if search_pattern is not None:
                statement = statement.where(
                    or_(
                        JobDescription.company_name.ilike(search_pattern),
                        JobDescription.job_title.ilike(search_pattern),
                        JobDescription.work_city.ilike(search_pattern),
                        JobDescription.employment_type.ilike(search_pattern),
                    )
                )
            records = db.scalars(
                statement.order_by(
                    JobDescription.update_time.desc(), JobDescription.id.desc()
                ).limit(limit)
            ).all()
            result.extend(_job_item(record) for record in records)
        elif item_type == "application":
            statement = (
                select(JobApplication, JobApplication.resume_id, JobApplicationStage)
                .outerjoin(
                    JobApplicationStage,
                    (JobApplicationStage.application_id == JobApplication.id)
                    & (JobApplicationStage.current_marker == 1),
                )
                .where(JobApplication.user_id == user_id)
            )
            if search_pattern is not None:
                statement = statement.where(
                    or_(
                        JobApplication.company_name_snapshot.ilike(search_pattern),
                        JobApplication.job_title_snapshot.ilike(search_pattern),
                        JobApplication.current_stage_label.ilike(search_pattern),
                        JobApplicationStage.stage_label.ilike(search_pattern),
                    )
                )
            rows = db.execute(
                statement.order_by(
                    JobApplication.update_time.desc(), JobApplication.id.desc()
                ).limit(limit)
            ).all()
            result.extend(
                _application_item(application, resume_id, stage)
                for application, resume_id, stage in rows
            )
        else:
            statement = (
                select(InterviewSession, JobApplication, JobApplication.resume_id)
                .join(
                    JobApplication, JobApplication.id == InterviewSession.application_id
                )
                .where(JobApplication.user_id == user_id)
            )
            if search_pattern is not None:
                statement = statement.where(
                    or_(
                        JobApplication.company_name_snapshot.ilike(search_pattern),
                        JobApplication.job_title_snapshot.ilike(search_pattern),
                        InterviewSession.stage_label.ilike(search_pattern),
                        InterviewSession.status.ilike(search_pattern),
                    )
                )
            rows = db.execute(
                statement.order_by(
                    InterviewSession.update_time.desc(), InterviewSession.id.desc()
                ).limit(limit)
            ).all()
            result.extend(
                _interview_item(interview, application, resume_id)
                for interview, application, resume_id in rows
            )
    return result


def _material_content(
    *,
    type: AgentContextType,
    resume: Resume | None = None,
    dataset_markdown: str | None = None,
    job: JobDescription | None = None,
    application: JobApplication | None = None,
    application_stage: JobApplicationStage | None = None,
    interview: InterviewSession | None = None,
) -> dict[str, object]:
    if type == "resume":
        source = resume
        if source is None:
            return {}
        snapshot = parse_persisted_resume_snapshot(source.data_json, source.style_json)
        markdown = editor_markdown(snapshot.data) or ""
        return {"resume_markdown": _clip(markdown, MAX_ITEM_CHARS)}
    if type == "dataset" and dataset_markdown is not None:
        return {"dataset_markdown": _clip(dataset_markdown, MAX_ITEM_CHARS)}
    if type == "job" and job is not None:
        return {
            "job_title": _clip(job.job_title, 200),
            "company_name": _clip(job.company_name, 200),
            "description": _clip(job.description, 16_000),
            "skills": [_clip(item, 120) for item in (job.skills or [])[:50]],
            "experience_requirement": _clip(job.experience_requirement, 200),
            "education_requirement": _clip(job.education_requirement, 200),
            "work_city": _clip(job.work_city, 200),
            "work_mode": _clip(job.work_mode, 50),
        }
    if type == "application" and application is not None:
        return {
            "company_name": _clip(application.company_name_snapshot, 200),
            "job_title": _clip(application.job_title_snapshot, 200),
            "stage": _clip(
                application_stage.stage_label if application_stage else "待投递", 100
            ),
            "stage_type": _clip(
                application_stage.stage_type if application_stage else "pending", 50
            ),
            "status": _clip(application.lifecycle_status, 50),
            "offer_status": _clip(application.offer_status, 50),
            "notes": _clip(application.notes, 8_000),
        }
    if type == "interview" and interview is not None:
        return {
            "stage": _clip(interview.stage_label, 100),
            "status": _clip(interview.status, 50),
            "mode": _clip(interview.mode, 50),
            "preparation_note": _clip(interview.preparation_note, 6_000),
            "questions": _clip(interview.questions_markdown, 8_000),
            "review_summary": _clip(interview.review_summary, 8_000),
            "improvement": _clip(interview.improvement_markdown, 8_000),
        }
    return {}


def _make_material(
    snapshot: AgentContextSnapshot, content: dict[str, object]
) -> AgentContextMaterial:
    # Keep the encoded body bounded as a second defence in case a future field
    # is added to one of the allow-lists above.
    encoded = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    if len(encoded) > MAX_ITEM_CHARS:
        content = {"summary": _clip(encoded, MAX_ITEM_CHARS)}
    return AgentContextMaterial(
        **snapshot.model_dump(),
        content=content,
    )


def _resolve_resume(
    db: Session, *, user_id: int, ref: AgentContextRef
) -> tuple[Resume, AgentContextSnapshot, AgentContextMaterial]:
    resume = db.scalar(
        select(Resume)
        .where(Resume.id == int(ref.id), Resume.user_id == user_id)
        .with_for_update()
    )
    if resume is None:
        raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
    markers = _version_markers(
        version=resume.lock_version, updated_at=resume.update_time
    )
    _ensure_fresh(ref, markers)
    snapshot = _snapshot(
        type="resume",
        id=str(resume.id),
        version=str(resume.lock_version),
        lock_version=resume.lock_version,
        resume_id=str(resume.id),
        label=resume.title,
        description="当前简历",
        updated_at=resume.update_time,
    )
    return (
        resume,
        snapshot,
        _make_material(snapshot, _material_content(type="resume", resume=resume)),
    )


def _resolve_job(
    db: Session, *, user_id: int, ref: AgentContextRef
) -> tuple[AgentContextSnapshot, AgentContextMaterial]:
    job = db.scalar(
        select(JobDescription)
        .where(JobDescription.id == int(ref.id), JobDescription.user_id == user_id)
        .with_for_update()
    )
    if job is None:
        raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
    _ensure_fresh(
        ref,
        _version_markers(version=job.lock_version, updated_at=job.update_time),
    )
    snapshot = _snapshot(
        type="job",
        id=str(job.id),
        version=str(job.lock_version),
        lock_version=job.lock_version,
        label=f"{job.company_name} · {job.job_title}",
        description=job.work_city or job.employment_type,
        updated_at=job.update_time,
    )
    return snapshot, _make_material(snapshot, _material_content(type="job", job=job))


def _resolve_dataset(
    db: Session,
    *,
    user_id: int,
    ref: AgentContextRef,
    storage: AssetStorage,
    settings: Settings,
) -> tuple[AgentContextSnapshot, AgentContextMaterial]:
    row = db.execute(
        select(UserDataset, DocumentParseTask)
        .join(
            DocumentParseTask,
            DocumentParseTask.id == UserDataset.parse_task_id,
        )
        .where(
            UserDataset.id == int(ref.id),
            UserDataset.user_id == user_id,
            DocumentParseTask.user_id == user_id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
            DocumentParseTask.upload_status == "succeeded",
            DocumentParseTask.parse_status == "succeeded",
            DocumentParseTask.converted_object_name.is_not(None),
        )
        .with_for_update()
    ).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
    dataset, task = row
    _ensure_fresh(
        ref,
        _version_markers(version=dataset.sha256, updated_at=task.update_time),
    )
    object_name = task.converted_object_name
    expected_prefix = f"users/{user_id}/datasets/converted/"
    if object_name is None or not object_name.startswith(expected_prefix):
        raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
    try:
        markdown = read_dataset_markdown(
            storage,
            object_name,
            settings.resume_markdown_max_bytes,
        )
    except Exception as error:
        raise ApiError(502, "AGENT_CONTEXT_READ_FAILED") from error
    snapshot = _snapshot(
        type="dataset",
        id=str(dataset.id),
        version=dataset.sha256,
        updated_at=task.update_time,
        label=dataset.file_name,
        description="资料库文件",
    )
    return snapshot, _make_material(
        snapshot,
        _material_content(type="dataset", dataset_markdown=markdown),
    )


def _resolve_application(
    db: Session, *, user_id: int, ref: AgentContextRef
) -> tuple[JobApplication, AgentContextSnapshot, AgentContextMaterial]:
    row = db.execute(
        select(JobApplication, JobApplicationStage)
        .outerjoin(
            JobApplicationStage,
            (JobApplicationStage.application_id == JobApplication.id)
            & (JobApplicationStage.current_marker == 1),
        )
        .where(JobApplication.id == int(ref.id), JobApplication.user_id == user_id)
        .with_for_update()
    ).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
    application, stage = row
    linked_resume_id = application.resume_id
    _ensure_fresh(
        ref,
        _version_markers(
            version=application.lock_version, updated_at=application.update_time
        ),
    )
    snapshot = _snapshot(
        type="application",
        id=str(application.id),
        version=str(application.lock_version),
        lock_version=application.lock_version,
        label=(
            f"{application.company_name_snapshot} · {application.job_title_snapshot}"
        ),
        description=stage.stage_label if stage else "待投递",
        updated_at=application.update_time,
        resume_id=str(linked_resume_id) if linked_resume_id is not None else None,
    )
    return (
        application,
        snapshot,
        _make_material(
            snapshot,
            _material_content(
                type="application",
                application=application,
                application_stage=stage,
            ),
        ),
    )


def _resolve_interview(
    db: Session, *, user_id: int, ref: AgentContextRef
) -> tuple[
    InterviewSession, JobApplication, AgentContextSnapshot, AgentContextMaterial
]:
    row = db.execute(
        select(InterviewSession, JobApplication)
        .join(JobApplication, JobApplication.id == InterviewSession.application_id)
        .where(
            InterviewSession.id == int(ref.id),
            JobApplication.user_id == user_id,
        )
        .with_for_update()
    ).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
    interview, application = row
    linked_resume_id = application.resume_id
    _ensure_fresh(
        ref,
        _version_markers(
            version=interview.lock_version, updated_at=interview.update_time
        ),
    )
    snapshot = _snapshot(
        type="interview",
        id=str(interview.id),
        version=str(interview.lock_version),
        lock_version=interview.lock_version,
        label=(
            f"{application.company_name_snapshot} · "
            f"{application.job_title_snapshot} · {interview.stage_label}"
        ),
        description=interview.status,
        updated_at=interview.update_time,
        resume_id=str(linked_resume_id) if linked_resume_id is not None else None,
    )
    return (
        interview,
        application,
        snapshot,
        _make_material(
            snapshot, _material_content(type="interview", interview=interview)
        ),
    )


def resolve_contexts(
    db: Session,
    *,
    user_id: int,
    refs: list[AgentContextRef] | None,
    storage: AssetStorage,
    settings: Settings,
) -> ResolvedContexts:
    """Resolve and validate all references before a run/message is created."""

    refs = refs or []
    if refs:
        lock_active_user(db, user_id)
    if len(refs) > MAX_CONTEXTS:
        raise ApiError(400, "INVALID_AGENT_CONTEXTS")
    seen_types: set[str] = set()
    snapshots: list[AgentContextSnapshot] = []
    materials: list[AgentContextMaterial] = []
    for ref in refs:
        if ref.type in seen_types:
            raise ApiError(400, "INVALID_AGENT_CONTEXTS")
        seen_types.add(ref.type)
        if ref.type == "user_profile":
            if ref.id != str(user_id):
                raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
            profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id).with_for_update())
            if profile is None or not _profile_content(profile):
                raise ApiError(404, "AGENT_CONTEXT_NOT_FOUND")
            if ref.version is None or ref.version != str(profile.lock_version):
                raise ApiError(409, "AGENT_CONTEXT_STALE")
            snapshot = _profile_snapshot(profile)
            material = _make_material(snapshot, {"profile_markdown": _profile_content(profile)})
        elif ref.type == "resume":
            _, snapshot, material = _resolve_resume(db, user_id=user_id, ref=ref)
        elif ref.type == "resume_version":
            raise ApiError(409, "AGENT_CONTEXT_RETIRED")
        elif ref.type == "dataset":
            snapshot, material = _resolve_dataset(
                db,
                user_id=user_id,
                ref=ref,
                storage=storage,
                settings=settings,
            )
        elif ref.type == "job":
            snapshot, material = _resolve_job(db, user_id=user_id, ref=ref)
        elif ref.type == "application":
            _, snapshot, material = _resolve_application(db, user_id=user_id, ref=ref)
        else:
            _, _, snapshot, material = _resolve_interview(db, user_id=user_id, ref=ref)
        snapshot.presentation = ref.presentation
        material.presentation = ref.presentation
        snapshots.append(snapshot)
        materials.append(material)

    total_chars = 0
    for material in materials:
        encoded = json.dumps(
            material.content, ensure_ascii=False, separators=(",", ":")
        )
        total_chars += len(encoded)
        if total_chars > MAX_TOTAL_MATERIAL_CHARS:
            remaining = max(0, MAX_TOTAL_MATERIAL_CHARS - (total_chars - len(encoded)))
            material.content = {"summary": _clip(encoded, remaining)}
            total_chars = MAX_TOTAL_MATERIAL_CHARS
    return ResolvedContexts(snapshots=snapshots, materials=materials)
