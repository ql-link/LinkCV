"""Download an admin-supplied image address without becoming an internal proxy.

The host must resolve only to public addresses, and the connection is pinned to
the address that was checked so DNS cannot change between validation and use.
HTTPS only, no redirects, no credentials, bounded time and size.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

import httpx

from linkresume.core.errors import ApiError

FETCH_TIMEOUT_SECONDS = 8
MAX_FETCH_BYTES = 2 * 1024 * 1024


def _public_address(host: str) -> str:
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [literal]
    else:
        try:
            infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        except OSError as error:
            raise ApiError(502, "COMPANY_LOGO_FETCH_FAILED") from error
        addresses = [ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos]
    # IPv4-mapped IPv6 must be judged as the IPv4 address it reaches.
    addresses = [address.ipv4_mapped or address if isinstance(address, ipaddress.IPv6Address) else address
        for address in addresses]
    if not addresses or any(not address.is_global for address in addresses):
        raise ApiError(422, "COMPANY_LOGO_URL_REJECTED")
    return str(addresses[0])


def validate_logo_url(url: str):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443)):
        raise ApiError(422, "COMPANY_LOGO_URL_REJECTED")
    return parsed


def fetch_logo(url: str, *, transport: httpx.BaseTransport | None = None) -> bytes:
    parsed = validate_logo_url(url)
    address = _public_address(parsed.hostname)
    # Connect to the validated address while keeping TLS SNI and Host on the name.
    pinned = parsed._replace(netloc=f"[{address}]" if ":" in address else address).geturl()
    extensions = {"sni_hostname": parsed.hostname}
    try:
        with httpx.Client(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=False, transport=transport,
                trust_env=False) as client:
            with client.stream("GET", pinned, headers={"Host": parsed.hostname, "Accept": "image/*"},
                    extensions=extensions) as response:
                if response.status_code != 200:
                    raise ApiError(502, "COMPANY_LOGO_FETCH_FAILED")
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_FETCH_BYTES:
                        raise ApiError(413, "COMPANY_LOGO_TOO_LARGE")
    except httpx.HTTPError as error:
        raise ApiError(502, "COMPANY_LOGO_FETCH_FAILED") from error
    if not data:
        raise ApiError(502, "COMPANY_LOGO_FETCH_FAILED")
    return bytes(data)
