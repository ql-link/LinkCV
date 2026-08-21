from cryptography.fernet import Fernet
import pytest

from linkcv.modules.llm.crypto import CredentialCipher, CredentialUnavailableError


def key_ring(*key_ids: str) -> str:
    return ",".join(
        f"{key_id}:{Fernet.generate_key().decode('ascii')}" for key_id in key_ids
    )


def test_cipher_encrypts_without_storing_plaintext() -> None:
    cipher = CredentialCipher(key_ring("current"))

    envelope = cipher.encrypt("fictional-api-key")
    decrypted = cipher.decrypt(envelope)

    assert envelope.startswith("v1:current:")
    assert "fictional-api-key" not in envelope
    assert decrypted.plaintext == "fictional-api-key"
    assert decrypted.needs_rewrap is False


def test_cipher_can_read_old_key_and_requests_rewrap() -> None:
    old_ring = key_ring("old")
    old_key = old_ring.split(":", 1)[1]
    envelope = CredentialCipher(old_ring).encrypt("rotating-key")
    current_ring = f"current:{Fernet.generate_key().decode('ascii')},old:{old_key}"

    decrypted = CredentialCipher(current_ring).decrypt(envelope)

    assert decrypted.plaintext == "rotating-key"
    assert decrypted.needs_rewrap is True


@pytest.mark.parametrize("raw", [None, "", "broken", "one:not-a-fernet-key"])
def test_missing_or_invalid_key_ring_is_safely_unavailable(raw: str | None) -> None:
    cipher = CredentialCipher(raw)

    with pytest.raises(CredentialUnavailableError):
        cipher.encrypt("must-not-be-stored")
    with pytest.raises(CredentialUnavailableError):
        cipher.decrypt("v1:unknown:ciphertext")
