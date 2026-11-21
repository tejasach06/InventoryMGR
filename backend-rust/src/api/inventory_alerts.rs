pub(super) const INVENTORY: &str =
    r#"NOT jsonb_path_exists(v.tags, '$[*] ? (@ like_regex "^(template|backup)$" flag "i")')"#;
pub(super) const RUNNING: &str = "v.status='running'";

pub(super) fn duplicate_ip_networks() -> String {
    format!(
        "SELECT n.ip_address FROM vm_networks n
         WHERE n.vm_id=v.id AND EXISTS (
             SELECT 1 FROM vm_networks other
             JOIN vms v ON v.id=other.vm_id
             WHERE other.ip_address=n.ip_address AND other.role=n.role
               AND other.vm_id<>n.vm_id AND {RUNNING} AND {INVENTORY}
         )"
    )
}

pub(super) fn duplicate_ip_predicate(networks: &str) -> String {
    format!("{RUNNING} AND EXISTS({networks})")
}
