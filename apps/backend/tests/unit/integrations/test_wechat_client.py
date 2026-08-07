import asyncio

import httpx
import pytest

from linkcv.integrations.wechat_client import (
    ACCESS_TOKEN_SAFETY_MARGIN_SECONDS,
    WeChatClient,
    WeChatSession,
    WeChatUpstreamError,
)
from tests.fakes import FakeRedis


def build_client(handler, *, redis_client=None):
    return WeChatClient(
        appid="wx-fixture-appid",
        appsecret="fixture-secret",
        login_page="pages/login/index",
        redis_client=redis_client or FakeRedis(),
        transport=httpx.MockTransport(handler),
    )


def run(coro):
    return asyncio.run(coro)


def test_access_token_is_cached_until_expiry() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(
            200, json={"access_token": "token-1", "expires_in": 7200}
        )

    redis_client = FakeRedis()
    client = build_client(handler, redis_client=redis_client)

    assert run(client.get_access_token()) == "token-1"
    assert run(client.get_access_token()) == "token-1"
    assert calls == ["/cgi-bin/token"]
    assert redis_client.get("wechat:access_token") == "token-1"
    assert redis_client.ttls["wechat:access_token"] == (
        7200 - ACCESS_TOKEN_SAFETY_MARGIN_SECONDS
    )


def test_access_token_misses_cache_and_refreshes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"access_token": "token-2", "expires_in": 7200}
        )

    redis_client = FakeRedis()
    client = build_client(handler, redis_client=redis_client)
    run(client.get_access_token())
    redis_client.delete("wechat:access_token")

    assert run(client.get_access_token()) == "token-2"


def test_create_wxacode_sends_scene_and_login_page() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["json"] = request.read()
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token-1", "expires_in": 7200})
        return httpx.Response(
            200,
            headers={"content-type": "image/jpeg"},
            content=b"\xff\xd8\xff\xe0fixture-image",
        )

    client = build_client(handler)
    image = run(client.create_wxacode(scene="scene-123"))

    assert image == b"\xff\xd8\xff\xe0fixture-image"
    assert "access_token=token-1" in captured["url"]
    assert b'"scene":"scene-123"' in captured["json"]
    assert b'"page":"pages/login/index"' in captured["json"]
    assert b'"check_path":false' in captured["json"]


def test_create_wxacode_maps_upstream_errcode() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token-1", "expires_in": 7200})
        return httpx.Response(
            200, json={"errcode": 45009, "errmsg": "reach max api daily quota limit"}
        )

    client = build_client(handler)
    with pytest.raises(WeChatUpstreamError) as excinfo:
        run(client.create_wxacode(scene="scene-123"))
    assert excinfo.value.status_code == 429
    assert excinfo.value.code == "WECHAT_RATE_LIMITED"
    assert excinfo.value.errcode == 45009


def test_code2_session_returns_openid() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200, json={"openid": "openid-fixture", "session_key": "sk-fixture"}
        )

    client = build_client(handler)
    session = run(client.code2_session(code="js-code-1"))

    assert isinstance(session, WeChatSession)
    assert session.openid == "openid-fixture"
    assert session.session_key == "sk-fixture"
    assert "js_code=js-code-1" in captured["url"]
    assert "secret=fixture-secret" in captured["url"]


def test_code2_session_maps_invalid_code() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"errcode": 40029, "errmsg": "invalid code"}
        )

    client = build_client(handler)
    with pytest.raises(WeChatUpstreamError) as excinfo:
        run(client.code2_session(code="js-code-expired"))
    assert excinfo.value.status_code == 401
    assert excinfo.value.code == "WECHAT_CODE_INVALID"


@pytest.mark.parametrize(
    ("path", "errcode", "expected_status", "expected_code"),
    [
        ("/cgi-bin/token", 40013, 502, "WECHAT_TOKEN_FAILED"),
        ("/wxa/getwxacodeunlimit", 40001, 502, "WECHAT_QRCODE_FAILED"),
        ("/sns/jscode2session", 40163, 502, "WECHAT_SESSION_FAILED"),
    ],
)
def test_upstream_errors_are_mapped(
    path: str, errcode: int, expected_status: int, expected_code: str
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token" and path != "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token-1", "expires_in": 7200})
        return httpx.Response(200, json={"errcode": errcode, "errmsg": "upstream"})

    client = build_client(handler)
    with pytest.raises(WeChatUpstreamError) as excinfo:
        if path == "/cgi-bin/token":
            run(client.get_access_token())
        elif path == "/wxa/getwxacodeunlimit":
            run(client.create_wxacode(scene="scene-1"))
        else:
            run(client.code2_session(code="js-code-1"))
    assert excinfo.value.status_code == expected_status
    assert excinfo.value.code == expected_code


def test_network_failure_maps_to_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = build_client(handler)
    with pytest.raises(WeChatUpstreamError) as excinfo:
        run(client.get_access_token())
    assert excinfo.value.status_code == 503
    assert excinfo.value.code == "WECHAT_UNAVAILABLE"
