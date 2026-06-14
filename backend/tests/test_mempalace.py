from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import UserRole

from .conftest import create_user, login


@pytest.fixture(autouse=True)
def clear_settings_cache() -> Generator[None, None, None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def write_page(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def test_mempalace_search_reads_configured_wiki_without_raw_sources(
    client, db_session: Session, monkeypatch, tmp_path: Path
) -> None:
    vault = tmp_path / "vault"
    write_page(
        vault / "wiki" / "entities" / "mempalace.md",
        """---
type: entity
---
# MemPalace

MemPalace stores local-first AI memory and exposes MCP search tools.
""",
    )
    write_page(
        vault / "wiki" / "sources" / "proxmox.md",
        """---
type: source
---
# Proxmox Source

Cluster storage and VM lifecycle notes.
""",
    )
    write_page(
        vault / "raw" / "sources" / "private.md",
        "# Raw Secret\n\nMemPalace raw source must not be exposed by the plugin.\n",
    )
    monkeypatch.setenv("MEMPALACE_VAULT_PATH", str(vault))
    get_settings.cache_clear()
    create_user(db_session, email="viewer@example.local", role=UserRole.viewer)
    login(client, "viewer@example.local")

    response = client.get("/api/mempalace/search", params={"q": "local memory", "limit": 5})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["query"] == "local memory"
    assert body["total"] == 1
    assert body["items"] == [
        {
            "title": "MemPalace",
            "path": "wiki/entities/mempalace.md",
            "page_type": "entity",
            "line": 6,
            "snippet": "MemPalace stores local-first AI memory and exposes MCP search tools.",
        }
    ]


def test_mempalace_search_requires_auth_and_available_vault(
    client, db_session: Session, monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("MEMPALACE_VAULT_PATH", str(tmp_path / "missing-vault"))
    get_settings.cache_clear()
    unauthenticated = client.get("/api/mempalace/search", params={"q": "mempalace"})
    assert unauthenticated.status_code == 401

    create_user(db_session, email="viewer@example.local", role=UserRole.viewer)
    login(client, "viewer@example.local")

    unavailable = client.get("/api/mempalace/search", params={"q": "mempalace"})
    assert unavailable.status_code == 503
    assert unavailable.json() == {"detail": "Mempalace vault is unavailable"}
