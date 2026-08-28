import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.errors import ApiError
from linkcv.domain.resume_document import rich_text_to_markdown
from linkcv.modules.datasets.models import UserDataset
from linkcv.modules.datasets.routes import read_dataset_markdown
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask, Resume


BLOCK_MARKER_PATTERN = re.compile(
    r"\[\[linkcv-block:(blk_[a-z0-9]{16,64})(?::(?:basics|profile|work|education|project|skills|activity|interests|certificates|awards|languages|custom))?\]\]"
)
SECTION_HEADING_PATTERN = re.compile(
    r"^##\s+\[\[linkcv-block:(blk_[a-z0-9]{16,64})(?::(?:basics|profile|work|education|project|skills|activity|interests|certificates|awards|languages|custom))?\]\](.*)$",
    re.MULTILINE,
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
)


def text_hash(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class EditorBlock:
    block_id: str
    text: str
    line_prefix: str
    start: int
    end: int
    section_id: str | None
    section_label: str | None
    entry_id: str | None
    entry_label: str | None


def editor_markdown(data: Any) -> str | None:
    for section in data.sections.custom_sections:
        if section.id != "custom_section_editor":
            continue
        for item in section.items:
            if item.id == "custom_item_editor":
                return rich_text_to_markdown(item.content)
    custom = {section.id: section for section in data.sections.custom_sections}
    parts: list[str] = []
    for semantic in data.semantic_sections:
        if semantic.content_key != "custom_sections" or not semantic.custom_section_id:
            continue
        section = custom.get(semantic.custom_section_id)
        if section is None:
            continue
        body = "\n\n".join(
            part
            for item in section.items
            if (part := rich_text_to_markdown(item.content))
        )
        if section.items and all(item.content.format == "tiptap-json" for item in section.items):
            parts.append(body)
        elif semantic.semantic_kind == "basics":
            parts.append(body)
        else:
            parts.append(
                f"## [[linkcv-block:{section.id}:{semantic.semantic_kind}]]{semantic.display_title}"
                + (f"\n\n{body}" if body else "")
            )
    return "\n\n".join(part for part in parts if part).strip() or None


def replace_editor_markdown(data: Any, markdown: str) -> dict[str, Any]:
    payload = data.model_dump(mode="json")
    for section in payload["sections"]["custom_sections"]:
        if section["id"] != "custom_section_editor":
            continue
        for item in section["items"]:
            if item["id"] == "custom_item_editor":
                item["content"]["content"] = markdown
                return payload
    matches = list(SECTION_HEADING_PATTERN.finditer(markdown))
    custom = {
        section["id"]: section for section in payload["sections"]["custom_sections"]
    }
    semantic = {
        section["custom_section_id"]: section
        for section in payload["semantic_sections"]
        if section["content_key"] == "custom_sections"
    }
    basics = next(
        (
            section
            for section in payload["semantic_sections"]
            if section["semantic_kind"] == "basics"
            and section["content_key"] == "custom_sections"
        ),
        None,
    )

    def replace_content(section: dict[str, Any], value: str, *, heading: str | None) -> None:
        if not section["items"]:
            raise ApiError(422, "TARGET_INVALID")
        content = section["items"][0]["content"]
        current = ""
        if content.get("format") == "markdown" and isinstance(content.get("content"), str):
            current = content["content"]
        elif content.get("format") == "tiptap-json" and isinstance(content.get("content"), dict):
            from linkcv.domain.resume_document import RichText

            current = rich_text_to_markdown(RichText.model_validate(content))
            if heading is not None:
                first_break = current.find("\n")
                current_heading = current[:first_break if first_break >= 0 else len(current)]
                expected_prefix = f"## [[linkcv-block:{section['id']}"
                if (
                    not current_heading.startswith(expected_prefix)
                    or not current_heading.endswith(heading)
                ):
                    current = ""
                else:
                    current = current[first_break + 1 :].strip() if first_break >= 0 else ""
        if current == value:
            return
        section["items"][0]["content"] = {"format": "markdown", "content": value}

    if basics and basics["custom_section_id"] in custom:
        intro_end = matches[0].start() if matches else len(markdown)
        replace_content(
            custom[basics["custom_section_id"]],
            markdown[:intro_end].strip(),
            heading=None,
        )
    for index, match in enumerate(matches):
        section_id = match.group(1)
        section = custom.get(section_id)
        section_semantic = semantic.get(section_id)
        if section is None or section_semantic is None or not section["items"]:
            raise ApiError(422, "TARGET_INVALID")
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        section_semantic["display_title"] = match.group(2).strip() or "未命名章节"
        section["title"] = section_semantic["display_title"]
        replace_content(
            section,
            markdown[match.end() : end].strip(),
            heading=section_semantic["display_title"],
        )
    return payload


def parse_editor_blocks(markdown: str) -> list[EditorBlock]:
    matches = list(BLOCK_MARKER_PATTERN.finditer(markdown))
    blocks: list[EditorBlock] = []
    section_id: str | None = None
    section_label: str | None = None
    entry_id: str | None = None
    entry_label: str | None = None
    for index, match in enumerate(matches):
        line_start = markdown.rfind("\n", 0, match.start()) + 1
        next_start = (
            markdown.rfind("\n", 0, matches[index + 1].start()) + 1
            if index + 1 < len(matches)
            else len(markdown)
        )
        prefix = markdown[line_start : match.start()]
        raw = markdown[match.end() : next_start].strip()
        heading = re.fullmatch(r"(#{1,3})\s*", prefix)
        if heading and len(heading.group(1)) == 2:
            section_id, section_label = match.group(1), raw
            entry_id = entry_label = None
        elif heading and len(heading.group(1)) == 3:
            entry_id, entry_label = match.group(1), raw
        blocks.append(
            EditorBlock(
                block_id=match.group(1),
                text=raw,
                line_prefix=prefix,
                start=line_start,
                end=next_start,
                section_id=section_id,
                section_label=section_label,
                entry_id=entry_id,
                entry_label=entry_label,
            )
        )
    return blocks


def _locator(
    resume: Resume, block: EditorBlock, selected_text: str | None
) -> dict[str, Any]:
    target_text = selected_text or block.text
    return {
        "resume_id": str(resume.id),
        "base_lock_version": resume.lock_version,
        "surface": "editor",
        "section": block.section_id,
        "entry_id": block.entry_id,
        "field": "markdown",
        "item_id": None,
        "block_id": block.block_id,
        "selected_text": selected_text,
        "expected_text_hash": text_hash(target_text),
    }


def resolve_target(
    resume: Resume,
    data: Any,
    *,
    selection_context: Any | None,
    quoted_text: str | None,
    scope_hint: str = "target",
) -> dict[str, Any]:
    markdown = editor_markdown(data)
    blocks = parse_editor_blocks(markdown or "")
    quote = (
        selection_context.selected_text
        if selection_context is not None
        else quoted_text
    )
    if selection_context is not None:
        requested = [
            block for block in blocks if block.block_id in selection_context.block_ids
        ]
        if len(requested) != len(selection_context.block_ids):
            return {"status": "not_found", "target": None, "candidates": []}
        exact = [block for block in requested if quote and quote in block.text]
        if len(exact) == 1:
            return {
                "status": "resolved",
                "target": _locator(resume, exact[0], quote),
                "candidates": [],
            }
        if len(exact) > 1:
            return _ambiguous(resume, exact, quote)
        requested_entry_ids = {block.entry_id for block in requested if block.entry_id}
        if len(requested) > 1 and len(requested_entry_ids) == 1:
            entry_id = next(iter(requested_entry_ids))
            anchor = next(
                (
                    block
                    for block in blocks
                    if block.entry_id == entry_id and block.block_id == entry_id
                ),
                requested[0],
            )
            return {
                "status": "resolved",
                "target": _locator(resume, anchor, None),
                "candidates": [],
            }
        if len(requested) > 1:
            return _ambiguous(resume, requested, None)
    if quote:
        matches = [block for block in blocks if quote in block.text]
        if len(matches) == 1:
            return {
                "status": "resolved",
                "target": _locator(resume, matches[0], quote),
                "candidates": [],
            }
        if len(matches) > 1:
            return _ambiguous(resume, matches, quote)
    if scope_hint == "resume" and not quote:
        serialized = json.dumps(
            data.model_dump(mode="json"), ensure_ascii=False, sort_keys=True
        )
        return {
            "status": "resolved",
            "target": {
                "resume_id": str(resume.id),
                "base_lock_version": resume.lock_version,
                "surface": "semantic",
                "section": "resume",
                "entry_id": None,
                "field": "data",
                "item_id": None,
                "block_id": None,
                "selected_text": None,
                "expected_text_hash": text_hash(serialized),
            },
            "candidates": [],
        }
    return {"status": "not_found", "target": None, "candidates": []}


def _ambiguous(
    resume: Resume, blocks: list[EditorBlock], quote: str | None
) -> dict[str, Any]:
    candidates = []
    for block in blocks[:10]:
        label = (
            " / ".join(
                value for value in (block.section_label, block.entry_label) if value
            )
            or "简历正文"
        )
        candidates.append(
            {
                "target": _locator(resume, block, quote),
                "label": label,
                "excerpt": block.text[:240],
            }
        )
    return {"status": "ambiguous", "target": None, "candidates": candidates}


def target_content(resume: Resume, data: Any, target: Any, scope: str) -> str:
    if (
        str(resume.id) != target.resume_id
        or resume.lock_version != target.base_lock_version
    ):
        raise ApiError(409, "TARGET_STALE")
    if target.surface == "semantic" and target.section == "resume":
        serialized = json.dumps(
            data.model_dump(mode="json"), ensure_ascii=False, sort_keys=True
        )
        if scope != "resume" or text_hash(serialized) != target.expected_text_hash:
            raise ApiError(409, "TARGET_STALE")
        return serialized
    markdown = editor_markdown(data)
    if target.surface != "editor" or markdown is None or target.block_id is None:
        raise ApiError(422, "TARGET_INVALID")
    blocks = parse_editor_blocks(markdown)
    block = next((item for item in blocks if item.block_id == target.block_id), None)
    if block is None:
        raise ApiError(409, "TARGET_STALE")
    expected_text = target.selected_text or block.text
    if (
        text_hash(expected_text) != target.expected_text_hash
        or expected_text not in block.text
    ):
        raise ApiError(409, "TARGET_STALE")
    if scope == "target":
        return expected_text
    if scope == "entry":
        if not block.entry_id:
            raise ApiError(422, "SCOPE_FORBIDDEN")
        return "\n\n".join(
            item.text for item in blocks if item.entry_id == block.entry_id
        )
    if scope == "section":
        if not block.section_id:
            raise ApiError(422, "SCOPE_FORBIDDEN")
        return "\n\n".join(
            item.text for item in blocks if item.section_id == block.section_id
        )
    if scope == "resume":
        return BLOCK_MARKER_PATTERN.sub("", markdown)
    raise ApiError(422, "SCOPE_FORBIDDEN")


def scoped_blocks(
    resume: Resume, data: Any, target: Any, scope: str
) -> list[dict[str, Any]]:
    target_content(resume, data, target, scope)
    if target.surface == "semantic":
        return []
    markdown = editor_markdown(data)
    if markdown is None:
        return []
    blocks = parse_editor_blocks(markdown)
    anchor = next((item for item in blocks if item.block_id == target.block_id), None)
    if anchor is None:
        raise ApiError(409, "TARGET_STALE")
    if scope == "target":
        selected = [anchor]
    elif scope == "entry":
        selected = [item for item in blocks if item.entry_id == anchor.entry_id]
    elif scope == "section":
        selected = [item for item in blocks if item.section_id == anchor.section_id]
    else:
        selected = blocks
    return [
        {
            "target": _locator(
                resume,
                item,
                target.selected_text if item.block_id == target.block_id else None,
            ),
            "content": (
                target.selected_text
                if item.block_id == target.block_id and target.selected_text
                else item.text
            ),
        }
        for item in selected
    ]


def search_materials(
    db: Session,
    *,
    user_id: int,
    query: str,
    types: list[str],
    limit: int,
    storage: Any,
    max_bytes: int,
) -> list[dict[str, str]]:
    needle = query.casefold()
    sources: list[dict[str, str]] = []

    def add(
        source_id: str, source_type: str, title: str, content: str, version: str
    ) -> None:
        if len(sources) >= limit or needle not in content.casefold():
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
        for resume in db.scalars(
            select(Resume)
            .where(Resume.user_id == user_id)
            .order_by(Resume.updated_at.desc())
            .limit(20)
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
        for job in db.scalars(
            select(JobDescription)
            .where(JobDescription.user_id == user_id)
            .order_by(JobDescription.updated_at.desc())
            .limit(20)
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
        rows = db.execute(
            select(UserDataset, DocumentParseTask)
            .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
            .where(
                UserDataset.user_id == user_id,
                DocumentParseTask.user_id == user_id,
                DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                DocumentParseTask.parse_status == "succeeded",
            )
            .order_by(UserDataset.created_at.desc())
            .limit(20)
        ).all()
        for dataset, task in rows:
            if len(sources) >= limit or not task.converted_object_name:
                continue
            if not task.converted_object_name.startswith(
                f"users/{user_id}/datasets/converted/"
            ):
                continue
            try:
                content = read_dataset_markdown(
                    storage, task.converted_object_name, max_bytes
                )
            except Exception:
                continue
            add(
                f"dataset:{dataset.id}:{dataset.sha256}",
                "dataset",
                dataset.file_name,
                content,
                dataset.sha256,
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
    if not metrics:
        issues.append(
            {
                "code": "MISSING_RESULT_EVIDENCE",
                "severity": "high",
                "evidence": "目标内容没有可识别的量化结果",
                "question": "可以补充效率、质量、转化率、规模或交付结果吗？",
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
        job_match["match_score"] = round(
            100 * (len(job_keywords) - len(missing_keywords)) / len(job_keywords)
        )
    return {
        "target": target,
        "scope": "entry"
        if target.get("entry_id") and not target.get("selected_text")
        else "bullet",
        "job_match": job_match,
        "quantification": {
            "has_result_metric": bool(metrics),
            "evidence": metrics,
            "missing_evidence": [] if metrics else ["结果指标"],
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
            valid = item is not None and item.sha256 == version
            title = item.file_name if item else ""
        else:
            valid, title = False, ""
        if not valid:
            raise ApiError(422, "SOURCE_FORBIDDEN")
        refs.append(
            {"source_id": source_id, "source_type": source_type, "title": title}
        )
    return refs


def apply_operations(
    markdown: str, *, mode: str, main_target: Any, operations: list[Any]
) -> str:
    if mode == "polish_local" and (
        len(operations) != 1 or operations[0].op != "replace_target_text"
    ):
        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
    if mode == "generate_from_materials" and any(
        item.op != "insert_after_target" for item in operations
    ):
        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
    initial_blocks = parse_editor_blocks(markdown)
    main_block = next(
        (item for item in initial_blocks if item.block_id == main_target.block_id), None
    )
    if main_block is None:
        raise ApiError(409, "TARGET_STALE")
    if (
        main_target.surface != "editor"
        or main_target.section != main_block.section_id
        or main_target.entry_id != main_block.entry_id
        or main_target.field != "markdown"
    ):
        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
    updated = markdown
    for operation in operations:
        if BLOCK_MARKER_PATTERN.search(operation.new_text):
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        if (
            mode in {"polish_local", "rewrite_entry_star"}
            and "\n" in operation.new_text
        ):
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        target = operation.target
        if (
            target.resume_id != main_target.resume_id
            or target.base_lock_version != main_target.base_lock_version
            or target.surface != "editor"
            or target.field != "markdown"
            or operation.expected_text_hash != target.expected_text_hash
        ):
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        if mode in {"polish_local", "generate_from_materials"} and (
            target.block_id != main_target.block_id
        ):
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        blocks = parse_editor_blocks(updated)
        block = next(
            (item for item in blocks if item.block_id == target.block_id), None
        )
        if block is None:
            raise ApiError(409, "TARGET_STALE")
        if (
            target.section != block.section_id
            or target.entry_id != block.entry_id
            or (
                mode == "rewrite_entry_star"
                and (not main_block.entry_id or block.entry_id != main_block.entry_id)
            )
        ):
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        expected = target.selected_text or block.text
        if (
            operation.expected_text_hash != text_hash(expected)
            or expected not in block.text
        ):
            raise ApiError(409, "TARGET_STALE")
        # A whole-block locator deliberately carries no user selection.  Once
        # the block and its expected hash have been verified against the
        # current markdown, persist the exact protected text for the proposal
        # card.  This does not alter diagnosis data or the patch scope; it only
        # makes the server-derived before value observable to clients.
        if not target.selected_text:
            target.selected_text = expected
        if operation.op == "replace_target_text":
            segment = updated[block.start : block.end]
            if segment.count(expected) != 1:
                raise ApiError(409, "TARGET_STALE")
            replacement = segment.replace(expected, operation.new_text, 1)
            updated = updated[: block.start] + replacement + updated[block.end :]
        else:
            generated_id = f"blk_{uuid4().hex}"
            new_text = operation.new_text.strip()
            heading_or_list = re.match(r"^(#{1,3}\s+|-\s+|\d+\.\s+)", new_text)
            annotated = (
                f"{heading_or_list.group(0)}[[linkcv-block:{generated_id}]]{new_text[heading_or_list.end() :]}"
                if heading_or_list
                else f"[[linkcv-block:{generated_id}]]{new_text}"
            )
            updated = updated[: block.end] + f"\n\n{annotated}" + updated[block.end :]
    return updated
