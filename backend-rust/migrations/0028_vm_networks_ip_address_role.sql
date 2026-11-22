BEGIN;

-- Running upgrade 0027 -> 0028

CREATE INDEX ix_vm_networks_ip_address_role ON vm_networks (ip_address, role);

UPDATE alembic_version SET version_num='0028' WHERE alembic_version.version_num = '0027';

COMMIT;
