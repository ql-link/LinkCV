from pydantic import BaseModel, ConfigDict, field_validator


class Credentials(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class AuthResponse(BaseModel):
    user: UserResponse


class MeResponse(BaseModel):
    user: UserResponse | None


class OkResponse(BaseModel):
    ok: bool
