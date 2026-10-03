"""Purpose-bound, short-lived audio links; these are never login credentials."""
from datetime import timedelta
from io import BytesIO
import wave

import jwt

from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError

AUDIENCE = "interview-file-asr"


def audio_url(settings, *, task=None, sha256=None) -> str:
    if not settings.asr_media_base_url:
        raise ApiError(503, "INTERVIEW_TRANSCRIPTION_MEDIA_UNAVAILABLE")
    now = utc_now()
    claims = {"aud": AUDIENCE, "purpose": "probe", "iat": now, "exp": now + timedelta(minutes=2)}
    if task is not None:
        claims.update(purpose="recording", sha256=sha256, task_id=task.id, user_id=task.user_id, dataset_id=task.dataset_id,
                      exp=task.created_at + timedelta(hours=24))
    token = jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return f"{settings.asr_media_base_url}/api/interview-asr/audio?token={token}"


def decode_audio_token(settings, token: str) -> dict:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], audience=AUDIENCE,
                            options={"require": ["aud", "purpose", "exp", "iat"]})
        if claims["purpose"] not in ("probe", "recording"):
            raise ValueError
        return claims
    except (jwt.PyJWTError, ValueError) as error:
        raise ApiError(404, "NOT_FOUND") from error


def probe_wav() -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(bytes(32000))
    return output.getvalue()
