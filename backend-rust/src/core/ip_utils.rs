pub fn normalize_ip(value: &str) -> &str {
    value
        .trim()
        .split_once('/')
        .map_or(value.trim(), |(ip, _)| ip.trim())
}
