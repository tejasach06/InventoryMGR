use std::net::Ipv4Addr;

pub fn normalize_ip(value: &str) -> &str {
    value
        .trim()
        .split_once('/')
        .map_or(value.trim(), |(ip, _)| ip.trim())
}

pub fn parse_ipv4_endpoint(value: &str) -> Result<String, &'static str> {
    let normalized = normalize_ip(value);
    if normalized.is_empty() {
        return Err("IP address cannot be blank");
    }
    let addr: Ipv4Addr = normalized.parse().map_err(|_| "Invalid IPv4 address")?;
    Ok(addr.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ipv4_endpoint() {
        assert_eq!(parse_ipv4_endpoint("192.168.1.1").unwrap(), "192.168.1.1");
        assert_eq!(parse_ipv4_endpoint("  10.0.0.1/24  ").unwrap(), "10.0.0.1");
        assert_eq!(parse_ipv4_endpoint("172.16.0.5/32").unwrap(), "172.16.0.5");
        assert!(parse_ipv4_endpoint("").is_err());
        assert!(parse_ipv4_endpoint("   ").is_err());
        assert!(parse_ipv4_endpoint("not-an-ip").is_err());
        assert!(parse_ipv4_endpoint("256.0.0.1").is_err());
        assert!(parse_ipv4_endpoint("1.2.3").is_err());
        assert!(parse_ipv4_endpoint("::1").is_err());
    }
}

