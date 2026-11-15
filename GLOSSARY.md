# Glossary

Canonical domain terminology for InventoryMGR.

## Virtual Host (Virtual Hosts)

A website name, domain, or host label mapped to one or more virtual machines (VMs).

- **Multiplicity**: A VM may host multiple virtual hosts; the same virtual host may also be served across multiple VMs (e.g. for high availability, reverse proxies, or load-balanced clusters).
- **Format**: Accepts standard domain names (e.g., `api.example.com`, `internal.corp`) as well as free-form website names and labels (e.g., `Intranet Portal`, `Staging Dashboard`).
- **Storage & Representation**: Stored and represented as an ordered list of strings (`virtual_hosts`), superseding the legacy single-string `fqdn` attribute.
