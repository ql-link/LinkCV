"""LinkRag client speaks the /api/v1/apps contract and normalizes failures."""

import json
import logging

import httpx
import pytest

from drawoffer.integrations.linkrag_client import LinkRagClient, LinkRagError

SECRET = "fictional-linkrag-secret"


def client_for(handler) -> LinkRagClient:
    return LinkRagClient(
        base_url="http://rag.test/",
        client_id="lr_client",
        client_secret=SECRET,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )


def ok(data) -> httpx.Response:
    return httpx.Response(200, json={"code": 200, "message": "ok", "data": data})


def test_requests_carry_credentials_user_and_contract_fields() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/files"):
            return ok({"id": 3001})
        if request.url.path.endswith("/recall"):
            return ok({"hits": [
                {"chunkId": "c1", "fileId": 3001, "datasetId": 9, "score": 0.8, "content": "正文"},
                {"chunkId": "bad"},
            ], "failedSources": []})
        return ok({"id": 9})

    client = client_for(handler)
    assert client.ensure_default_dataset(42) == 9
    assert client.upload_markdown(42, filename="7.md", markdown="# 标题", external_ref="dataset:7:0") == 3001
    hits = client.recall(42, query="订单", file_ids=[3001, 3001], top_k=99)
    assert [(h.file_id, h.content) for h in hits] == [(3001, "正文")]

    assert all(r.headers["authorization"] == f"Bearer lr_client.{SECRET}" for r in seen)
    assert all(r.headers["x-app-user-id"] == "42" for r in seen)
    assert (seen[0].method, seen[0].url.path) == ("PUT", "/api/v1/apps/datasets/default")
    upload = seen[1].content.decode()
    assert 'name="file"; filename="7.md"' in upload and "text/markdown" in upload
    assert 'name="externalRef"' in upload and "dataset:7:0" in upload
    assert json.loads(seen[2].content) == {"query": "订单", "fileIds": [3001], "topK": 50}


def test_errors_are_normalized_and_secret_never_logged(caplog) -> None:
    caplog.set_level(logging.DEBUG)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return httpx.Response(404, json={"code": 404, "message": "x", "data": None})
        return httpx.Response(403, json={"code": 403, "message": "x", "data": {"reason": "APP_DISABLED"}})

    client = client_for(handler)
    client.delete_file(1, 5)  # missing file counts as deleted
    with pytest.raises(LinkRagError) as raised:
        client.file_status(1, 5)
    assert (raised.value.status, raised.value.reason) == (403, "APP_DISABLED")
    assert SECRET not in caplog.text


def test_transport_failure_and_invalid_body() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(LinkRagError) as raised:
        client_for(down).recall(1, query="q", file_ids=[1], top_k=3)
    assert raised.value.status == 0 and raised.value.reason == "LINKRAG_UNAVAILABLE"

    with pytest.raises(LinkRagError, match="LINKRAG_RESPONSE_INVALID"):
        client_for(lambda r: httpx.Response(200, text="not json")).ensure_default_dataset(1)
    # Empty scope never calls the service.
    assert client_for(down).recall(1, query="q", file_ids=[], top_k=3) == []
