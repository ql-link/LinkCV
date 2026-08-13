"""微信开放平台客户端：临时 code 换 openid、生成小程序码。

面向用户中心微信绑定，只封装最小能力；access_token 在进程内缓存到过期。
"""

from __future__ import annotations

import logging
import time

import httpx

logger = logging.getLogger(__name__)

WECHAT_API_BASE = "https://api.weixin.qq.com"


class WechatApiError(Exception):
    """微信开放平台调用失败，code 为面向调用方的稳定错误标识。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class WechatClient:
    def __init__(
        self,
        *,
        appid: str,
        secret: str,
        qr_page: str,
        timeout_seconds: float = 5.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._appid = appid
        self._secret = secret
        self._qr_page = qr_page
        self._timeout_seconds = timeout_seconds
        self._transport = transport
        self._access_token: str | None = None
        self._access_token_expires_at = 0.0

    def code_to_openid(self, code: str) -> str:
        """用小程序登录临时 code 换取 openid。"""
        try:
            response = self._client().get(
                "/sns/jscode2session",
                params={
                    "appid": self._appid,
                    "secret": self._secret,
                    "js_code": code,
                    "grant_type": "authorization_code",
                },
            )
        except httpx.RequestError as error:
            raise WechatApiError("WECHAT_SERVICE_UNAVAILABLE") from error
        payload = _json_payload(response)
        if payload.get("errcode") not in (None, 0):
            raise WechatApiError("WECHAT_CODE_EXCHANGE_FAILED")
        openid = payload.get("openid")
        if not isinstance(openid, str) or not openid:
            raise WechatApiError("WECHAT_CODE_EXCHANGE_FAILED")
        return openid

    def mini_program_qrcode(self, scene: str) -> bytes:
        """生成小程序码图片二进制（wxa/getwxacodeunlimit）。"""
        token = self._get_access_token()
        try:
            response = self._client().post(
                "/wxa/getwxacodeunlimit",
                params={"access_token": token},
                json={"scene": scene, "page": self._qr_page, "check_path": False},
            )
        except httpx.RequestError as error:
            raise WechatApiError("WECHAT_SERVICE_UNAVAILABLE") from error
        if "application/json" in response.headers.get("content-type", ""):
            payload = _json_payload(response)
            if payload.get("errcode") not in (None, 0):
                raise WechatApiError("WECHAT_QRCODE_FAILED")
        if not response.content:
            raise WechatApiError("WECHAT_QRCODE_FAILED")
        return response.content

    def _get_access_token(self) -> str:
        if self._access_token and time.monotonic() < self._access_token_expires_at:
            return self._access_token
        try:
            response = self._client().get(
                "/cgi-bin/token",
                params={
                    "grant_type": "client_credential",
                    "appid": self._appid,
                    "secret": self._secret,
                },
            )
        except httpx.RequestError as error:
            raise WechatApiError("WECHAT_SERVICE_UNAVAILABLE") from error
        payload = _json_payload(response)
        token = payload.get("access_token")
        expires_in = payload.get("expires_in")
        if (
            not isinstance(token, str)
            or not token
            or not isinstance(expires_in, int)
            or expires_in <= 0
        ):
            raise WechatApiError("WECHAT_QRCODE_FAILED")
        self._access_token = token
        self._access_token_expires_at = time.monotonic() + max(60, expires_in - 60)
        return token

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=WECHAT_API_BASE,
            timeout=self._timeout_seconds,
            transport=self._transport,
        )


def _json_payload(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
    except (ValueError, TypeError) as error:
        raise WechatApiError("WECHAT_SERVICE_UNAVAILABLE") from error
    if not isinstance(payload, dict):
        raise WechatApiError("WECHAT_SERVICE_UNAVAILABLE")
    return payload
