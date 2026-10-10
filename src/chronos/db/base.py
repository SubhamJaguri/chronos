"""Declarative base and shared column helpers for the Chronos schema.

Conventions:
- Surrogate primary keys are UUID4 strings (36 chars), never display names.
- Every institution-owned table carries an ``institution_id`` scope column so
  multi-tenant isolation can be enforced later without a schema rewrite.
- Enumerations are stored as constrained VARCHARs (``native_enum=False``) so the
  schema behaves identically on PostgreSQL and on SQLite used in tests.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, MetaData, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def new_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def uuid_pk() -> Mapped[str]:
    return mapped_column(String(36), primary_key=True, default=new_uuid)


def institution_fk() -> Mapped[str]:
    """Tenant scope column; present on every institution-owned table."""
    return mapped_column(
        String(36), ForeignKey("institution.id", ondelete="CASCADE"), nullable=False, index=True
    )


def created_at_col() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
