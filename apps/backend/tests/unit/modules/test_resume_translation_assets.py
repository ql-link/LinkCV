from types import SimpleNamespace

from linkresume.modules.resumes.pdf_service import clone_resume_private_assets


class CopyingStorage:
    def __init__(self) -> None:
        self.objects = {
            "users/3/resumes/7/assets/avatar.png": b"image",
            "users/3/assets/shared.png": b"shared",
        }

    def stat(self, object_name: str) -> SimpleNamespace:
        return SimpleNamespace(size=len(self.objects[object_name]))

    def copy(self, source_name: str, target_name: str) -> None:
        self.objects[target_name] = self.objects[source_name]

    def delete(self, object_name: str) -> None:
        self.objects.pop(object_name, None)


def test_clone_resume_private_assets_rewrites_only_resume_scoped_urls() -> None:
    storage = CopyingStorage()
    data = {
        "avatar": "/api/resumes/7/assets/avatar.png",
        "shared": "/api/assets/users/3/assets/shared.png",
    }

    rewritten, copied = clone_resume_private_assets(
        storage,  # type: ignore[arg-type]
        data,
        user_id=3,
        source_resume_id=7,
        target_resume_id=9,
    )

    assert rewritten["avatar"] == "/api/resumes/9/assets/avatar.png"
    assert rewritten["shared"] == data["shared"]
    assert copied == ["users/3/resumes/9/assets/avatar.png"]
    assert storage.objects[copied[0]] == b"image"
