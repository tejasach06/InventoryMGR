from app.core.ip_utils import normalize_ip


def test_normalize_ip_strips_whitespace_and_cidr():
    assert normalize_ip("  10.0.0.5/24  ") == "10.0.0.5"


def test_normalize_ip_passthrough():
    assert normalize_ip("10.0.0.5") == "10.0.0.5"
