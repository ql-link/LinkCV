from linkcv.core.config import Settings
from linkcv.core.security import (
    generate_session_id,
    generate_refresh_secret,
    hash_refresh_secret,
    sign_refresh_token,
    parse_refresh_token,
    hash_password,
    verify_password,
)


def test_password_hash_and_jwt() -> None:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="unit-test-secret-that-is-at-least-32-bytes",
    )
    password_hash = hash_password("correct-horse")

    assert verify_password("correct-horse", password_hash)
    assert not verify_password("wrong-password", password_hash)


def test_refresh_token_round_trip() -> None:
    sid = generate_session_id()
    secret = generate_refresh_secret()
    refresh_hash = hash_refresh_secret(secret)

    token = sign_refresh_token(sid, secret)
    parsed = parse_refresh_token(token)
    assert parsed is not None
    parsed_sid, parsed_secret = parsed
    assert parsed_sid == sid
    assert parsed_secret == secret
    assert hash_refresh_secret(parsed_secret) == refresh_hash


def test_parse_refresh_token_invalid() -> None:
    assert parse_refresh_token(None) is None
    assert parse_refresh_token("") is None
    assert parse_refresh_token("no-dot") is None
    assert parse_refresh_token(".only-secret") is None
