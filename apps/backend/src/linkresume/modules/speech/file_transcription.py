"""DashScope recorded-file transcription (asynchronous submit + poll).

The provider downloads the recording from a short-lived presigned URL, so no
audio passes through this process. It offers no completion callback; callers
poll ``query`` until the task finishes. URLs, transcripts and keys are never
logged.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit

import httpx

from linkresume.modules.speech.gateway import SpeechTarget

REQUEST_TIMEOUT_SECONDS = 15
RESULT_MAX_BYTES = 20 * 1024 * 1024
INTERVIEWER = "面试官"
CANDIDATE = "我"

TaskState = Literal["pending", "running", "succeeded", "failed"]


class TranscriptionProviderError(Exception):
    """Safe failure code; ``retryable`` marks transient network or 5xx errors."""

    def __init__(self, code: str, *, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class TaskStatus:
    state: TaskState
    result_url: str | None = None
    error_code: str | None = None


@dataclass(frozen=True)
class Sentence:
    begin_ms: int
    speaker: int | None
    text: str


@dataclass(frozen=True)
class Transcript:
    markdown: str
    duration_ms: int | None


class FileTranscriber(Protocol):
    def submit(self, target: SpeechTarget, file_url: str) -> str: ...

    def query(self, target: SpeechTarget, task_id: str) -> TaskStatus: ...

    def fetch(self, result_url: str) -> Transcript: ...


def file_model(realtime_model: str, override: str | None = None) -> str:
    """Recorded-file model paired with the configured realtime model."""
    if override and override.strip():
        return override.strip()
    name = realtime_model.strip().lower()
    if name.startswith("fun-asr"):
        return "fun-asr"
    if name.startswith("paraformer"):
        derived = name.replace("-realtime", "")
        return derived if derived != name else "paraformer-v2"
    return "paraformer-v2"


def _http_base(target: SpeechTarget) -> str:
    host = urlsplit(target.ws_url).hostname
    if not host:
        raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    return f"https://{host}"


def _headers(target: SpeechTarget) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {target.api_key}", "Content-Type": "application/json"}
    if target.workspace_id:
        headers["X-DashScope-WorkSpace"] = target.workspace_id
    return headers


def speaker_labels(sentences: list[Sentence]) -> dict[int, str]:
    """Two speakers: whoever speaks first and asks more questions is the interviewer."""
    speakers = sorted({item.speaker for item in sentences if item.speaker is not None})
    if len(speakers) < 2:
        # A single voice carries no useful label.
        return {}
    if len(speakers) > 2:
        return {speaker: f"说话人 {index + 1}" for index, speaker in enumerate(speakers)}
    first = next(item.speaker for item in sentences if item.speaker is not None)
    questions = {speaker: 0 for speaker in speakers}
    for item in sentences:
        if item.speaker is not None and item.text.rstrip().endswith(("?", "？", "吗", "呢")):
            questions[item.speaker] += 1
    other = speakers[1] if first == speakers[0] else speakers[0]
    interviewer = other if questions[other] > questions[first] else first
    return {speaker: INTERVIEWER if speaker == interviewer else CANDIDATE for speaker in speakers}


def render_markdown(sentences: list[Sentence]) -> str:
    """One paragraph per speaker turn as ``说话人：文本``; no speakers → plain paragraphs."""
    labels = speaker_labels(sentences)
    turns: list[tuple[str | None, list[str]]] = []
    for item in sorted(sentences, key=lambda sentence: sentence.begin_ms):
        text = item.text.strip()
        if not text:
            continue
        label = labels.get(item.speaker) if item.speaker is not None else None
        if turns and turns[-1][0] == label:
            turns[-1][1].append(text)
        else:
            turns.append((label, [text]))
    lines = [f"{label}：{''.join(parts)}" if label else "".join(parts) for label, parts in turns]
    return "\n\n".join(lines)


def parse_result(data: Any) -> Transcript:
    if not isinstance(data, dict):
        raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_RESULT_INVALID")
    sentences: list[Sentence] = []
    for transcript in data.get("transcripts") or []:
        for sentence in (transcript or {}).get("sentences") or []:
            try:
                speaker = sentence.get("speaker_id")
                sentences.append(
                    Sentence(
                        begin_ms=int(sentence.get("begin_time") or 0),
                        speaker=int(speaker) if speaker is not None else None,
                        text=str(sentence.get("text") or ""),
                    )
                )
            except (TypeError, ValueError, AttributeError):
                continue
    markdown = render_markdown(sentences)
    if not markdown:
        raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_EMPTY")
    duration = (data.get("properties") or {}).get("original_duration_in_milliseconds")
    try:
        duration_ms = int(duration) if duration is not None else None
    except (TypeError, ValueError):
        duration_ms = None
    return Transcript(markdown=markdown, duration_ms=duration_ms)


class DashScopeFileTranscriber:
    def __init__(self, model_override: str | None = None, *, transport: httpx.BaseTransport | None = None) -> None:
        self._model_override = model_override
        self._client = httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS, transport=transport)

    def close(self) -> None:
        self._client.close()

    def _send(self, method: str, url: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(method, url, **kwargs)
        except httpx.HTTPError as error:
            raise TranscriptionProviderError(
                "INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE", retryable=True
            ) from error
        if response.status_code in {401, 403}:
            raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_AUTH_FAILED")
        if response.status_code == 429 or response.status_code >= 500:
            raise TranscriptionProviderError(
                "INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE", retryable=True
            )
        if response.status_code >= 400:
            raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_REJECTED")
        try:
            return response.json()
        except ValueError as error:
            raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_RESULT_INVALID") from error

    def submit(self, target: SpeechTarget, file_url: str) -> str:
        headers = _headers(target) | {"X-DashScope-Async": "enable"}
        data = self._send(
            "POST",
            f"{_http_base(target)}/api/v1/services/audio/asr/transcription",
            headers=headers,
            json={
                "model": file_model(target.model, self._model_override),
                "input": {"file_urls": [file_url]},
                "parameters": {
                    "diarization_enabled": True,
                    "speaker_count": 2,
                    "language_hints": ["zh", "en"],
                },
            },
        )
        task_id = ((data or {}).get("output") or {}).get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_RESULT_INVALID")
        return task_id

    def query(self, target: SpeechTarget, task_id: str) -> TaskStatus:
        data = self._send("GET", f"{_http_base(target)}/api/v1/tasks/{task_id}", headers=_headers(target))
        output = (data or {}).get("output") or {}
        state = str(output.get("task_status") or "").upper()
        if state in {"PENDING", "RUNNING"}:
            return TaskStatus("pending" if state == "PENDING" else "running")
        if state == "SUCCEEDED":
            results = output.get("results") or []
            first = results[0] if results and isinstance(results[0], dict) else {}
            if str(first.get("subtask_status") or "").upper() != "SUCCEEDED" or not first.get("transcription_url"):
                return TaskStatus("failed", error_code=_subtask_error(first))
            return TaskStatus("succeeded", result_url=str(first["transcription_url"]))
        if state == "FAILED":
            results = output.get("results") or []
            first = results[0] if results and isinstance(results[0], dict) else {}
            return TaskStatus("failed", error_code=_subtask_error(first))
        raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_RESULT_INVALID")

    def fetch(self, result_url: str) -> Transcript:
        try:
            with self._client.stream("GET", result_url) as response:
                if response.status_code >= 400:
                    raise TranscriptionProviderError(
                        "INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE", retryable=True
                    )
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > RESULT_MAX_BYTES:
                        raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_RESULT_INVALID")
        except httpx.HTTPError as error:
            raise TranscriptionProviderError(
                "INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE", retryable=True
            ) from error
        try:
            return parse_result(json.loads(bytes(body)))
        except ValueError as error:
            raise TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_RESULT_INVALID") from error


def _subtask_error(result: dict) -> str:
    code = str(result.get("code") or "").upper()
    if "DURATION" in code or "TOO_LONG" in code:
        return "INTERVIEW_TRANSCRIPTION_AUDIO_TOO_LONG"
    if "FORMAT" in code or "DECODE" in code or "INVALID_FILE" in code:
        return "INTERVIEW_TRANSCRIPTION_FORMAT_UNSUPPORTED"
    if "DOWNLOAD" in code or "URL" in code:
        return "INTERVIEW_TRANSCRIPTION_DOWNLOAD_FAILED"
    if "SUCCESS_WITH_NO_VALID_FRAGMENT" in code or "NO_VALID" in code:
        return "INTERVIEW_TRANSCRIPTION_EMPTY"
    return "INTERVIEW_TRANSCRIPTION_FAILED"
