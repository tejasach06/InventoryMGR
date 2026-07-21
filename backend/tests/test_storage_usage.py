from app.services.storage import compute_pct


def test_compute_pct_basic():
    assert compute_pct(400, 1000) == 40.0


def test_compute_pct_zero_capacity_is_none():
    assert compute_pct(0, 0) is None  # ponytail: undefined usage, not a div-by-zero crash
