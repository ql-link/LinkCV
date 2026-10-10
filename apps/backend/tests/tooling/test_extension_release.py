import importlib.util
import json
import zipfile
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location(
    "extension_release", REPO_ROOT / "scripts/release/build_extension_release.py"
)
assert spec and spec.loader
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def package(tmp_path: Path, *, extra_host: str | None = None, include_tabs: bool = True) -> Path:
    permissions = ["activeTab", "scripting", "storage", "sidePanel"]
    if include_tabs:
        permissions.append("tabs")
    hosts = sorted(release.BOSS_PERMISSIONS | {"https://linkresume.example.test/*"})
    if extra_host:
        hosts.append(extra_host)
    manifest = {
        "manifest_version": 3,
        "version": "0.2.0",
        "name": "LinkResume 求职助手",
        "permissions": permissions,
        "optional_host_permissions": ["http://*/*", "https://*/*"],
        "host_permissions": hosts,
        "action": {},
        "side_panel": {"default_path": "sidepanel.html"},
    }
    path = tmp_path / "extension.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
    return path


def validate(path: Path) -> None:
    release.validate_zip(
        path, version="0.2.0", origin="https://linkresume.example.test", environment="production"
    )


def test_release_accepts_tab_metadata_permission(tmp_path: Path) -> None:
    validate(package(tmp_path))


def test_release_rejects_missing_tab_metadata_permission(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="extension permissions"):
        validate(package(tmp_path, include_tabs=False))


def test_release_still_rejects_unrequested_all_site_access(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="host_permissions"):
        validate(package(tmp_path, extra_host="https://*/*"))
