"""Assistant dataset recall prefers LinkRag and falls back to substring matching."""

import pytest

from linkresume.modules.agent.resume_tools import search_materials
from tests.fakes import FakeLinkRag
from tests.unit.services.test_rag_sync_service import add_dataset, add_user, env, record  # noqa: F401


class Storage:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects

    def get(self, key: str) -> bytes:
        return self.objects[key]


@pytest.fixture
def indexed(env):  # noqa: F811
    factory, storage, rag, service, _ = env
    user = add_user(factory)
    ready = add_dataset(factory, storage, user, "# 性能\n订单系统重构后 QPS 从 2000 提升到 5000。")
    service.run_once()
    rag.recall_hits = {record(factory, ready).rag_file_id: "订单系统重构后 QPS 从 2000 提升到 5000。"}
    return factory, Storage(storage), rag, user, ready


def search(factory, storage, user, query, *, rag, allowed=None):
    with factory() as db:
        return search_materials(
            db, user_id=user, query=query, types=["dataset"], limit=5,
            storage=storage, max_bytes=1_000_000, allowed_refs=allowed, rag=rag,
        )


def test_ready_dataset_is_recalled_semantically(indexed) -> None:
    factory, storage, rag, user, ready = indexed
    # A paraphrase has no substring match; only RAG can find it.
    sources = search(factory, storage, user, "订单服务吞吐量提升了多少", rag=rag)
    assert [s["source_id"] for s in sources] == [f"dataset:{ready}:{'0' * 64}"]
    assert "5000" in sources[0]["excerpt"]
    assert search(factory, storage, user, "订单服务吞吐量提升了多少", rag=None) == []


def test_rag_failure_falls_back_to_substring_matching(indexed) -> None:
    factory, storage, rag, user, ready = indexed
    rag.fail = {"recall"}
    assert search(factory, storage, user, "订单服务吞吐量", rag=rag) == []
    sources = search(factory, storage, user, "QPS 从 2000", rag=rag)
    assert [s["source_id"].split(":")[1] for s in sources] == [str(ready)]


def test_unindexed_authorized_dataset_uses_substring_and_scope_is_kept(indexed) -> None:
    factory, storage, rag, user, ready = indexed
    fresh = add_dataset(factory, storage.objects, user, "新上传的资料提到 Kafka 分区")
    other = add_user(factory, "other")
    add_dataset(factory, storage.objects, other, "Kafka 分区属于别人")
    sources = search(factory, storage, user, "Kafka 分区", rag=rag)
    ids = [s["source_id"].split(":")[1] for s in sources]
    # The fake RAG returns every requested file; the unindexed one comes from
    # substring matching, and nothing of the other user leaks in.
    assert ids == [str(ready), str(fresh)]
    assert rag.recall_calls[-1]["user_id"] == user

    # Authorization narrows RAG too: an unauthorized indexed dataset is never requested.
    calls = len(rag.recall_calls)
    scoped = search(factory, storage, user, "吞吐量", rag=rag, allowed={("dataset", str(fresh))})
    assert scoped == []
    assert len(rag.recall_calls) == calls
