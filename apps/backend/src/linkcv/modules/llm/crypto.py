from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from pydantic import SecretStr

from linkcv.core.config import parse_llm_credential_encryption_keys


class CredentialUnavailableError(Exception):
    pass


@dataclass(frozen=True)
class DecryptedCredential:
    plaintext: str
    needs_rewrap: bool


class CredentialCipher:
    def __init__(self, raw_keys: SecretStr | str | None) -> None:
        try:
            key_specs = parse_llm_credential_encryption_keys(raw_keys)
        except ValueError:
            key_specs = ()
        self._keys = {key_id: Fernet(key) for key_id, key in key_specs}
        self._active_key_id = key_specs[0][0] if key_specs else None

    @property
    def available(self) -> bool:
        return self._active_key_id is not None

    def encrypt(self, plaintext: str) -> str:
        if not self._active_key_id:
            raise CredentialUnavailableError
        token = self._keys[self._active_key_id].encrypt(plaintext.encode("utf-8"))
        return f"v1:{self._active_key_id}:{token.decode('ascii')}"

    def decrypt(self, envelope: str) -> DecryptedCredential:
        version, separator, remainder = envelope.partition(":")
        key_id, token_separator, token = remainder.partition(":")
        if version != "v1" or not separator or not token_separator:
            raise CredentialUnavailableError
        cipher = self._keys.get(key_id)
        if cipher is None or self._active_key_id is None:
            raise CredentialUnavailableError
        try:
            plaintext = cipher.decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeDecodeError, UnicodeEncodeError) as error:
            raise CredentialUnavailableError from error
        return DecryptedCredential(
            plaintext=plaintext,
            needs_rewrap=key_id != self._active_key_id,
        )
