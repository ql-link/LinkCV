from linkcv.core.config import Settings
from linkcv.core.security import (
    create_session_token,
    decode_session_token,
    hash_password,
    verify_password,
)


def test_password_hash_and_jwt_round_trip() -> None:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="unit-test-secret-that-is-at-least-32-bytes",
    )
    password_hash = hash_password("correct-horse")

    assert verify_password("correct-horse", password_hash)
    assert not verify_password("wrong-password", password_hash)

    token = create_session_token("user_123", 3, settings)
    assert decode_session_token(token, settings) == ("user_123", 3)
