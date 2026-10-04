from __future__ import annotations

import json
import time
from threading import RLock


class FakeRedis:
    """In-memory Redis stand-in mirroring the subset used by auth sessions."""

    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}
        self.ttls: dict[str, float | None] = {}
        self._lock = RLock()

    def resume_import_acquire(
        self,
        key: str,
        fingerprint: str,
        owner: str,
        ttl_ms: int,
    ) -> tuple[str, str]:
        with self._lock:
            raw = self.strings.get(key)
            if raw is None:
                state = {
                    "status": "processing",
                    "fingerprint": fingerprint,
                    "owner": owner,
                }
                raw = json.dumps(state)
                self.strings[key] = raw
                self.ttls[key] = ttl_ms / 1000
                return "new", raw
            state = json.loads(raw)
            if state["fingerprint"] != fingerprint:
                return "conflict", raw
            return state["status"], raw

    def resume_import_renew(
        self,
        key: str,
        fingerprint: str,
        owner: str,
        ttl_ms: int,
    ) -> int:
        with self._lock:
            raw = self.strings.get(key)
            if raw is None:
                return 0
            state = json.loads(raw)
            if (
                state["status"] != "processing"
                or state["fingerprint"] != fingerprint
                or state["owner"] != owner
            ):
                return 0
            self.ttls[key] = ttl_ms / 1000
            return 1

    def resume_import_bind(
        self,
        key: str,
        fingerprint: str,
        owner: str,
        import_id: str,
        ttl_ms: int,
    ) -> int:
        with self._lock:
            raw = self.strings.get(key)
            if raw is None:
                return 0
            state = json.loads(raw)
            if (
                state["status"] != "processing"
                or state["fingerprint"] != fingerprint
                or state.get("owner") != owner
                or state.get("import_id") is not None
            ):
                return 0
            state.pop("owner", None)
            state["import_id"] = import_id
            self.strings[key] = json.dumps(state)
            self.ttls[key] = ttl_ms / 1000
            return 1

    def resume_import_finish(
        self,
        key: str,
        fingerprint: str,
        owner: str,
        payload: str,
        ttl_ms: int,
    ) -> int:
        with self._lock:
            raw = self.strings.get(key)
            if raw is None:
                return 0
            state = json.loads(raw)
            if (
                state["status"] != "processing"
                or state["fingerprint"] != fingerprint
                or state["owner"] != owner
            ):
                return 0
            self.strings[key] = payload
            self.ttls[key] = ttl_ms / 1000
            return 1

    def hset(
        self,
        name: str,
        key: str | None = None,
        value: str | None = None,
        mapping: dict[str, str] | None = None,
    ) -> int:
        data = self.hashes.setdefault(name, {})
        merged: dict[str, str] = dict(mapping or {})
        if key is not None:
            merged[key] = "" if value is None else str(value)
        count = 0
        for field, val in merged.items():
            if field not in data:
                count += 1
            data[field] = str(val)
        return count

    def hget(self, name: str, key: str) -> str | None:
        return self.hashes.get(name, {}).get(key)

    def hgetall(self, name: str) -> dict[str, str]:
        return dict(self.hashes.get(name, {}))

    def hdel(self, name: str, *keys: str) -> int:
        data = self.hashes.get(name, {})
        removed = 0
        for key in keys:
            if key in data:
                data.pop(key)
                removed += 1
        return removed

    def get(self, name: str) -> str | None:
        return self.strings.get(name)

    def getset(self, name: str, value: str) -> str | None:
        previous = self.strings.get(name)
        self.strings[name] = str(value)
        return previous

    def incr(self, name: str, amount: int = 1) -> int:
        current = int(self.strings.get(name) or 0)
        self.strings[name] = str(current + amount)
        return current + amount

    def set(self, name: str, value: str, **kwargs: object) -> int:
        self.strings[name] = str(value)
        ttl = kwargs.get("ex")
        if isinstance(ttl, (int, float)):
            self.ttls[name] = float(ttl)
        return 1

    def exists(self, name: str) -> int:
        return int(
            name in self.strings or name in self.hashes or name in self.sets
        )

    def get(self, name: str) -> str | None:
        return self.strings.get(name)

    def delete(self, *names: str) -> int:
        removed = 0
        for name in names:
            removed += int(
                self.strings.pop(name, None) is not None
                or self.hashes.pop(name, None) is not None
                or self.sets.pop(name, None) is not None
            )
            self.ttls.pop(name, None)
        return removed

    def expire(self, name: str, ttl: float) -> int:
        if name in self.strings or name in self.hashes or name in self.sets:
            self.ttls[name] = ttl
            return 1
        return 0

    def sadd(self, name: str, *values: str) -> int:
        target = self.sets.setdefault(name, set())
        before = len(target)
        target.update(values)
        return len(target) - before

    def srem(self, name: str, *values: str) -> int:
        target = self.sets.get(name, set())
        removed = 0
        for value in values:
            if value in target:
                target.remove(value)
                removed += 1
        if not target:
            self.sets.pop(name, None)
        return removed

    def smembers(self, name: str) -> set[str]:
        return set(self.sets.get(name, set()))

    def ping(self, **_kwargs) -> bool:
        return True

    def set(
        self,
        name: str,
        value: str,
        *,
        nx: bool = False,
        ex: int | None = None,
    ) -> bool:
        with self._lock:
            if nx and name in self.strings:
                return False
            self.strings[name] = value
            self.ttls[name] = ex
            return True

    def eval(self, script: str, _numkeys: int, name: str, *args: object):
        with self._lock:
            keys = (name, *args[:_numkeys - 1])
            values = tuple(str(value) for value in args[_numkeys - 1:])
            now = int(time.time())
            if "desktop_create_challenge" in script:
                platform, version, challenge, poll_hash, ttl = values
                self.hset(name, mapping={
                    'state': 'pending', 'target_channel': 'desktop', 'platform': platform,
                    'client_version': version, 'code_challenge': challenge,
                    'code_challenge_method': 'S256', 'poll_hash': poll_hash,
                    'expires_at': str(now + int(ttl)),
                })
                self.expire(name, int(ttl))
                return 1
            if "desktop_rate_limit" in script:
                count = self.incr(name)
                if count == 1:
                    self.expire(name, 60)
                return count
            if "desktop_logout" in script:
                old_hash, uid, sid = values
                record = self.hgetall(name)
                if not record:
                    return 'ok'
                if record.get('channel') != 'desktop' or record.get('uid') != uid or record.get('rhash') != old_hash:
                    return 'invalid'
                if keys[1] in self.strings or keys[1] in self.hashes:
                    return 'unavailable'
                self.delete(name)
                self.srem(keys[1], sid)
                return 'ok'
            if "desktop_refresh" in script:
                uid, old_hash, request_id, sid, new_hash, ciphertext, deadline, ttl = values
                record = self.hgetall(name)
                if record.get('channel') != 'desktop' or record.get('uid') != uid:
                    return ['invalid']
                if record.get('retry_request_id') == request_id:
                    if record.get('retry_old_rhash') != old_hash:
                        return ['conflict']
                    if int(record.get('retry_expires_at', 0)) > now and record.get('retry_new_rhash') == record.get('rhash'):
                        return ['result', record['retry_ciphertext']]
                if keys[1] in self.strings or keys[1] in self.hashes:
                    return ['unavailable']
                if record.get('rhash') != old_hash:
                    self.delete(name)
                    self.srem(keys[1], sid)
                    return ['replayed']
                self.hset(name, mapping={'rhash': new_hash, 'retry_request_id': request_id,
                                        'retry_old_rhash': old_hash, 'retry_new_rhash': new_hash,
                                        'retry_ciphertext': ciphertext, 'retry_expires_at': deadline})
                self.expire(name, int(ttl))
                return ['result', ciphertext]
            if "desktop_exchange" in script:
                poll_hash, challenge, request_id, fingerprint, uid, sid, rhash, created_at, ttl, ciphertext, deadline = values
                record = self.hgetall(name)
                if record.get('target_channel') != 'desktop' or record.get('poll_hash') != poll_hash or record.get('code_challenge') != challenge:
                    return ['invalid']
                if record.get('state') == 'consumed':
                    if record.get('exchange_request_id') != request_id or record.get('exchange_fingerprint') != fingerprint:
                        return ['conflict']
                    if int(record.get('result_expires_at', 0)) <= now:
                        return ['result_expired']
                    return ['result', record['result_ciphertext']]
                if int(record.get('expires_at', 0)) <= now:
                    return ['expired']
                if record.get('state') != 'confirmed':
                    return ['not_confirmed']
                if record.get('uid') != uid:
                    return ['invalid']
                if self.exists(keys[1]):
                    return ['conflict']
                if keys[2] in self.strings or keys[2] in self.hashes:
                    return ['unavailable']
                self.hset(keys[1], mapping={'uid': uid, 'rhash': rhash, 'channel': 'desktop', 'created_at': created_at})
                self.expire(keys[1], int(ttl))
                self.sadd(keys[2], sid)
                self.hset(name, mapping={'state': 'consumed', 'exchange_request_id': request_id,
                                        'exchange_fingerprint': fingerprint, 'result_sid': sid,
                                        'result_rhash': rhash, 'result_ciphertext': ciphertext,
                                        'result_expires_at': deadline})
                self.expire(name, int(deadline) - now)
                return ['result', ciphertext]
            if self.hget(name, 'target_channel') == 'desktop' and 'local desktop' in script:
                deadline = int(self.hget(name, 'expires_at') or 0)
                if deadline <= now:
                    return 0 if 'wechat_finalize' in script or 'wechat_restore' in script else 'missing'
                args = tuple(args[:-1]) + (min(float(args[-1]), deadline - now),) if 'wechat_finalize' in script or 'wechat_restore' in script or 'wechat_cancel' in script else (args[0], args[1], deadline - now, args[3])
            if "auth_rotate_refresh" in script:
                old_hash, new_hash, channel, ttl = args
                stored_channel = self.hget(name, "channel") or "web"
                if stored_channel != str(channel):
                    return "invalid"
                if self.hget(name, "rhash") != str(old_hash):
                    return "mismatch"
                self.hset(
                    name,
                    mapping={"rhash": str(new_hash), "channel": str(channel)},
                )
                self.expire(name, float(ttl))
                return "rotated"
            if "wechat_claim" in script:
                state = self.hget(name, "state")
                if state is None:
                    return "missing"
                claim_id, claimed_at, ttl, claim_timeout = args
                stale = (
                    state == "processing"
                    and float(claimed_at)
                    - float(self.hget(name, "claimed_at") or 0)
                    >= float(claim_timeout)
                )
                if state != "pending" and not stale:
                    return state
                self.hset(
                    name,
                    mapping={
                        "state": "processing",
                        "claim_id": str(claim_id),
                        "claimed_at": str(claimed_at),
                    },
                )
                self.expire(name, float(ttl))
                return "claimed"
            if "wechat_finalize" in script:
                claim_id, state, uid, ttl = args
                if self.hget(name, "state") != "processing":
                    return 0
                if self.hget(name, "claim_id") != str(claim_id):
                    return 0
                self.hset(name, mapping={"state": str(state), "uid": str(uid)})
                self.hdel(name, "claim_id", "claimed_at")
                self.expire(name, float(ttl))
                return 1
            if "wechat_restore" in script:
                claim_id, ttl = args
                if self.hget(name, "state") != "processing":
                    return 0
                if self.hget(name, "claim_id") != str(claim_id):
                    return 0
                self.hset(name, "state", "pending")
                self.hdel(name, "claim_id", "claimed_at")
                self.expire(name, float(ttl))
                return 1
            if "wechat_cancel" in script:
                (ttl,) = args
                state = self.hget(name, "state")
                if state is None:
                    return "missing"
                if state == "pending":
                    self.hset(name, "state", "cancelled")
                    self.expire(name, float(ttl))
                    return "cancelled"
                return state
            if "wechat_swap_web_session" in script:
                uid, sid, ttl = args
                if self.hget(name, "state") != "confirmed":
                    return "__invalid__"
                if self.hget(name, "uid") != str(uid):
                    return "__invalid__"
                previous = self.hget(name, "web_sid") or ""
                self.hset(name, "web_sid", str(sid))
                self.expire(name, float(ttl))
                return previous

            (token,) = args
            if self.strings.get(name) != token:
                return 0
            self.strings.pop(name, None)
            self.ttls.pop(name, None)
            return 1

    def close(self, **_kwargs) -> None:
        pass


class FakeLinkRag:
    """In-memory LinkRag app API: per-user files, parse state and recall.

    ``fail`` names methods that raise ``LinkRagError``; ``recall_hits`` maps a
    RAG file id to the chunk text recall returns for it.
    """

    def __init__(self) -> None:
        from linkresume.integrations.linkrag_client import LinkRagError

        self._error = LinkRagError
        self.files: dict[int, dict[str, object]] = {}
        self.fail: set[str] = set()
        self.parse_result = "parse_success"
        self.recall_hits: dict[int, str] = {}
        self.recall_calls: list[dict[str, object]] = []
        self.deleted: list[int] = []
        self.foreign_hits: list[tuple[int, str]] = []
        self._next = 5000

    def _check(self, name: str) -> None:
        if name in self.fail:
            raise self._error(503, "LINKRAG_TEST_FAILURE")

    def ensure_default_dataset(self, user_id: int) -> int:
        self._check("ensure_default_dataset")
        return 900 + user_id

    def upload_markdown(self, user_id, *, filename, markdown, external_ref) -> int:
        self._check("upload_markdown")
        self._next += 1
        self.files[self._next] = {
            "user_id": user_id, "filename": filename, "markdown": markdown, "external_ref": external_ref,
        }
        return self._next

    def file_status(self, user_id, file_id):
        from linkresume.integrations.linkrag_client import RagFileStatus

        self._check("file_status")
        entry = self.files.get(file_id)
        if entry is None or entry["user_id"] != user_id:
            raise self._error(404, "NOT_FOUND")
        return RagFileStatus(file_id=file_id, frontend_status=self.parse_result)

    def delete_file(self, user_id, file_id) -> None:
        self._check("delete_file")
        entry = self.files.get(file_id)
        if entry is not None and entry["user_id"] == user_id:
            del self.files[file_id]
            self.deleted.append(file_id)

    def recall(self, user_id, *, query, file_ids, top_k):
        from linkresume.integrations.linkrag_client import RagHit

        self._check("recall")
        self.recall_calls.append({"user_id": user_id, "query": query, "file_ids": list(file_ids), "top_k": top_k})
        hits = [
            RagHit(file_id=file_id, chunk_id=f"c{file_id}", score=0.9, content=self.recall_hits[file_id])
            for file_id in file_ids
            if file_id in self.recall_hits
        ]
        # Simulates a misbehaving service returning hits outside the request.
        hits += [RagHit(file_id=f, chunk_id="x", score=1.0, content=c) for f, c in self.foreign_hits]
        return hits[:top_k] if not self.foreign_hits else hits

    def close(self) -> None:
        pass
