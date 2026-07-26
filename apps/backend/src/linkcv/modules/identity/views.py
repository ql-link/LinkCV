from __future__ import annotations

from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import UserResponse


def build_user_response(user: User) -> UserResponse:
    avatar_url = None
    if user.avatar_object_key:
        # 对象键已是无料路径(/)，由 asset 路由以 {object_name:path} 接收，不再二次编码。
        avatar_url = f"/api/assets/{user.avatar_object_key}"
    return UserResponse(
        id=str(user.id),
        email=user.email,
        nickname=user.nickname,
        avatarUrl=avatar_url,
        isAdmin=user.is_admin == 1,
    )
