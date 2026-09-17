from io import BytesIO
import hashlib

import pytest
from fastapi.testclient import TestClient
from minio.error import S3Error
from PIL import Image, PngImagePlugin
from sqlalchemy import select

from linkresume.application.job_descriptions.logo_service import normalize_logo
from linkresume.core.errors import ApiError
from linkresume.core.storage import get_storage
from linkresume.modules.interviews.models import JobApplication
from tests.integration.api.test_job_descriptions import build_app, create_job, register


class StoredResponse(BytesIO):
    def release_conn(self):
        pass


class LogoStorage:
    def __init__(self):
        self.objects = {}
        self.writes = 0
        self.fail = False
        self.deleted = []

    def ensure_bucket(self):
        pass

    def stat(self, name):
        if self.fail:
            raise RuntimeError("storage unavailable")
        if name not in self.objects:
            raise S3Error(response=None, code="NoSuchKey", message="missing", resource=name, request_id="test", host_id="test")
        return object()

    def put(self, name, data, content_type, **kwargs):
        assert content_type == "image/webp"
        self.writes += 1
        self.objects[name] = data

    def get(self, name):
        self.stat(name)
        return StoredResponse(self.objects[name])

    def delete(self, name):
        self.deleted.append(name)
        self.objects.pop(name, None)


def picture(color="red", *, metadata=None):
    image = Image.new("RGB", (400, 200), color)
    output = BytesIO()
    image.save(output, format="PNG", pnginfo=metadata)
    return output.getvalue()


def upload(client, job, data=None, **fields):
    return client.post(f"/api/job-descriptions/{job['id']}/logo",
                       files={"file": ("untrusted.jpg", data if data is not None else picture(), "text/plain")},
                       data=fields)


def test_normalization_removes_metadata_and_deduplicates_final_bytes():
    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "fictional metadata")
    assert picture() != picture(metadata=info)
    result = normalize_logo(picture())
    assert result == normalize_logo(picture(metadata=info))
    with Image.open(BytesIO(result)) as decoded:
        assert decoded.format == "WEBP"
        assert decoded.size == (256, 128)
        assert not decoded.getexif()


@pytest.mark.parametrize("data", [b"", b"<svg></svg>", b"not an image"])
def test_invalid_image_is_rejected(data):
    with pytest.raises(ApiError):
        normalize_logo(data)


def test_upload_dedup_access_cache_and_delete_are_isolated_per_user():
    app = build_app()
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        register(client)
        first = create_job(client, logo_url="https://example.test/old.png")
        with app.state.session_factory() as db:
            application = db.scalar(select(JobApplication))
            before = dict(application.job_snapshot)
            application_id = application.id
        response = upload(client, first)
        assert response.status_code == 200, response.text
        logo = response.json()
        assert logo['revision'] == hashlib.sha256(normalize_logo(picture())).hexdigest()
        read = client.get(logo['logo_url'])
        assert read.status_code == 200
        assert read.headers['content-type'] == 'image/webp'
        assert read.headers['cache-control'] == 'private, no-cache'
        assert client.get(logo['logo_url'], headers={'If-None-Match': read.headers['etag']}).status_code == 304
        listed = client.get('/api/job-applications')
        assert listed.status_code == 200
        assert listed.json()['items'][0]['company_logo_url'] == logo['logo_url']
        # Verify persisted snapshot independently of the presentation route.
        with app.state.session_factory() as db:
            after = db.get(JobApplication, application_id).job_snapshot
            assert after == {**before, 'logo_url': logo['logo_url']}
        from linkresume.application.interviews.service import application_logo_url
        with app.state.session_factory() as db:
            assert application_logo_url(db.get(JobApplication, application_id)) == logo['logo_url']
        assert upload(client, first, picture('blue')).json() == logo
        assert storage.writes == 1

        client.cookies.clear()
        assert client.get(logo['logo_url'], headers={'If-None-Match': read.headers['etag']}).status_code == 401
        register(client, 'other@example.test')
        second = create_job(client)
        assert client.get(logo['logo_url']).status_code == 404
        assert upload(client, first).status_code == 404
        second_logo = upload(client, second).json()
        assert second_logo['revision'] == logo['revision']
        assert storage.writes == 1
        assert client.delete(f"/api/job-descriptions/{second['id']}").status_code == 200
        assert len(storage.objects) == 1
        assert not storage.deleted


def test_failed_or_conflicting_replacement_keeps_old_logo_and_job():
    app = build_app()
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        register(client)
        job = create_job(client)
        logo = upload(client, job).json()
        fields = {'mode': 'replace', 'expected_revision': logo['revision']}
        assert upload(client, job, b'bad image', **fields).status_code == 422
        assert upload(client, job, b'x' * (2 * 1024 * 1024 + 1), **fields).status_code == 413
        assert upload(client, job, picture('blue'), mode='replace', expected_revision='none').status_code == 409
        storage.fail = True
        assert upload(client, job, picture('blue'), **fields).status_code == 503
        assert storage.writes == 1
        storage.fail = False
        record = client.get(f"/api/job-descriptions/{job['id']}").json()['job_description']
        assert record['logo_revision'] == logo['revision']
        assert client.get(logo['logo_url']).status_code == 200
        changed = upload(client, job, picture('blue'), **fields)
        assert changed.status_code == 200
        assert changed.json()['revision'] != logo['revision']
        assert client.get(logo['logo_url']).status_code == 404
        assert len(storage.objects) == 2


def test_editing_external_url_detaches_managed_image_but_other_edits_preserve_it():
    app = build_app()
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        register(client)
        job = create_job(client, logo_url='https://example.test/old.png')
        logo = upload(client, job).json()
        def edit(**values):
            current = client.get(f"/api/job-descriptions/{job['id']}").json()['job_description']
            return client.put(f"/api/job-descriptions/{job['id']}", json={
                'base_lock_version': current['lock_version'], **values,
            })
        # Full-form submissions often send an unchanged external logo URL.
        response = edit(job_title='新岗位名', logo_url='https://example.test/old.png')
        assert response.status_code == 200
        assert response.json()['job_description']['logo_revision'] == logo['revision']
        response = edit(logo_url=None)
        assert response.status_code == 200
        assert response.json()['job_description']['logo_revision'] is None
        with app.state.session_factory() as db:
            assert db.scalar(select(JobApplication)).job_snapshot['logo_url'] is None


def test_missing_logo_can_be_filled_later_and_uploads_are_rate_limited():
    app = build_app()
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        register(client)
        job = create_job(client)
        storage.fail = True
        assert upload(client, job).status_code == 503
        assert client.get(f"/api/job-descriptions/{job['id']}").status_code == 200
        storage.fail = False
        assert upload(client, job).status_code == 200
        for _ in range(28):
            assert upload(client, job).status_code == 200
        assert upload(client, job).status_code == 429


def test_snapshot_cannot_supply_another_job_or_external_relative_path():
    from linkresume.application.interviews.service import application_logo_url
    app = build_app()
    with TestClient(app) as client:
        register(client)
        create_job(client)
        with app.state.session_factory() as db:
            application = db.scalar(select(JobApplication))
            for value in ['/api/assets/private', '//example.test/image', '/api/job-descriptions/999/logo?v=' + 'a' * 64]:
                application.job_snapshot = {'logo_url': value}
                assert application_logo_url(application) is None


def test_write_failure_does_not_attach_or_delete_a_shared_object():
    class FailedWriteStorage(LogoStorage):
        def put(self, *args, **kwargs):
            super().put(*args, **kwargs)
            raise RuntimeError('response lost after writing object')
    app = build_app()
    storage = FailedWriteStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        register(client)
        job = create_job(client)
        assert upload(client, job).status_code == 503
        record = client.get(f"/api/job-descriptions/{job['id']}").json()['job_description']
        assert record['logo_revision'] is None
        assert not storage.deleted
        assert len(storage.objects) == 1
        # Retry reuses the completed object instead of writing or deleting again.
        assert upload(client, job).status_code == 200
        assert storage.writes == 1
