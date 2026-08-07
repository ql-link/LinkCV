from __future__ import annotations

import json
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from io import BytesIO

BOSS_PERMISSIONS = [
    "https://zhipin.com/*",
    "https://www.zhipin.com/*",
    "https://m.zhipin.com/*",
]


class FakeStorageError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class FakeObjectResponse:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.closed = False

    def read(self, size: int = -1) -> bytes:
        return self.data if size < 0 else self.data[:size]

    def stream(self, size: int) -> Iterator[bytes]:
        for offset in range(0, len(self.data), size):
            yield self.data[offset : offset + size]

    def close(self) -> None:
        self.closed = True

    def release_conn(self) -> None:
        self.closed = True


@dataclass
class FakeStat:
    size: int
    metadata: dict[str, str]


class FakePluginStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.metadata: dict[str, dict[str, str]] = {}
        self.put_order: list[str] = []
        self.fail_put_key: str | None = None

    def ensure_bucket(self) -> None:
        pass

    def put(
        self,
        object_name: str,
        data: bytes,
        _content_type: str,
        *,
        cache_control: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        if object_name == self.fail_put_key:
            raise RuntimeError("storage write failed")
        self.objects[object_name] = data
        self.metadata[object_name] = {
            **(metadata or {}),
            "cache-control": cache_control,
        }
        self.put_order.append(object_name)

    def get(self, object_name: str) -> FakeObjectResponse:
        try:
            return FakeObjectResponse(self.objects[object_name])
        except KeyError as error:
            raise FakeStorageError("NoSuchKey") from error

    def stat(self, object_name: str) -> FakeStat:
        try:
            data = self.objects[object_name]
        except KeyError as error:
            raise FakeStorageError("NoSuchKey") from error
        return FakeStat(size=len(data), metadata=self.metadata.get(object_name, {}))


def build_plugin_zip(
    *,
    version: str = "0.1.0",
    origin: str = "http://127.0.0.1:5173",
    permissions: list[str] | None = None,
    extra: dict[str, bytes] | None = None,
) -> bytes:
    output = BytesIO()
    manifest = {
        "manifest_version": 3,
        "name": "LinkCV 岗位采集",
        "version": version,
        "permissions": ["activeTab"],
        "host_permissions": permissions or [*BOSS_PERMISSIONS, f"{origin}/*"],
    }
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("安装与使用说明.html", "<h1>安装说明</h1>")
        archive.writestr("background.js", "export {};")
        for name, data in (extra or {}).items():
            archive.writestr(name, data)
    return output.getvalue()
