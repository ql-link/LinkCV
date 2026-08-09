from __future__ import annotations

import hashlib
import json
import re
import stat
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_FILES = 512
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 50 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
GUIDE_NAME = "安装与使用说明.html"
VERSION_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
BOSS_PERMISSIONS = {
    "https://zhipin.com/*",
    "https://www.zhipin.com/*",
    "https://m.zhipin.com/*",
}


class PluginPackageValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedPluginPackage:
    data: bytes
    version: str
    version_tuple: tuple[int, int, int]
    size: int
    sha256: str


def parse_version(value: str) -> tuple[int, int, int]:
    match = VERSION_PATTERN.fullmatch(value)
    if match is None:
        raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_VERSION")
    parts = tuple(int(part) for part in match.groups())
    if any(part > 65535 for part in parts):
        raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_VERSION")
    return parts


def validate_plugin_package(data: bytes, expected_origin: str) -> ValidatedPluginPackage:
    if not data:
        raise PluginPackageValidationError("PLUGIN_RELEASE_EMPTY")
    if len(data) > MAX_UPLOAD_BYTES:
        raise PluginPackageValidationError("PLUGIN_RELEASE_TOO_LARGE")

    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            infos = archive.infolist()
            if not infos or len(infos) > MAX_FILES:
                raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_ARCHIVE")
            names: set[str] = set()
            normalized_names: set[str] = set()
            total = 0
            for info in infos:
                pure = PurePosixPath(info.filename)
                if pure.is_absolute() or ".." in pure.parts or "\\" in info.filename:
                    raise PluginPackageValidationError("PLUGIN_RELEASE_UNSAFE_ARCHIVE")
                normalized_name = info.filename.casefold()
                if info.filename in names or normalized_name in normalized_names:
                    raise PluginPackageValidationError("PLUGIN_RELEASE_UNSAFE_ARCHIVE")
                names.add(info.filename)
                normalized_names.add(normalized_name)
                if info.flag_bits & 0x1:
                    raise PluginPackageValidationError("PLUGIN_RELEASE_UNSAFE_ARCHIVE")
                mode = (info.external_attr >> 16) & 0o170000
                if mode == stat.S_IFLNK:
                    raise PluginPackageValidationError("PLUGIN_RELEASE_UNSAFE_ARCHIVE")
                if info.file_size > MAX_FILE_BYTES:
                    raise PluginPackageValidationError("PLUGIN_RELEASE_TOO_LARGE")
                total += info.file_size
            if total > MAX_TOTAL_BYTES:
                raise PluginPackageValidationError("PLUGIN_RELEASE_TOO_LARGE")
            if "manifest.json" not in names or GUIDE_NAME not in names:
                raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_CONTENTS")
            manifest_info = archive.getinfo("manifest.json")
            if manifest_info.file_size > MAX_MANIFEST_BYTES:
                raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_MANIFEST")
            manifest = json.loads(archive.read(manifest_info))
    except PluginPackageValidationError:
        raise
    except (zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_ARCHIVE") from error

    if not isinstance(manifest, dict) or manifest.get("manifest_version") != 3:
        raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_MANIFEST")
    version = manifest.get("version")
    if not isinstance(version, str):
        raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_VERSION")
    version_tuple = parse_version(version)
    permissions = manifest.get("host_permissions")
    if not isinstance(permissions, list) or not all(isinstance(item, str) for item in permissions):
        raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_PERMISSIONS")
    expected_permissions = BOSS_PERMISSIONS | {f"{expected_origin}/*"}
    if set(permissions) != expected_permissions or len(permissions) != len(expected_permissions):
        raise PluginPackageValidationError("PLUGIN_RELEASE_INVALID_PERMISSIONS")

    return ValidatedPluginPackage(
        data=data,
        version=version,
        version_tuple=version_tuple,
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
