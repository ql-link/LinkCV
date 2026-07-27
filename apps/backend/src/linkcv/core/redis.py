from collections.abc import Generator

import redis
from fastapi import Request

from linkcv.core.config import Settings


def build_redis_client(settings: Settings) -> redis.Redis:
    # decode_responses=True lets hash/string values come back as plain text.
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def get_redis(request: Request) -> Generator[redis.Redis, None, None]:
    # A shared long-lived client lives on app.state; do not close it per request.
    yield request.app.state.redis
