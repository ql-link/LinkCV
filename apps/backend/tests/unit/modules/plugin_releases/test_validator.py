import stat
import zipfile
from io import BytesIO

import pytest

from linkcv.modules.plugin_releases.validator import (
    PluginPackageValidationError,
    validate_plugin_package,
)
from tests.plugin_release_fakes import BOSS_PERMISSIONS, build_plugin_zip

ORIGIN = "http://127.0.0.1:5173"


def test_valid_package_returns_version_size_and_digest() -> None:
    data = build_plugin_zip(origin=ORIGIN)

    package = validate_plugin_package(data, ORIGIN)

    assert package.version == "0.1.0"
    assert package.version_tuple == (0, 1, 0)
    assert package.size == len(data)
    assert len(package.sha256) == 64


@pytest.mark.parametrize(
    "data, code",
    [
        (b"not-a-zip", "PLUGIN_RELEASE_INVALID_ARCHIVE"),
        (
            build_plugin_zip(permissions=[*BOSS_PERMISSIONS, "https://wrong.example/*"]),
            "PLUGIN_RELEASE_INVALID_PERMISSIONS",
        ),
        (build_plugin_zip(version="1.0.0-beta"), "PLUGIN_RELEASE_INVALID_VERSION"),
    ],
)
def test_invalid_packages_are_rejected(data: bytes, code: str) -> None:
    with pytest.raises(PluginPackageValidationError, match=code):
        validate_plugin_package(data, ORIGIN)


def test_path_traversal_is_rejected() -> None:
    data = build_plugin_zip(extra={"../outside.js": b"bad"})

    with pytest.raises(PluginPackageValidationError, match="UNSAFE_ARCHIVE"):
        validate_plugin_package(data, ORIGIN)


def test_case_insensitive_duplicate_path_is_rejected() -> None:
    data = build_plugin_zip(extra={"content.js": b"one", "CONTENT.js": b"two"})

    with pytest.raises(PluginPackageValidationError, match="UNSAFE_ARCHIVE"):
        validate_plugin_package(data, ORIGIN)


def test_symbolic_link_is_rejected() -> None:
    raw = BytesIO(build_plugin_zip())
    output = BytesIO()
    with zipfile.ZipFile(raw) as source, zipfile.ZipFile(output, "w") as target:
        for info in source.infolist():
            target.writestr(info.filename, source.read(info))
        link = zipfile.ZipInfo("linked-file")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        target.writestr(link, "manifest.json")

    with pytest.raises(PluginPackageValidationError, match="UNSAFE_ARCHIVE"):
        validate_plugin_package(output.getvalue(), ORIGIN)
