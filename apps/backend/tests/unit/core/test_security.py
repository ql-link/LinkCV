from linkcv.core.config import Settings
from linkcv.core.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_secret,
    hash_refresh_secret,
    hash_password,
    parse_refresh_token,
    sign_refresh_token,
    verify_password,
)


def _settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="unit-test-secret-that-is-at-least-32-bytes",
    )


def test_argon2_password_hash_round_trip() -> None:
    password_hash = hash_password("correct-horse")

    assert verify_password("correct-horse", password_hash)
    assert not verify_password("wrong-password", password_hash)
    assert not verify_password("correct-horse", "not-a-valid-argon2-hash")


def test_access_token_round_trip() -> None:
    settings = _settings()
    token = create_access_token(42, "sid-abc", settings)

    claims = decode_access_token(token, settings)
    assert claims is not None
    assert claims.user_id == "42"
    assert claims.sid == "sid-abc"


def test_access_token_rejects_tampered_and_missing() -> None:
    settings = _settings()
    assert decode_access_token(None, settings) is None
    assert decode_access_token("not-a-jwt", settings) is None
    tampered = create_access_token(1, "sid", settings) + "x"
    assert decode_access_token(tampered, settings) is None

    other = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="a-different-secret-with-32-bytes-of-random",
    )
    assert decode_access_token(create_access_token(1, "sid", settings), other) is None


def test_refresh_token_parse_and_hash() -> None:
    secret = generate_refresh_secret()

    assert parse_refresh_token(None) is None
    assert parse_refresh_token("no-dot") is None
    assert parse_refresh_token("sid.") is None

    token = sign_refresh_token("sid-123", secret)
    parsed = parse_refresh_token(token)
    assert parsed == ("sid-123", secret)

    digest = hash_refresh_secret(secret)
    assert len(digest) == 64
    assert hash_refresh_secret(secret) == digest
    assert hash_refresh_secret("other") != digest
