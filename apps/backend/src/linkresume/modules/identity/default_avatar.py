from pathlib import Path

# A marker, never a private storage object. Only new registrations receive it.
DEFAULT_AVATAR_KEY = "system:project-logo"
DEFAULT_AVATAR_URL = "/api/auth/default-avatar"
DEFAULT_AVATAR_PATH = Path(__file__).with_name("resources") / "default-avatar.png"


def is_custom_avatar(key: str | None) -> bool:
    return bool(key) and key != DEFAULT_AVATAR_KEY
