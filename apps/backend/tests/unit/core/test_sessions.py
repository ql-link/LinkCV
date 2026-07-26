from linkcv.core.config import Settings
from linkcv.core.security import hash_refresh_secret, sign_refresh_token
from linkcv.core.sessions import (
    InMemorySessionStore,
    SessionData,
    absolute_expires_at_ms,
    second_probe_until,
)


def _settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="unit-test-secret-that-is-at-least-32-bytes",
        refresh_token_absolute_days=30,
        session_ttl_days=7,
    )


def _expired_settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="unit-test-secret-that-is-at-least-32-bytes",
        refresh_token_absolute_days=0,
        session_ttl_days=7,
    )


def test_create_and_get_session_round_trip() -> None:
    store = InMemorySessionStore()
    settings = _settings()

    session = store.create(7, settings)
    assert isinstance(session, SessionData)
    assert session.user_id == "7"
    assert session.secret

    loaded = store.get(session.sid)
    assert loaded is not None
    assert loaded.user_id == "7"
    assert loaded.refresh_token_hash == session.refresh_token_hash
    assert loaded.secret == ""


def test_rotate_changes_refresh_hash_and_returns_new_secret() -> None:
    store = InMemorySessionStore()
    settings = _settings()
    session = store.create(1, settings)

    rotated = store.rotate(session.sid, settings)
    assert rotated is not None
    assert rotated.sid == session.sid
    assert rotated.secret != session.secret
    assert rotated.refresh_token_hash == hash_refresh_secret(rotated.secret)

    reloaded = store.get(session.sid)
    assert reloaded is not None
    assert reloaded.refresh_token_hash == rotated.refresh_token_hash


def test_revoke_removes_session_and_user_membership() -> None:
    store = InMemorySessionStore()
    settings = _settings()
    session = store.create(11, settings)

    store.revoke(session.sid)

    assert store.get(session.sid) is None
    assert store.touch(session.sid, settings) is False
    assert store.rotate(session.sid, settings) is None


def test_revoke_user_drops_all_sessions_of_user() -> None:
    store = InMemorySessionStore()
    settings = _settings()
    first = store.create(3, settings)
    second = store.create(3, settings)
    other = store.create(4, settings)

    store.revoke_user(3)

    assert store.get(first.sid) is None
    assert store.get(second.sid) is None
    assert store.get(other.sid) is not None


def test_absolute_expiry_blocks_rotation() -> None:
    store = InMemorySessionStore()
    settings = _expired_settings()

    session = store.create(5, settings)
    assert session is not None
    assert store.touch(session.sid, _settings()) is False
    assert store.rotate(session.sid, _settings()) is None


def test_second_probe_until_caps_to_absolute_remaining() -> None:
    settings = _settings()
    sliding = settings.session_ttl_days * 24 * 60 * 60
    abs_expires = absolute_expires_at_ms(settings, now_ms=0)
    two_days_ms = 2 * 24 * 60 * 60 * 1000

    assert second_probe_until(sliding, 1, now_ms=0) == 0
    assert second_probe_until(sliding, abs_expires, now_ms=0) == sliding
    assert (
        second_probe_until(sliding, two_days_ms, now_ms=0)
        == two_days_ms // 1000
    )
