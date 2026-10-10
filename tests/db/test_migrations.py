"""The initial Alembic migration must build the full schema from scratch."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from chronos.db import Base

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_upgrade_head_creates_all_tables(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "migration-test.db"
    url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)

    config = Config(str(REPO_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(REPO_ROOT / "migrations"))
    command.upgrade(config, "head")

    engine = create_engine(url)
    try:
        actual = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    expected = set(Base.metadata.tables) | {"alembic_version"}
    assert actual == expected
