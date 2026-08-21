from linkcv.core.config import Settings
from linkcv.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    hash_secret,
    password_needs_rehash,
    parse_refresh_token,
    verify_password,
)


def _settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="unit-test-secret-that-is-at-least-32-bytes",
    )


def test_password_hash_and_argon2_round_trip() -> None:
    password_hash = hash_password("correct-horse")

    assert verify_password("correct-horse", password_hash)
    assert not verify_password("wrong-password", password_hash)

    # Fresh Argon2id hashes do not need a lazy rehash.
    assert not password_needs_rehash(password_hash)
def test_access_token_round_trip() -> None:
    settings = _settings()
    token = create_access_token(123, "sid-abc", settings)

    assert decode_access_token(token, settings) == (123, "sid-abc")
    assert decode_access_token(None, settings) is None
    assert decode_access_token("not-a-jwt", settings) is None


def test_refresh_token_parse_and_hash() -> None:
    secret = "s3cret-value"
    token = "sid-abc." + secret

    assert parse_refresh_token(token) == ("sid-abc", secret)
    assert parse_refresh_token(None) is None
    assert parse_refresh_token("no-dot") is None
    assert parse_refresh_token("trailing.") is None
    assert hash_secret(secret) != hash_secret("other")
