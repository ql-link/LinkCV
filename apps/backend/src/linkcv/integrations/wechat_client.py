"""微信小程序扫码登录上游封装。

只封装微信三个上游调用（cgi-bin/token、getwxacodeunlimit、code2Session），
access_token 经 Redis 缓存到 expires_in 结束前，避免每次扫码都换取令牌。
凭据、session_key 与完整上游响应不写日志；网络与上游失败统一转为
WeChatUpstreamError，由上层路由决定面向用户的错误码。
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import httpx
import redis

logger = logging.getLogger(__name__)

WECHAT_TOKEN_CACHE_KEY = "wechat:access_token"
# 微信 access_token 有效期通常为 7200 秒；提前 300 秒刷新，避免边界过期。
ACCESS_TOKEN_SAFETY_MARGIN_SECONDS = 300
DEFAULT_TIMEOUT_SECONDS = 5.0


class WeChatUpstreamError(Exception):
    """微信上游调用失败；status_code 为面向客户端的稳定错误码。"""

    def __init__(self, status_code: int, code: str, errcode: int | None = None) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.errcode = errcode


@dataclass(frozen=True)
class WeChatSession:
    openid: str
    # session_key 敏感且只用于解密敏感数据，本任务不持久化，仅保留字段便于上层判断。
    session_key: str | None = None


class WeChatClient:
    def __init__(
        self,
        *,
        appid: str,
        appsecret: str,
        login_page: str,
        redis_client: "redis.Redis",
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        api_base: str = "https://api.weixin.qq.com",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._appid = appid
        self._appsecret = appsecret
        self._login_page = login_page
        self._redis = redis_client
        self._timeout_seconds = timeout_seconds
        self._api_base = api_base.rstrip("/")
        self._transport = transport

    async def get_access_token(self) -> str:
        cached = self._redis.get(WECHAT_TOKEN_CACHE_KEY)
        if cached:
            return cached
        token, expires_in = await self._fetch_access_token()
        ttl = max(1, int(expires_in) - ACCESS_TOKEN_SAFETY_MARGIN_SECONDS)
        self._redis.set(WECHAT_TOKEN_CACHE_KEY, token, ex=ttl)
        logger.info("WeChat access_token refreshed (expires_in=%s)", expires_in)
        return token

    async def create_wxacode(self, *, scene: str) -> bytes:
        """生成携带 scene 的小程序码，成功返回图片二进制内容。"""
        access_token = await self.get_access_token()
        payload = {
            "scene": scene,
            "page": self._login_page,
            "check_path": False,
        }
        try:
            async with self._client() as client:
                response = await client.post(
                    f"{self._api_base}/wxa/getwxacodeunlimit",
                    params={"access_token": access_token},
                    json=payload,
                )
        except httpx.TimeoutException as error:
            raise WeChatUpstreamError(504, "WECHAT_TIMEOUT") from error
        except httpx.RequestError as error:
            raise WeChatUpstreamError(503, "WECHAT_UNAVAILABLE") from error

        content_type = response.headers.get("content-type", "")
        if response.status_code == 200 and "image" in content_type:
            return response.content
        upstream_code = self._parse_errcode(response)
        logger.warning(
            "getwxacodeunlimit failed status=%s errcode=%s",
            response.status_code,
            upstream_code,
        )
        if upstream_code == 45009:
            raise WeChatUpstreamError(429, "WECHAT_RATE_LIMITED", upstream_code)
        raise WeChatUpstreamError(502, "WECHAT_QRCODE_FAILED", upstream_code)

    async def code2_session(self, *, code: str) -> WeChatSession:
        try:
            async with self._client() as client:
                response = await client.get(
                    f"{self._api_base}/sns/jscode2session",
                    params={
                        "appid": self._appid,
                        "secret": self._appsecret,
                        "js_code": code,
                        "grant_type": "authorization_code",
                    },
                )
        except httpx.TimeoutException as error:
            raise WeChatUpstreamError(504, "WECHAT_TIMEOUT") from error
        except httpx.RequestError as error:
            raise WeChatUpstreamError(503, "WECHAT_UNAVAILABLE") from error

        try:
            payload = response.json()
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise WeChatUpstreamError(502, "WECHAT_SESSION_FAILED") from error

        errcode = payload.get("errcode")
        if errcode:
            logger.warning("code2Session failed errcode=%s", errcode)
            # 40029 表示 code 无效或已使用（一次一用）。
            if errcode == 40029:
                raise WeChatUpstreamError(401, "WECHAT_CODE_INVALID", errcode)
            raise WeChatUpstreamError(502, "WECHAT_SESSION_FAILED", errcode)
        openid = payload.get("openid")
        if not isinstance(openid, str) or not openid:
            raise WeChatUpstreamError(502, "WECHAT_SESSION_FAILED")
        return WeChatSession(openid=openid, session_key=payload.get("session_key"))

    async def _fetch_access_token(self) -> tuple[str, int]:
        try:
            async with self._client() as client:
                response = await client.get(
                    f"{self._api_base}/cgi-bin/token",
                    params={
                        "grant_type": "client_credential",
                        "appid": self._appid,
                        "secret": self._appsecret,
                    },
                )
        except httpx.TimeoutException as error:
            raise WeChatUpstreamError(504, "WECHAT_TIMEOUT") from error
        except httpx.RequestError as error:
            raise WeChatUpstreamError(503, "WECHAT_UNAVAILABLE") from error

        try:
            payload = response.json()
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise WeChatUpstreamError(502, "WECHAT_TOKEN_FAILED") from error

        errcode = payload.get("errcode")
        if errcode:
            logger.warning("cgi-bin/token failed errcode=%s", errcode)
            raise WeChatUpstreamError(502, "WECHAT_TOKEN_FAILED", errcode)
        token = payload.get("access_token")
        expires_in = payload.get("expires_in")
        if not isinstance(token, str) or not token:
            raise WeChatUpstreamError(502, "WECHAT_TOKEN_FAILED")
        return token, int(expires_in) if isinstance(expires_in, int) else 7200

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=self._timeout_seconds,
            transport=self._transport,
        )

    @staticmethod
    def _parse_errcode(response: httpx.Response) -> int | None:
        try:
            payload = response.json()
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        errcode = payload.get("errcode")
        return errcode if isinstance(errcode, int) else None
