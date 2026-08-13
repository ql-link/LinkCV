import httpx
import pytest

from linkcv.integrations.wechat_client import WechatApiError, WechatClient


def client(handler):
    return WechatClient(
        appid="test-appid",
        secret="test-secret",
        qr_page="pages/bind/bind",
        timeout_seconds=5,
        transport=httpx.MockTransport(handler),
    )


def test_code_to_openid_returns_openid() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = request.url
        return httpx.Response(200, json={"openid": "openid-123", "session_key": "sk"})

    wechat = client(handler)
    assert wechat.code_to_openid("wx-code") == "openid-123"
    assert captured["url"].path == "/sns/jscode2session"
    assert captured["url"].params["js_code"] == "wx-code"


def test_code_to_openid_rejects_wechat_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 40029, "errmsg": "invalid code"})

    wechat = client(handler)
    with pytest.raises(WechatApiError) as exc:
        wechat.code_to_openid("bad-code")
    assert exc.value.code == "WECHAT_CODE_EXCHANGE_FAILED"


def test_code_to_openid_surfaces_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    wechat = client(handler)
    with pytest.raises(WechatApiError) as exc:
        wechat.code_to_openid("wx-code")
    assert exc.value.code == "WECHAT_SERVICE_UNAVAILABLE"


def test_qrcode_requests_token_once_and_returns_image() -> None:
    token_requests: list[str] = []
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            token_requests.append("token")
            return httpx.Response(200, json={"access_token": "at-1", "expires_in": 7200})
        captured["url"] = request.url
        captured["body"] = request.read()
        return httpx.Response(200, content=b"\x89PNG-qrcode", headers={"content-type": "image/png"})

    wechat = client(handler)
    assert wechat.mini_program_qrcode("scene-1") == b"\x89PNG-qrcode"
    assert wechat.mini_program_qrcode("scene-2") == b"\x89PNG-qrcode"
    assert len(token_requests) == 1
    assert captured["url"].path == "/wxa/getwxacodeunlimit"
    assert captured["url"].params["access_token"] == "at-1"
    assert b'"scene":"scene-2"' in captured["body"]


def test_qrcode_rejects_wechat_json_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "at-1", "expires_in": 7200})
        return httpx.Response(200, json={"errcode": 45009, "errmsg": "reach limit"})

    wechat = client(handler)
    with pytest.raises(WechatApiError) as exc:
        wechat.mini_program_qrcode("scene-1")
    assert exc.value.code == "WECHAT_QRCODE_FAILED"


def test_qrcode_surfaces_token_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errcode": 40013, "errmsg": "invalid appid"})

    wechat = client(handler)
    with pytest.raises(WechatApiError) as exc:
        wechat.mini_program_qrcode("scene-1")
    assert exc.value.code == "WECHAT_QRCODE_FAILED"
