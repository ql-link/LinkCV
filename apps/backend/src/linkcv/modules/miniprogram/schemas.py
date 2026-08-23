from pydantic import BaseModel, ConfigDict

from linkcv.modules.resumes.schemas import ResumeRecord, ResumeSummary


class MiniprogramResumeSummary(ResumeSummary):
    model_config = ConfigDict(extra="forbid")

    pdf_version_id: str
    pdf_version_no: int


class MiniprogramResumeRecord(ResumeRecord):
    model_config = ConfigDict(extra="forbid")

    pdf_version_id: str
    pdf_version_no: int


class MiniprogramResumeListResponse(BaseModel):
    resumes: list[MiniprogramResumeSummary]


class MiniprogramResumeResponse(BaseModel):
    resume: MiniprogramResumeRecord
