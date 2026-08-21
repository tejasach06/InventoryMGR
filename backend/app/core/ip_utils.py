def normalize_ip(value: str) -> str:
    """Trim surrounding whitespace and drop any /CIDR suffix."""
    return value.strip().split("/", 1)[0].strip()
