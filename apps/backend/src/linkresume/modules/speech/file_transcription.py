"""Single-file DashScope ASR. Never retry a possibly accepted submission."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

PREFIX = "INTERVIEW_TRANSCRIPTION_"
TASK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class FileTranscriptionError(Exception):
    def __init__(self, reason: str, *, transient: bool = False):
        self.code = PREFIX + reason
        self.transient = transient
        super().__init__(self.code)


@dataclass(frozen=True)
class FileTranscriptionTarget:
    api_base: str
    api_key: str = field(repr=False)
    model: str = "fun-asr"
    region: str = "cn-beijing"


class AliyunFileTranscriptionGateway:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        self.transport = transport

    async def _request(self, target, method, path, **kwargs) -> dict:
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=30, follow_redirects=False) as client:
                response = await client.request(method, target.api_base + path, headers={
                    "Authorization": f"Bearer {target.api_key}", "X-DashScope-Async": "enable",
                }, **kwargs)
                if response.status_code in (401, 403):
                    raise FileTranscriptionError("AUTH_REJECTED")
                if response.status_code == 429 or response.status_code >= 500:
                    raise FileTranscriptionError("PROVIDER_UNAVAILABLE", transient=True)
                if not response.is_success:
                    raise FileTranscriptionError("REQUEST_REJECTED")
                if len(response.content) > 1024 * 1024:
                    raise FileTranscriptionError("RESPONSE_INVALID")
                result = response.json()
                if not isinstance(result, dict):
                    raise FileTranscriptionError("RESPONSE_INVALID")
                return result
        except httpx.HTTPError as error:
            raise FileTranscriptionError("PROVIDER_UNAVAILABLE", transient=True) from error
        except ValueError as error:
            raise FileTranscriptionError("RESPONSE_INVALID") from error

    async def submit(self, target: FileTranscriptionTarget, file_url: str) -> str:
        # Even a timeout/5xx may follow acceptance. The caller must not repeat POST.
        result = await self._request(target, "POST", "/services/audio/asr/transcription", json={
            "model": target.model, "input": {"file_urls": [file_url]},
            "parameters": {"channel_id": [0]},
        })
        output = result.get("output") or {}
        task_id = output.get("task_id") if isinstance(output, dict) else None
        if not isinstance(task_id, str) or not TASK_ID.fullmatch(task_id):
            raise FileTranscriptionError("RESPONSE_INVALID")
        return task_id

    async def poll(self, target: FileTranscriptionTarget, task_id: str) -> dict:
        if not TASK_ID.fullmatch(task_id):
            raise FileTranscriptionError("RESPONSE_INVALID")
        result = await self._request(target, "GET", f"/tasks/{task_id}")
        output = result.get("output")
        if not isinstance(output, dict):
            raise FileTranscriptionError("RESPONSE_INVALID")
        status = output.get("task_status")
        if status in ("PENDING", "RUNNING"):
            return {"status": "running"}
        if status != "SUCCEEDED":
            raise FileTranscriptionError("PROVIDER_FAILED")
        items = output.get("results")
        if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
            raise FileTranscriptionError("RESPONSE_INVALID")
        item = items[0]
        if item.get("subtask_status") != "SUCCEEDED":
            raise FileTranscriptionError("PROVIDER_FAILED")
        url = item.get("transcription_url")
        if not isinstance(url, str):
            raise FileTranscriptionError("RESPONSE_INVALID")
        usage = result.get("usage")
        duration = usage.get("duration") if isinstance(usage, dict) else None
        return {"status": "succeeded", "url": url, "duration_seconds": duration}

    async def result(self, target: FileTranscriptionTarget, url: str, *, allow_empty=False) -> dict:
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError as error:
            raise FileTranscriptionError("RESULT_URL_INVALID") from error
        # Only supplier-owned result buckets in the same supported region. No credentials,
        # redirects, arbitrary hosts or custom ports; source URLs never enter this path.
        suffix = {"cn-beijing": ".oss-cn-beijing.aliyuncs.com",
                  "ap-southeast-1": ".oss-ap-southeast-1.aliyuncs.com"}.get(target.region)
        if (not suffix or parts.scheme != "https" or not (parts.hostname or "").endswith(suffix)
                or parts.username or parts.password or parts.fragment or port not in (None, 443)):
            raise FileTranscriptionError("RESULT_URL_INVALID")
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=60, follow_redirects=False) as client:
                async with client.stream("GET", url) as response:
                    if response.status_code == 429 or response.status_code >= 500:
                        raise FileTranscriptionError("PROVIDER_UNAVAILABLE", transient=True)
                    if not response.is_success:
                        raise FileTranscriptionError("RESULT_UNAVAILABLE")
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 16 * 1024 * 1024:
                            raise FileTranscriptionError("RESULT_TOO_LARGE")
            return normalize_result(json.loads(content), allow_empty=allow_empty)
        except httpx.HTTPError as error:
            raise FileTranscriptionError("PROVIDER_UNAVAILABLE", transient=True) from error
        except (ValueError, TypeError) as error:
            raise FileTranscriptionError("RESPONSE_INVALID") from error


def normalize_result(value: dict, *, allow_empty=False) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("transcripts"), list):
        raise FileTranscriptionError("RESPONSE_INVALID")
    transcripts = value["transcripts"]
    if not transcripts and allow_empty:
        return {"schema_version": 1, "text": "", "sentences": [], "duration_ms": 1000}
    if len(transcripts) != 1 or not isinstance(transcripts[0], dict):
        raise FileTranscriptionError("RESPONSE_INVALID")
    transcript = transcripts[0]
    text = transcript.get("text")
    if not isinstance(text, str) or len(text) > 500000:
        raise FileTranscriptionError("RESULT_TOO_LARGE" if isinstance(text, str) else "RESPONSE_INVALID")
    if not text.strip() and not allow_empty:
        raise FileTranscriptionError("NO_SPEECH")
    raw_sentences = transcript.get("sentences", [])
    if not isinstance(raw_sentences, list) or len(raw_sentences) > 20000:
        raise FileTranscriptionError("RESULT_TOO_LARGE")
    sentences = []
    for sentence in raw_sentences:
        if not isinstance(sentence, dict):
            raise FileTranscriptionError("RESPONSE_INVALID")
        start, end, body = sentence.get("begin_time"), sentence.get("end_time"), sentence.get("text")
        if (type(start) is int and type(end) is int and 0 <= start <= end and isinstance(body, str)):
            sentences.append({"text": body, "start_ms": start, "end_ms": end})
    properties = value.get("properties") or {}
    duration = properties.get("original_duration_in_milliseconds") if isinstance(properties, dict) else None
    return {"schema_version": 1, "text": text, "sentences": sentences,
            "duration_ms": duration if type(duration) is int and duration > 0 else None}
