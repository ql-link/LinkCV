import json

import pytest

from linkcv.core.errors import ApiError
from linkcv.modules.plugin_releases.service import PluginReleaseService
from tests.plugin_release_fakes import FakePluginStorage, build_plugin_zip

ORIGIN = "http://127.0.0.1:5173"


def build_service() -> tuple[PluginReleaseService, FakePluginStorage]:
    storage = FakePluginStorage()
    return (
        PluginReleaseService(
            storage,
            environment="development",
            expected_origin=ORIGIN,
        ),
        storage,
    )


def test_publish_writes_immutable_package_before_pointer_and_reads_current() -> None:
    service, storage = build_service()

    pointer = service.publish(build_plugin_zip(version="0.1.0", origin=ORIGIN))

    assert storage.put_order == [pointer.object_key, service.pointer_key]
    assert storage.metadata[pointer.object_key]["sha256"] == pointer.sha256
    assert storage.metadata[service.pointer_key]["cache-control"] == "private, no-store"
    assert service.current() == pointer


def test_same_version_same_digest_is_idempotent_but_different_content_conflicts() -> None:
    service, storage = build_service()
    package = build_plugin_zip(version="0.1.0", origin=ORIGIN)
    first = service.publish(package)

    assert service.publish(package) == first
    with pytest.raises(ApiError) as error:
        service.publish(
            build_plugin_zip(
                version="0.1.0",
                origin=ORIGIN,
                extra={"different.js": b"different"},
            )
        )
    assert (error.value.status_code, error.value.code) == (
        409,
        "PLUGIN_RELEASE_VERSION_CONFLICT",
    )
    assert json.loads(storage.objects[service.pointer_key])["sha256"] == first.sha256


def test_pointer_failure_keeps_previous_release_and_allows_same_digest_retry() -> None:
    service, storage = build_service()
    first = service.publish(build_plugin_zip(version="0.1.0", origin=ORIGIN))
    second_package = build_plugin_zip(version="0.1.1", origin=ORIGIN)
    storage.fail_put_key = service.pointer_key

    with pytest.raises(ApiError, match="PLUGIN_RELEASE_PUBLISH_FAILED"):
        service.publish(second_package)
    assert service.current() == first

    storage.fail_put_key = None
    second = service.publish(second_package)
    assert second.version == "0.1.1"
    assert service.current() == second


def test_downgrade_and_stale_download_are_rejected() -> None:
    service, _storage = build_service()
    service.publish(build_plugin_zip(version="1.2.0", origin=ORIGIN))

    with pytest.raises(ApiError) as downgrade:
        service.publish(build_plugin_zip(version="1.1.9", origin=ORIGIN))
    assert downgrade.value.code == "PLUGIN_RELEASE_VERSION_CONFLICT"

    with pytest.raises(ApiError) as stale:
        service.open_download("1.1.9")
    assert (stale.value.status_code, stale.value.code) == (
        409,
        "PLUGIN_RELEASE_VERSION_CHANGED",
    )


def test_invalid_pointer_and_missing_object_close_download() -> None:
    service, storage = build_service()
    pointer = service.publish(build_plugin_zip(origin=ORIGIN))
    storage.objects.pop(pointer.object_key)

    with pytest.raises(ApiError) as missing:
        service.current()
    assert missing.value.code == "PLUGIN_RELEASE_OBJECT_UNAVAILABLE"

    storage.objects[service.pointer_key] = b"{}"
    with pytest.raises(ApiError) as invalid:
        service.current()
    assert invalid.value.code == "PLUGIN_RELEASE_INVALID_POINTER"
