#!/usr/bin/env python3
"""Build and verify environment-specific LinkCV Chrome extension packages."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[2]
EXTENSION_ROOT = REPO_ROOT / "apps" / "extension"
BOSS_PERMISSIONS = {
    "https://zhipin.com/*",
    "https://www.zhipin.com/*",
    "https://m.zhipin.com/*",
}
VERSION_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
MAX_FILES = 512
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 50 * 1024 * 1024


def normalize_origin(value: str) -> str:
    parsed = urlsplit(value.strip())
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError(f"invalid LinkCV origin: {value!r}") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"invalid LinkCV origin: {value!r}")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError(f"LinkCV origin must not contain path, credentials, query or fragment: {value!r}")
    authority = parsed.hostname
    if ":" in authority:
        authority = f"[{authority}]"
    if port is not None:
        authority = f"{authority}:{port}"
    return f"{parsed.scheme}://{authority}"


def validate_zip(path: Path, *, version: str, origin: str, environment: str) -> None:
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_FILES:
            raise ValueError("extension ZIP has an invalid file count")
        names: set[str] = set()
        normalized_names: set[str] = set()
        total = 0
        for info in infos:
            pure = PurePosixPath(info.filename)
            if pure.is_absolute() or ".." in pure.parts or "\\" in info.filename:
                raise ValueError(f"unsafe ZIP path: {info.filename!r}")
            normalized_name = info.filename.casefold()
            if info.filename in names or normalized_name in normalized_names:
                raise ValueError(f"duplicate ZIP entry: {info.filename!r}")
            names.add(info.filename)
            normalized_names.add(normalized_name)
            if info.flag_bits & 0x1:
                raise ValueError(f"encrypted ZIP entry: {info.filename!r}")
            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                raise ValueError(f"symbolic link ZIP entry: {info.filename!r}")
            if info.file_size > MAX_FILE_BYTES:
                raise ValueError(f"ZIP entry is too large: {info.filename!r}")
            total += info.file_size
        if total > MAX_TOTAL_BYTES:
            raise ValueError("extension ZIP expands beyond the allowed size")
        if "manifest.json" not in names:
            raise ValueError("extension ZIP must contain manifest.json at its root")
        manifest = json.loads(archive.read("manifest.json"))

    if manifest.get("manifest_version") != 3:
        raise ValueError("extension manifest_version must be 3")
    if manifest.get("version") != version:
        raise ValueError("extension manifest version does not match package.json")
    expected_name = (
        "LinkResume 岗位采集（开发版）"
        if environment == "development"
        else "LinkResume 岗位采集"
    )
    if manifest.get("name") != expected_name:
        raise ValueError("extension name does not match the target environment")
    expected_permissions = BOSS_PERMISSIONS | {f"{origin}/*"}
    if set(manifest.get("host_permissions", [])) != expected_permissions:
        raise ValueError("extension host_permissions do not exactly match the target environment")


def locate_wxt_zip() -> Path:
    output = EXTENSION_ROOT / ".output"
    candidates = sorted(output.glob("*.zip"), key=lambda item: item.stat().st_mtime_ns, reverse=True)
    if not candidates:
        raise FileNotFoundError("wxt zip did not create a ZIP in apps/extension/.output")
    return candidates[0]


def build_environment(environment: str, origin: str, version: str, destination: Path) -> tuple[str, str]:
    env = os.environ.copy()
    env["WXT_RELEASE_BUILD"] = "1"
    env["WXT_PUBLIC_LINKCV_CHANNEL"] = environment
    env["WXT_PUBLIC_LINKCV_ORIGIN"] = origin
    subprocess.run(
        ["npm", "--prefix", str(EXTENSION_ROOT), "run", "zip:release"],
        cwd=REPO_ROOT,
        env=env,
        check=True,
    )
    source = locate_wxt_zip()
    file_name = f"linkresume-job-capture-{environment}-v{version}.zip"
    target = destination / file_name
    shutil.copyfile(source, target)
    validate_zip(target, version=version, origin=origin, environment=environment)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    return file_name, digest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--development-origin", required=True)
    parser.add_argument("--production-origin", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    package = json.loads((EXTENSION_ROOT / "package.json").read_text(encoding="utf-8"))
    version = str(package.get("version", ""))
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError("apps/extension/package.json version must use MAJOR.MINOR.PATCH")
    if any(int(part) > 65535 for part in version.split(".")):
        raise ValueError("extension version parts must not exceed 65535")

    origins = {
        "development": normalize_origin(args.development_origin),
        "production": normalize_origin(args.production_origin),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="linkcv-extension-release-") as temporary:
        staging = Path(temporary)
        built = [
            (*build_environment(environment, origin, version, staging), environment)
            for environment, origin in origins.items()
        ]
        checksum_lines = []
        for file_name, digest, environment in built:
            os.replace(staging / file_name, args.output_dir / file_name)
            checksum_lines.append(f"{digest}  {file_name}")
            print(f"{environment}: {file_name} sha256={digest}", flush=True)
        (args.output_dir / "SHA256SUMS").write_text(
            "\n".join(checksum_lines) + "\n", encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
