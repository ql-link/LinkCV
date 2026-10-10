"""Background material for an interview review: job, resume and library recall.

Recall covers every ready library document of the user. LinkRag is used when
configured; on any RAG failure the whole review falls back to local keyword
matching over the most recent documents, so one review never mixes modes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from drawoffer.application.mock_interviews.retrieval import MaterialDocument, MaterialRetriever
from drawoffer.integrations.linkrag_client import LinkRagError
from drawoffer.modules.datasets.models import UserDataset
from drawoffer.modules.interviews.models import InterviewSession, JobApplication
from drawoffer.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask, Resume

logger = logging.getLogger(__name__)

JOB_DESCRIPTION_CHARS = 6000
LOCAL_DOCUMENTS = 10
LOCAL_TOTAL_BYTES = 400_000
SNIPPETS_PER_QUESTION = 3
SNIPPET_CHARS = 600


@dataclass
class ReviewContext:
    job: dict[str, object] | None
    resume_title: str | None
    resume_markdown: str | None
    transcript: str
    transcript_source: str | None
    diarized: bool


@dataclass
class Snippet:
    dataset_id: str
    title: str
    text: str


@dataclass
class Recaller:
    """Per-review recall state; the first RAG failure switches to local matching."""

    session_factory: object
    rag: object | None
    storage: object | None
    user_id: int
    mode: str = "none"
    count: int = 0
    _local: MaterialRetriever | None = None
    _local_loaded: bool = False
    _rag_available: bool = field(default=True)

    def recall(self, query: str) -> list[Snippet]:
        query = query.strip()
        if not query:
            return []
        snippets: list[Snippet] = []
        if self.rag is not None and self._rag_available:
            from drawoffer.services.rag_sync_service import recall_dataset_snippets

            try:
                with self.session_factory() as db:  # type: ignore[operator]
                    found, covered = recall_dataset_snippets(
                        db, self.rag, user_id=self.user_id, query=query, dataset_ids=None,
                        limit=SNIPPETS_PER_QUESTION,
                    )
                if covered:
                    self.mode = "rag"
                    snippets = [
                        Snippet(str(item.dataset_id), item.title, item.text[:SNIPPET_CHARS]) for item in found
                    ]
                    self.count += len(snippets)
                    return snippets
            except LinkRagError:
                self._rag_available = False
                logger.warning("interview review recall fell back to local matching")
        retriever = self._load_local()
        if retriever is None:
            return []
        self.mode = "local"
        snippets = [
            Snippet(item.dataset_id, item.title, item.text[:SNIPPET_CHARS])
            for item in retriever.search(query, limit=SNIPPETS_PER_QUESTION)
        ]
        self.count += len(snippets)
        return snippets

    def _load_local(self) -> MaterialRetriever | None:
        if self._local_loaded:
            return self._local
        self._local_loaded = True
        if self.storage is None:
            return None
        from drawoffer.services.dataset_content_service import content_key, read_markdown, source_version

        documents: list[MaterialDocument] = []
        total = 0
        try:
            with self.session_factory() as db:  # type: ignore[operator]
                rows = db.execute(
                    select(UserDataset, DocumentParseTask)
                    .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
                    .where(
                        UserDataset.user_id == self.user_id,
                        UserDataset.asset_kind == "document",
                        DocumentParseTask.user_id == self.user_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.parse_status == "succeeded",
                    )
                    .order_by(UserDataset.create_time.desc(), UserDataset.id.desc())
                    .limit(LOCAL_DOCUMENTS)
                ).all()
            for dataset, task in rows:
                remaining = LOCAL_TOTAL_BYTES - total
                if remaining <= 0:
                    break
                markdown = read_markdown(self.storage, content_key(dataset, task), LOCAL_TOTAL_BYTES)
                encoded = markdown.encode("utf-8")[:remaining]
                total += len(encoded)
                documents.append(MaterialDocument(
                    dataset_id=str(dataset.id), title=dataset.file_name,
                    version=source_version(dataset), markdown=encoded.decode("utf-8", errors="ignore"),
                ))
        except Exception:
            logger.warning("interview review local material read failed")
            return None
        retriever = MaterialRetriever(documents)
        self._local = None if retriever.empty else retriever
        return self._local


def _clip(value: str | None, limit: int) -> str:
    return (value or "").strip()[:limit]


def job_context(application: JobApplication) -> dict[str, object] | None:
    snapshot = dict(application.job_snapshot or {})
    description = _clip(str(snapshot.get("description") or ""), JOB_DESCRIPTION_CHARS)
    skills = list(snapshot.get("skills") or [])[:50]
    if not description and not skills:
        return None
    return {
        "company_name": application.company_name_snapshot,
        "job_title": application.job_title_snapshot,
        "description": description,
        "skills": skills,
        "experience_requirement": snapshot.get("experience_requirement"),
    }


def build_context(db: Session, user_id: int, session: InterviewSession, application: JobApplication) -> ReviewContext:
    from drawoffer.application.mock_interviews.service import resume_markdown

    resume = (
        db.scalar(select(Resume).where(Resume.id == application.resume_id, Resume.user_id == user_id))
        if application.resume_id is not None
        else None
    )
    markdown = resume_markdown(resume) if resume is not None else None
    transcript = (session.questions_markdown or "").strip()
    return ReviewContext(
        job=job_context(application),
        resume_title=resume.title if resume is not None else None,
        resume_markdown=markdown or None,
        transcript=transcript,
        transcript_source=session.transcript_source,
        diarized=_diarized(transcript),
    )


def _diarized(transcript: str) -> bool:
    """Two or more distinct ``说话人：`` style labels at line starts."""
    import re

    labels = {
        match.group(1)
        for match in re.finditer(r"(?m)^\s*([^\s：:]{1,12})[：:]", transcript)
    }
    return len(labels) >= 2
