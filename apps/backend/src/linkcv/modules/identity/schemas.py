from pydantic import BaseModel, ConfigDict


class Credentials(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str


class AuthResponse(BaseModel):
    user: UserResponse


class MeResponse(BaseModel):
    user: UserResponse | None


class OkResponse(BaseModel):
    ok: bool
