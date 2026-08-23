import json

import pytest

from linkcv.core.errors import ApiError
from linkcv.modules.plugin_releases.service import PluginReleaseService
from tests.plugin_release_fakes import FakePluginStorage, build_plugin_zip

ORIGIN = "http://127.0.0.1:5173"


def build_service() -> tuple[PluginReleaseService, FakePluginStorage]:
    storage = FakePluginStorage()
    return (
        PluginReleaseService(storage),
        storage,
    )


def test_publish_writes_immutable_package_before_pointer_and_reads_current() -> None:
    service, storage = build_service()

    result = service.publish(build_plugin_zip(version="0.1.0", origin=ORIGIN))
    pointer = result.pointer

    assert result.cleanup_pending is False
    assert service.pointer_key == "system/plugin-releases/current.json"
    assert pointer.object_key == (
        "system/plugin-releases/v0.1.0/linkcv-job-capture-v0.1.0.zip"
    )
    assert pointer.schema_version == 3
    assert pointer.status == "published"
    assert storage.put_order == [pointer.object_key, service.pointer_key]
    assert storage.metadata[pointer.object_key]["sha256"] == pointer.sha256
    assert storage.metadata[service.pointer_key]["cache-control"] == "private, no-store"
    assert service.current() == pointer


def test_same_version_same_digest_is_idempotent_but_different_content_conflicts() -> None:
    service, storage = build_service()
    package = build_plugin_zip(version="0.1.0", origin=ORIGIN)
    first = service.publish(package).pointer

    assert service.publish(package).pointer == first
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
    first = service.publish(
        build_plugin_zip(version="0.1.0", origin=ORIGIN)
    ).pointer
    second_package = build_plugin_zip(version="0.1.1", origin=ORIGIN)
    storage.fail_put_key = service.pointer_key

    with pytest.raises(ApiError, match="PLUGIN_RELEASE_PUBLISH_FAILED"):
        service.publish(second_package)
    assert service.current() == first

    storage.fail_put_key = None
    second = service.publish(second_package).pointer
    assert second.version == "0.1.1"
    assert service.current() == second
    assert first.object_key not in storage.objects


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
    pointer = service.publish(build_plugin_zip(origin=ORIGIN)).pointer
    storage.objects.pop(pointer.object_key)

    with pytest.raises(ApiError) as missing:
        service.current()
    assert missing.value.code == "PLUGIN_RELEASE_OBJECT_UNAVAILABLE"

    storage.objects[service.pointer_key] = b"{}"
    with pytest.raises(ApiError) as invalid:
        service.current()
    assert invalid.value.code == "PLUGIN_RELEASE_INVALID_POINTER"


def test_unpublish_keeps_version_floor_and_can_be_reactivated_without_upload() -> None:
    service, storage = build_service()
    package = build_plugin_zip(origin=ORIGIN)
    pointer = service.publish(package).pointer

    unpublished = service.unpublish()
    stored_pointer = json.loads(storage.objects[service.pointer_key])
    assert unpublished.status == "unpublished"
    assert stored_pointer["schema_version"] == 3
    assert stored_pointer["status"] == "unpublished"
    assert pointer.object_key in storage.objects
    assert service.current() is None

    with pytest.raises(ApiError) as downgrade:
        service.publish(build_plugin_zip(version="0.0.9", origin=ORIGIN))
    assert downgrade.value.code == "PLUGIN_RELEASE_VERSION_CONFLICT"

    reactivated = service.reactivate()
    assert reactivated.status == "published"
    assert reactivated.version == pointer.version
    assert service.current() == reactivated


def test_unpublish_failure_keeps_published_pointer() -> None:
    service, storage = build_service()
    pointer = service.publish(build_plugin_zip(origin=ORIGIN)).pointer
    storage.fail_put_key = service.pointer_key

    with pytest.raises(ApiError) as error:
        service.unpublish()
    assert (error.value.status_code, error.value.code) == (
        503,
        "PLUGIN_RELEASE_UNPUBLISH_FAILED",
    )
    storage.fail_put_key = None
    assert service.current() == pointer


def test_schema_v2_pointer_is_read_as_published_for_compatibility() -> None:
    service, storage = build_service()
    pointer = service.publish(build_plugin_zip(origin=ORIGIN)).pointer
    legacy = pointer.model_dump(mode="json")
    legacy["schema_version"] = 2
    legacy.pop("status")
    storage.objects[service.pointer_key] = json.dumps(legacy).encode()

    current = service.current()

    assert current is not None
    assert current.schema_version == 2
    assert current.status == "published"


def test_schema_v3_pointer_requires_explicit_status() -> None:
    service, storage = build_service()
    pointer = service.publish(build_plugin_zip(origin=ORIGIN)).pointer
    invalid = pointer.model_dump(mode="json")
    invalid.pop("status")
    storage.objects[service.pointer_key] = json.dumps(invalid).encode()

    with pytest.raises(ApiError) as error:
        service.current()

    assert error.value.code == "PLUGIN_RELEASE_INVALID_POINTER"


def test_publish_deletes_all_non_current_packages_after_pointer_switch() -> None:
    service, storage = build_service()
    first = service.publish(
        build_plugin_zip(version="0.1.0", origin=ORIGIN)
    ).pointer
    orphan_key = "system/plugin-releases/v0.0.9/linkcv-job-capture-v0.0.9.zip"
    storage.objects[orphan_key] = b"orphan"

    result = service.publish(build_plugin_zip(version="0.2.0", origin=ORIGIN))

    assert result.cleanup_pending is False
    assert service.current() == result.pointer
    assert first.object_key not in storage.objects
    assert orphan_key not in storage.objects
    assert result.pointer.object_key in storage.objects
    assert storage.delete_order == [first.object_key, orphan_key]


@pytest.mark.parametrize("failure", ["list", "delete"])
def test_cleanup_failure_keeps_new_release_and_retries_on_next_upload(
    failure: str,
) -> None:
    service, storage = build_service()
    first = service.publish(
        build_plugin_zip(version="0.1.0", origin=ORIGIN)
    ).pointer
    if failure == "list":
        storage.fail_list = True
    else:
        storage.fail_delete_key = first.object_key

    second_package = build_plugin_zip(version="0.2.0", origin=ORIGIN)
    published = service.publish(second_package)

    assert published.cleanup_pending is True
    assert service.current() == published.pointer
    assert first.object_key in storage.objects

    storage.fail_list = False
    storage.fail_delete_key = None
    retried = service.publish(second_package)

    assert retried.cleanup_pending is False
    assert first.object_key not in storage.objects
    assert service.current() == retried.pointer


def test_admin_current_distinguishes_absent_published_and_unpublished() -> None:
    service, _storage = build_service()

    assert service.admin_current() is None
    published = service.publish(build_plugin_zip(origin=ORIGIN)).pointer
    assert service.admin_current() == published

    unpublished = service.unpublish()
    assert service.admin_current() == unpublished
    assert service.current() is None


def test_admin_current_validates_published_package() -> None:
    service, storage = build_service()
    published = service.publish(build_plugin_zip(origin=ORIGIN)).pointer
    del storage.objects[published.object_key]

    with pytest.raises(ApiError) as error:
        service.admin_current()

    assert (error.value.status_code, error.value.code) == (
        503,
        "PLUGIN_RELEASE_OBJECT_UNAVAILABLE",
    )


def test_reactivate_rejects_absent_and_already_published_release() -> None:
    service, _storage = build_service()

    with pytest.raises(ApiError) as absent:
        service.reactivate()
    assert (absent.value.status_code, absent.value.code) == (
        404,
        "PLUGIN_RELEASE_NOT_FOUND",
    )

    service.publish(build_plugin_zip(origin=ORIGIN))
    with pytest.raises(ApiError) as published:
        service.reactivate()
    assert (published.value.status_code, published.value.code) == (
        409,
        "PLUGIN_RELEASE_ALREADY_PUBLISHED",
    )


def test_delete_current_removes_package_and_pointer() -> None:
    service, storage = build_service()
    pointer = service.publish(build_plugin_zip(origin=ORIGIN)).pointer

    service.delete_current()

    assert pointer.object_key not in storage.objects
    assert service.pointer_key not in storage.objects
    assert service.admin_current() is None


@pytest.mark.parametrize("failed_key", ["package", "pointer"])
def test_delete_failure_closes_download_and_can_be_retried(failed_key: str) -> None:
    service, storage = build_service()
    pointer = service.publish(build_plugin_zip(origin=ORIGIN)).pointer
    storage.fail_delete_key = (
        pointer.object_key if failed_key == "package" else service.pointer_key
    )

    with pytest.raises(ApiError) as error:
        service.delete_current()

    assert (error.value.status_code, error.value.code) == (
        503,
        "PLUGIN_RELEASE_DELETE_FAILED",
    )
    retained = service.admin_current()
    assert retained is not None
    assert retained.status == "unpublished"
    assert service.current() is None

    storage.fail_delete_key = None
    service.delete_current()
    assert service.admin_current() is None
