import hashlib
import hmac
import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from drawoffer.core.errors import ApiError
from drawoffer.domain.resume import CanonicalResumeDocument
from drawoffer.modules.datasets.models import UserDataset
from drawoffer.modules.datasets.routes import read_dataset_markdown
from drawoffer.integrations.linkrag_client import LinkRagError
from drawoffer.services.dataset_content_service import content_key, source_version
from drawoffer.services.rag_sync_service import recall_dataset_snippets
from drawoffer.modules.job_descriptions.models import JobDescription
from drawoffer.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask, Resume


ENTRY_FIELD_KEYS = (
    "name",
    "organization",
    "role",
    "location",
    "start_date",
    "end_date",
    "url",
    "degree",
    "major",
)
ENTRY_FIELD_LABELS = {
    "name": "姓名",
    "organization": "组织",
    "role": "角色",
    "location": "地点",
    "start_date": "开始",
    "end_date": "结束",
    "url": "链接",
    "degree": "学位",
    "major": "专业",
}
# Display-only marker stripping is also used by mock interview rendering.
BLOCK_MARKER_PATTERN = re.compile(
    r"\[\[linkresume-block:(node_[a-z0-9]{16,64})"
    r"(?::(?:(?:identity|profile|work|education|project|skills|activity|interests|certificates|awards|languages|custom)"
    r"|entry-field:(name|organization|role|location|start_date|end_date|url|degree|major)))?\]\]"
)
NUMBER_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])\d+(?:\.\d+)?\s*(?:%|％|倍|万|亿|ms|s|秒|分钟|小时|天|人|次|个|元|美元)?",
    re.IGNORECASE,
)
ACTION_TERMS = (
    "负责",
    "主导",
    "设计",
    "开发",
    "实现",
    "优化",
    "构建",
    "推动",
    "协调",
    "交付",
    "参与",
    "协助",
    "支持",
    "维护",
    "测试",
    "分析",
    "管理",
)
RESULT_TERMS = (
    "提升",
    "降低",
    "减少",
    "增长",
    "节省",
    "达成",
    "上线",
    "结果",
    "转化率",
    "点击率",
    "完成",
    "交付",
    "发布",
    "落地",
    "解决",
    "稳定",
    "覆盖",
)


def text_hash(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


def _inline_text(runs: list[Any]) -> str:
    values: list[str] = []
    for run in runs:
        inline_type = getattr(run, "inline_type", None)
        if inline_type == "text":
            values.append(run.text)
        elif inline_type == "icon":
            values.append(f":icon[{run.name}]:")
        else:
            values.append(run.alt or "")
    return "".join(values)


def editor_markdown(data: CanonicalResumeDocument) -> str | None:
    """Project canonical nodes into the Agent's marker-based text surface."""

    parts: list[str] = []
    identity_label = data.identity.name.value if data.identity.name is not None else "基本信息"
    parts.append(f"# [[linkresume-block:{data.identity.node_id}:identity]]{identity_label}")
    if data.identity.headline is not None:
        parts.append(
            f"[[linkresume-block:{data.identity.headline.node_id}]]{data.identity.headline.value}"
        )
    for contact in data.identity.contacts:
        parts.append(f"[[linkresume-block:{contact.node_id}]]{contact.value}")
    for section in data.sections:
        title = section.title.value if section.title is not None else section.semantic_kind
        if section.title_icon is not None:
            marker = f":icon[{section.title_icon.name}]:"
            title = f"{marker} {title}" if title else marker
        parts.append(
            f"## [[linkresume-block:{section.node_id}:{section.semantic_kind}]]{title}"
        )
        for entry in section.entries:
            primary_field = next(
                (
                    (field_key, getattr(entry.fields, field_key))
                    for field_key in ("name", "organization", "role", "degree")
                    if getattr(entry.fields, field_key) is not None
                ),
                None,
            )
            entry_label = primary_field[1].value if primary_field is not None else "经历"
            parts.append(f"### [[linkresume-block:{entry.node_id}]]{entry_label}")
            for field_key in ENTRY_FIELD_KEYS:
                if primary_field is not None and field_key == primary_field[0]:
                    continue
                value = getattr(entry.fields, field_key)
                if value is None:
                    continue
                parts.append(
                    f"[[linkresume-block:{value.node_id}:entry-field:{field_key}]]"
                    f"{ENTRY_FIELD_LABELS[field_key]}：{value.value}"
                )
            parts.extend(_canonical_blocks_markdown(entry.blocks))
        parts.extend(_canonical_blocks_markdown(section.blocks))
    return "\n\n".join(part for part in parts if part).strip() or None


def _canonical_blocks_markdown(blocks: list[Any]) -> list[str]:
    parts: list[str] = []
    for block in blocks:
        if block.block_type == "paragraph":
            parts.append(f"[[linkresume-block:{block.node_id}]]{_inline_text(block.runs)}")
        elif block.block_type in {"ordered_list", "bullet_list"}:
            for index, item in enumerate(block.items):
                prefix = f"{(block.start or 1) + index}. " if block.block_type == "ordered_list" else "- "
                parts.append(f"{prefix}[[linkresume-block:{item.node_id}]]{_inline_text(item.runs)}")
        elif block.block_type == "media":
            parts.append(f"[[linkresume-block:{block.node_id}]]{block.alt or block.src}")
        elif block.block_type == "row":
            for cell in block.cells:
                for paragraph in cell.blocks:
                    parts.append(
                        f"[[linkresume-block:{paragraph.node_id}]]{_inline_text(paragraph.runs)}"
                    )
    return parts


def resolve_target(resume: Resume, data: Any, *, selection_context: Any | None,
                   quoted_text: str | None, scope_hint: str = "target", node_id: str | None = None,
                   start_node_id: str | None = None, end_node_id: str | None = None) -> dict[str, Any]:
    from drawoffer.modules.agent.canonical_targets import resolve
    return resolve(resume, data, selection_context=selection_context, quoted_text=quoted_text,
                   scope_hint=scope_hint, node_id=node_id, start_node_id=start_node_id, end_node_id=end_node_id)


def target_content(resume: Resume, data: Any, target: Any, scope: str) -> str:
    from drawoffer.modules.agent.canonical_targets import content
    return content(resume, data, target, scope)


def scoped_blocks(resume: Resume, data: Any, target: Any, scope: str) -> list[dict[str, Any]]:
    from drawoffer.modules.agent.canonical_targets import scoped_blocks as read_blocks
    return read_blocks(resume, data, target, scope)


def search_materials(
    db: Session,
    *,
    user_id: int,
    query: str,
    types: list[str],
    limit: int,
    storage: Any,
    max_bytes: int,
    allowed_refs: set[tuple[str, str]] | None = None,
    rag: Any | None = None,
) -> list[dict[str, str]]:
    needle = query.casefold()
    sources: list[dict[str, str]] = []

    def allowed_ids(source_type: str) -> list[int] | None:
        if allowed_refs is None:
            return None
        return [int(resource_id) for kind, resource_id in allowed_refs
                if kind == source_type]

    def add(
        source_id: str, source_type: str, title: str, content: str, version: str
    ) -> None:
        resource_id = source_id.split(":", 2)[1]
        if (allowed_refs is not None and (source_type, resource_id) not in allowed_refs
                or len(sources) >= limit or needle not in content.casefold()):
            return
        position = content.casefold().find(needle)
        start = max(0, position - 160)
        sources.append(
            {
                "source_id": source_id,
                "source_type": source_type,
                "title": title,
                "excerpt": content[start : start + 500],
                "version": version,
            }
        )

    if "resume" in types:
        resume_ids = allowed_ids("resume")
        statement = select(Resume).where(Resume.user_id == user_id)
        if resume_ids is not None:
            statement = statement.where(Resume.id.in_(resume_ids))
        for resume in db.scalars(
            statement.order_by(Resume.update_time.desc()).limit(20)
        ):
            content = json.dumps(resume.data_json, ensure_ascii=False)
            add(
                f"resume:{resume.id}:{resume.lock_version}",
                "resume",
                resume.title,
                content,
                str(resume.lock_version),
            )
    if "job" in types and len(sources) < limit:
        job_ids = allowed_ids("job")
        statement = select(JobDescription).where(JobDescription.user_id == user_id)
        if job_ids is not None:
            statement = statement.where(JobDescription.id.in_(job_ids))
        for job in db.scalars(
            statement.order_by(JobDescription.update_time.desc()).limit(20)
        ):
            content = "\n".join(
                [
                    job.job_title,
                    job.company_name,
                    job.description,
                    " ".join(job.skills or []),
                ]
            )
            add(
                f"job:{job.id}:{job.lock_version}",
                "job",
                f"{job.company_name} · {job.job_title}",
                content,
                str(job.lock_version),
            )
    if "dataset" in types and len(sources) < limit:
        dataset_ids = allowed_ids("dataset")
        statement = (
            select(UserDataset, DocumentParseTask)
            .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
            .where(
                UserDataset.user_id == user_id,
                DocumentParseTask.user_id == user_id,
                DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                DocumentParseTask.parse_status == "succeeded",
            )
        )
        if dataset_ids is not None:
            statement = statement.where(UserDataset.id.in_(dataset_ids))
        covered: set[int] = set()
        if rag is not None and (dataset_ids is None or dataset_ids):
            try:
                snippets, covered = recall_dataset_snippets(
                    db,
                    rag,
                    user_id=user_id,
                    query=query,
                    dataset_ids=dataset_ids,
                    limit=limit - len(sources),
                )
            except LinkRagError:
                # RAG is an enhancement: any failure falls back to matching.
                snippets, covered = [], set()
            for snippet in snippets:
                if len(sources) >= limit:
                    break
                sources.append(
                    {
                        "source_id": f"dataset:{snippet.dataset_id}:{snippet.version}",
                        "source_type": "dataset",
                        "title": snippet.title,
                        "excerpt": snippet.text[:500],
                        "version": snippet.version,
                    }
                )
        if covered:
            statement = statement.where(UserDataset.id.not_in(covered))
        rows = db.execute(statement.order_by(UserDataset.create_time.desc()).limit(20)).all()
        for dataset, task in rows:
            if len(sources) >= limit or not (dataset.content_object_name or task.converted_object_name):
                continue
            if not (dataset.content_object_name or task.converted_object_name).startswith(
                f"users/{user_id}/datasets/converted/"
            ):
                continue
            try:
                content = read_dataset_markdown(
                    storage, content_key(dataset, task), max_bytes
                )
            except Exception:
                continue
            add(
                f"dataset:{dataset.id}:{source_version(dataset)}",
                "dataset",
                dataset.file_name,
                content,
                source_version(dataset),
            )
    return sources


def resolve_job(
    db: Session, *, user_id: int, job_id: str | None
) -> JobDescription | None:
    if job_id is None:
        return None
    if not job_id.isascii() or not job_id.isdecimal():
        raise ApiError(404, "JOB_NOT_FOUND")
    job = db.scalar(
        select(JobDescription).where(
            JobDescription.id == int(job_id), JobDescription.user_id == user_id
        )
    )
    if job is None:
        raise ApiError(404, "JOB_NOT_FOUND")
    return job


def diagnose_content(
    content: str, target: dict[str, Any], job: JobDescription | None
) -> dict[str, Any]:
    metrics = [
        match.group(0).strip()
        for match in NUMBER_PATTERN.finditer(content)
        if match.group(0).strip()
    ]
    action_present = any(term in content for term in ACTION_TERMS)
    result_present = any(term in content for term in RESULT_TERMS) or bool(metrics)
    job_keywords = (
        [str(item).strip() for item in (job.skills or []) if str(item).strip()]
        if job
        else []
    )
    missing_keywords = [
        keyword
        for keyword in job_keywords
        if keyword.casefold() not in content.casefold()
    ]
    ats_issues = []
    if "|" in content:
        ats_issues.append("包含可能被 ATS 误判的表格分隔符")
    if len(content) > 1_500:
        ats_issues.append("目标内容过长")
    issues: list[dict[str, str]] = []
    if not result_present:
        issues.append(
            {
                "code": "MISSING_RESULT_EVIDENCE",
                "severity": "medium",
                "evidence": "目标内容没有可识别的结果、交付物或影响证据",
                "question": "可以补充真实的交付物、质量变化、影响范围或业务结果吗？",
            }
        )
    if not action_present:
        issues.append(
            {
                "code": "MISSING_ACTION",
                "severity": "medium",
                "evidence": "目标内容没有清晰行动描述",
                "question": "你具体采取了什么行动或使用了什么方法？",
            }
        )
    job_match: dict[str, Any] = {
        "status": "evaluated" if job else "not_evaluated",
        "matched_keywords": [
            keyword for keyword in job_keywords if keyword not in missing_keywords
        ],
        "missing_keywords": missing_keywords,
    }
    if job is not None and job_keywords:
        job_match["keyword_coverage_score"] = round(
            100 * (len(job_keywords) - len(missing_keywords)) / len(job_keywords)
        )
    return {
        "target": target,
        "scope": "range" if target.get("node_ids") else ("entry"
        if target.get("entry_id") and not target.get("selected_text")
        else "bullet"),
        "job_match": job_match,
        "quantification": {
            "has_result_metric": bool(metrics),
            "evidence": metrics,
            "has_qualitative_result": result_present and not bool(metrics),
            "missing_evidence": [] if result_present else ["结果或交付证据"],
        },
        "star": {
            "situation": "unclear",
            "task": "present" if action_present else "unclear",
            "action": "present" if action_present else "missing",
            "result": "present" if result_present else "missing",
        },
        "ats": {"status": "warning" if ats_issues else "pass", "issues": ats_issues},
        "issues": issues,
    }


def diagnosis_fingerprint(diagnosis: dict[str, Any], secret: str) -> str:
    payload = json.dumps(
        diagnosis, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return "diag:" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def verify_diagnosis_fingerprint(
    diagnosis: dict[str, Any], fingerprint: str, secret: str
) -> None:
    if not hmac.compare_digest(diagnosis_fingerprint(diagnosis, secret), fingerprint):
        raise ApiError(422, "DIAGNOSIS_REQUIRED")


def validate_source_ids(
    db: Session, *, user_id: int, source_ids: list[str]
) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    for source_id in source_ids:
        parts = source_id.split(":", 2)
        if len(parts) != 3 or not parts[1].isascii() or not parts[1].isdecimal():
            raise ApiError(422, "SOURCE_FORBIDDEN")
        source_type, raw_id, version = parts
        if source_type == "resume":
            item = db.scalar(
                select(Resume).where(
                    Resume.id == int(raw_id), Resume.user_id == user_id
                )
            )
            valid = item is not None and str(item.lock_version) == version
            title = item.title if item else ""
        elif source_type == "job":
            item = db.scalar(
                select(JobDescription).where(
                    JobDescription.id == int(raw_id), JobDescription.user_id == user_id
                )
            )
            valid = item is not None and str(item.lock_version) == version
            title = f"{item.company_name} · {item.job_title}" if item else ""
        elif source_type == "dataset":
            item = db.scalar(
                select(UserDataset).where(
                    UserDataset.id == int(raw_id), UserDataset.user_id == user_id
                )
            )
            valid = item is not None and source_version(item) == version
            title = item.file_name if item else ""
        else:
            valid, title = False, ""
        if not valid:
            raise ApiError(422, "SOURCE_FORBIDDEN")
        refs.append(
            {"source_id": source_id, "source_type": source_type, "title": title}
        )
    return refs
