"""Server-generated company logo locations; callers still enforce job ownership."""

import re


def company_logo_url(job_id: int, digest: str | None) -> str | None:
    if not digest or not re.fullmatch(r"[0-9a-f]{64}", digest):
        return None
    return f"/api/job-descriptions/{job_id}/logo?v={digest}"


def is_job_logo_url(value: str, job_id: int | None) -> bool:
    if job_id is None:
        return False
    return re.fullmatch(
        rf"/api/job-descriptions/{job_id}/logo\?v=[0-9a-f]{{64}}", value
    ) is not None
