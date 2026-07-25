from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uk_users_email"),
        CheckConstraint("auth_version > 0", name="ck_users_auth_version_positive"),
    )

    id: Mapped[str] = mapped_column(String(37), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    auth_version: Mapped[int] = mapped_column(
        Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql"),
        nullable=False,
        default=1,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
