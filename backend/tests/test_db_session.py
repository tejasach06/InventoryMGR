from unittest.mock import MagicMock

import pytest

from app.db import session as session_module


def test_get_db_yields_session_and_closes_it(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_session = MagicMock()
    monkeypatch.setattr(session_module, "SessionLocal", lambda: fake_session)

    generator = session_module.get_db()
    yielded = next(generator)
    assert yielded is fake_session
    fake_session.close.assert_not_called()

    with pytest.raises(StopIteration):
        next(generator)

    fake_session.close.assert_called_once_with()


def test_get_db_closes_session_even_when_consumer_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_session = MagicMock()
    monkeypatch.setattr(session_module, "SessionLocal", lambda: fake_session)

    generator = session_module.get_db()
    next(generator)

    with pytest.raises(RuntimeError, match="boom"):
        generator.throw(RuntimeError("boom"))

    fake_session.close.assert_called_once_with()
