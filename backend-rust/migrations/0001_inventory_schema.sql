BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001_initial

CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer');

CREATE TYPE platform AS ENUM ('proxmox', 'vmware');

CREATE TYPE vm_status AS ENUM ('running', 'stopped', 'suspended', 'unknown');

CREATE TYPE criticality AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE lifecycle AS ENUM ('planned', 'active', 'retiring', 'retired');

CREATE TYPE import_status AS ENUM ('previewed', 'committed', 'cancelled');

CREATE TYPE import_action AS ENUM ('create', 'update', 'conflict', 'invalid');

CREATE TABLE users (
    id UUID NOT NULL, 
    email VARCHAR(320) NOT NULL, 
    password_hash VARCHAR(255) NOT NULL, 
    role user_role NOT NULL, 
    is_active BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (email)
);

CREATE INDEX ix_users_email ON users (email);

CREATE TABLE vms (
    id UUID NOT NULL, 
    external_id VARCHAR(255), 
    name VARCHAR(255) NOT NULL, 
    platform platform NOT NULL, 
    datacenter VARCHAR(255), 
    cluster VARCHAR(255) NOT NULL, 
    status vm_status NOT NULL, 
    cpu_cores INTEGER NOT NULL, 
    memory_mb INTEGER NOT NULL, 
    disk_gb INTEGER NOT NULL, 
    os_name VARCHAR(255), 
    ip_addresses JSONB NOT NULL, 
    owner VARCHAR(255), 
    notes TEXT, 
    backup_status VARCHAR(255), 
    ha_enabled BOOLEAN NOT NULL, 
    criticality criticality NOT NULL, 
    lifecycle lifecycle NOT NULL, 
    tags JSONB NOT NULL, 
    last_verified_at DATE, 
    created_by_id UUID NOT NULL, 
    updated_by_id UUID NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_vms_name_nonempty CHECK (length(btrim(name)) > 0), 
    CONSTRAINT ck_vms_cluster_nonempty CHECK (length(btrim(cluster)) > 0), 
    CONSTRAINT ck_vms_cpu_cores_nonnegative CHECK (cpu_cores >= 0), 
    CONSTRAINT ck_vms_memory_mb_nonnegative CHECK (memory_mb >= 0), 
    CONSTRAINT ck_vms_disk_gb_nonnegative CHECK (disk_gb >= 0), 
    FOREIGN KEY(created_by_id) REFERENCES users (id), 
    FOREIGN KEY(updated_by_id) REFERENCES users (id)
);

CREATE INDEX ix_vms_platform ON vms (platform);

CREATE INDEX ix_vms_cluster ON vms (cluster);

CREATE INDEX ix_vms_status ON vms (status);

CREATE INDEX ix_vms_criticality ON vms (criticality);

CREATE INDEX ix_vms_lifecycle ON vms (lifecycle);

CREATE UNIQUE INDEX uq_vms_platform_external_id ON vms (platform, external_id) WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX uq_vms_platform_name_without_external_id ON vms (platform, lower(name)) WHERE external_id IS NULL;

CREATE TABLE csv_import_batches (
    id UUID NOT NULL, 
    filename VARCHAR(255) NOT NULL, 
    created_by_id UUID NOT NULL, 
    status import_status NOT NULL, 
    summary JSONB NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    committed_at TIMESTAMP WITH TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(created_by_id) REFERENCES users (id)
);

CREATE TABLE csv_import_rows (
    id UUID NOT NULL, 
    batch_id UUID NOT NULL, 
    row_number INTEGER NOT NULL, 
    raw JSONB NOT NULL, 
    normalized JSONB, 
    action import_action NOT NULL, 
    target_vm_id UUID, 
    errors JSONB NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(batch_id) REFERENCES csv_import_batches (id), 
    FOREIGN KEY(target_vm_id) REFERENCES vms (id) ON DELETE SET NULL, 
    CONSTRAINT uq_csv_import_rows_batch_row UNIQUE (batch_id, row_number)
);

INSERT INTO alembic_version (version_num) VALUES ('0001_initial') RETURNING alembic_version.version_num;

-- Running upgrade 0001_initial -> 0002_add_settings_and_sr_id

ALTER TABLE vms ADD COLUMN sr_id VARCHAR(50);

ALTER TABLE vms DROP CONSTRAINT ck_vms_disk_gb_nonnegative;

ALTER TABLE vms ALTER COLUMN disk_gb TYPE JSONB USING to_jsonb(ARRAY[disk_gb]);

ALTER TABLE vms ALTER COLUMN disk_gb DROP DEFAULT;

CREATE TYPE dropdown_category AS ENUM ('cpu', 'datacenter', 'disk', 'os');

CREATE TABLE dropdown_options (
    id UUID NOT NULL, 
    category dropdown_category NOT NULL, 
    value VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_dropdown_category_value UNIQUE (category, value)
);

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('726714b6-87a1-42a6-be04-672ec74ebc55', 'cpu', '2', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('560ee346-7400-4189-a7b5-2f6709d6d259', 'cpu', '4', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('ec715d12-769a-4536-b8ba-05200ed61ea8', 'cpu', '6', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('b3406695-dce4-4be9-b44f-de29f089ada0', 'cpu', '12', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('a15851be-124e-4f17-9827-2e5de4ee0f5f', 'datacenter', 'Office', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('6e65fb9e-aca1-4350-8cc2-7d61e0d94ec5', 'datacenter', 'IDC', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('2344f2d5-7ad5-40dc-832a-71023930971b', 'datacenter', 'DC', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('3b6435d2-c059-4b09-a1f6-68beb9746e2f', 'datacenter', 'RD', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('a3e99879-2215-49ec-ab9c-f0b9dbcb2081', 'disk', '50', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('e28b9bcd-b081-494b-ba00-0d43f8b44b1e', 'disk', '100', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('9084f2f8-cbc4-4550-890a-0789eb9805fb', 'disk', '150', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('775a325d-816f-477d-bed5-7fb071e3ac60', 'os', 'Linux', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) VALUES ('43c4e4b5-6c7d-4c82-bafb-16d1ddc78cb9', 'os', 'Windows', '2026-10-09 17:58:44.370262+00:00', '2026-10-09 17:58:44.370262+00:00');

UPDATE alembic_version SET version_num='0002_add_settings_and_sr_id' WHERE alembic_version.version_num = '0001_initial';

-- Running upgrade 0002_add_settings_and_sr_id -> 0003_os_family_and_backup

CREATE TYPE os_family AS ENUM ('linux', 'windows');

ALTER TABLE vms ADD COLUMN os_family os_family;

ALTER TABLE vms ADD COLUMN backup_enabled BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE vms ALTER COLUMN backup_enabled DROP DEFAULT;

ALTER TABLE vms DROP COLUMN backup_status;

ALTER TABLE dropdown_options ADD COLUMN family os_family;

UPDATE alembic_version SET version_num='0003_os_family_and_backup' WHERE alembic_version.version_num = '0002_add_settings_and_sr_id';

-- Running upgrade 0003_os_family_and_backup -> 0004_frd_schema_expansion

CREATE TYPE environment AS ENUM ('production', 'development', 'testing', 'uat', 'dr', 'staging', 'sandbox');

ALTER TYPE vm_status RENAME VALUE 'stopped' TO 'powered_off';

ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'decommissioned';

ALTER TABLE vms RENAME notes TO description;

ALTER TABLE vms ADD COLUMN fqdn VARCHAR(255);

ALTER TABLE vms ADD COLUMN node VARCHAR(255);

ALTER TABLE vms ADD COLUMN environment environment DEFAULT 'production' NOT NULL;

ALTER TABLE vms ALTER COLUMN environment DROP DEFAULT;

ALTER TABLE vms ADD COLUMN monitoring_enabled BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE vms ALTER COLUMN monitoring_enabled DROP DEFAULT;

ALTER TABLE vms ADD COLUMN os_distribution VARCHAR(255);

ALTER TABLE vms ADD COLUMN os_version VARCHAR(100);

ALTER TABLE vms ADD COLUMN business_owner VARCHAR(255);

ALTER TABLE vms ADD COLUMN technical_owner VARCHAR(255);

ALTER TABLE vms ADD COLUMN department VARCHAR(255);

ALTER TABLE vms ADD COLUMN last_patch_date DATE;

ALTER TABLE vms ADD COLUMN last_vuln_scan_date DATE;

ALTER TABLE vms ADD COLUMN security_remarks TEXT;

ALTER TABLE vms ADD COLUMN decommission_date DATE;

CREATE INDEX ix_vms_environment ON vms (environment);

CREATE INDEX ix_vms_monitoring_enabled ON vms (monitoring_enabled);

CREATE TABLE vm_disks (
    id UUID NOT NULL, 
    vm_id UUID NOT NULL, 
    disk_name VARCHAR(255) NOT NULL, 
    storage_name VARCHAR(255), 
    size_gb INTEGER DEFAULT '0' NOT NULL, 
    storage_type VARCHAR(100), 
    sort_order INTEGER DEFAULT '0' NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(vm_id) REFERENCES vms (id) ON DELETE CASCADE
);

CREATE INDEX ix_vm_disks_vm_id ON vm_disks (vm_id);

CREATE TABLE vm_networks (
    id UUID NOT NULL, 
    vm_id UUID NOT NULL, 
    ip_address VARCHAR(50) NOT NULL, 
    vlan INTEGER, 
    gateway VARCHAR(50), 
    sort_order INTEGER DEFAULT '0' NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(vm_id) REFERENCES vms (id) ON DELETE CASCADE
);

CREATE INDEX ix_vm_networks_vm_id ON vm_networks (vm_id);

CREATE TABLE vm_applications (
    id UUID NOT NULL, 
    vm_id UUID NOT NULL, 
    app_name VARCHAR(255) NOT NULL, 
    app_owner VARCHAR(255), 
    description TEXT, 
    PRIMARY KEY (id), 
    FOREIGN KEY(vm_id) REFERENCES vms (id) ON DELETE CASCADE, 
    CONSTRAINT uq_vm_applications_vm_app UNIQUE (vm_id, app_name)
);

CREATE INDEX ix_vm_applications_vm_id ON vm_applications (vm_id);

CREATE TABLE vm_attachments (
    id UUID NOT NULL, 
    vm_id UUID NOT NULL, 
    filename VARCHAR(255) NOT NULL, 
    file_path VARCHAR(500) NOT NULL, 
    file_size INTEGER DEFAULT '0' NOT NULL, 
    mime_type VARCHAR(100) NOT NULL, 
    uploaded_by_id UUID NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(vm_id) REFERENCES vms (id) ON DELETE CASCADE, 
    FOREIGN KEY(uploaded_by_id) REFERENCES users (id)
);

CREATE INDEX ix_vm_attachments_vm_id ON vm_attachments (vm_id);

CREATE TABLE audit_log (
    id UUID NOT NULL, 
    vm_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    field_name VARCHAR(100) NOT NULL, 
    old_value TEXT, 
    new_value TEXT, 
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(vm_id) REFERENCES vms (id) ON DELETE CASCADE, 
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_audit_log_vm_id_changed_at ON audit_log (vm_id, changed_at);

INSERT INTO vm_networks (id, vm_id, ip_address, sort_order)
        SELECT
            gen_random_uuid(),
            v.id,
            ip_elem,
            (ordinality - 1)::integer
        FROM vms v,
             jsonb_array_elements_text(v.ip_addresses) WITH ORDINALITY AS t(ip_elem, ordinality)
        WHERE jsonb_array_length(v.ip_addresses) > 0;

INSERT INTO vm_disks (id, vm_id, disk_name, size_gb, sort_order)
        SELECT
            gen_random_uuid(),
            v.id,
            'scsi' || (ordinality - 1)::text,
            (size_elem)::integer,
            (ordinality - 1)::integer
        FROM vms v,
             jsonb_array_elements_text(v.disk_gb) WITH ORDINALITY AS t(size_elem, ordinality)
        WHERE jsonb_array_length(v.disk_gb) > 0;

ALTER TABLE vms DROP COLUMN ip_addresses;

ALTER TABLE vms DROP COLUMN disk_gb;

UPDATE alembic_version SET version_num='0004_frd_schema_expansion' WHERE alembic_version.version_num = '0003_os_family_and_backup';

-- Running upgrade 0004_frd_schema_expansion -> 0005

ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TYPE vm_status ADD VALUE IF NOT EXISTS 'decommissioned';

ALTER TABLE vms ADD COLUMN health_score INTEGER DEFAULT '0' NOT NULL;

CREATE INDEX ix_vms_health_score ON vms (health_score);

UPDATE vms SET health_score = (
            CASE WHEN description IS NOT NULL AND length(trim(description)) > 0 THEN 10 ELSE 0 END
            + CASE WHEN business_owner IS NOT NULL OR technical_owner IS NOT NULL OR owner IS NOT NULL THEN 15 ELSE 0 END
            + CASE WHEN monitoring_enabled THEN 10 ELSE 0 END
            + CASE WHEN decommission_date IS NOT NULL THEN 15 ELSE 0 END
            + CASE WHEN EXISTS(SELECT 1 FROM vm_applications WHERE vm_applications.vm_id = vms.id) THEN 20 ELSE 0 END
            + CASE WHEN EXISTS(SELECT 1 FROM vm_networks WHERE vm_networks.vm_id = vms.id) THEN 15 ELSE 0 END
            + CASE WHEN EXISTS(SELECT 1 FROM vm_disks WHERE vm_disks.vm_id = vms.id) THEN 15 ELSE 0 END
        );

UPDATE alembic_version SET version_num='0005' WHERE alembic_version.version_num = '0004_frd_schema_expansion';

-- Running upgrade 0005 -> 0006

DROP INDEX ix_vm_attachments_vm_id;

DROP TABLE vm_attachments;

UPDATE alembic_version SET version_num='0006' WHERE alembic_version.version_num = '0005';

-- Running upgrade 0006 -> 0007

CREATE TYPE vm_type AS ENUM ('permanent', 'temporary');

ALTER TABLE vms ADD COLUMN vm_type vm_type DEFAULT 'permanent' NOT NULL;

CREATE INDEX ix_vms_vm_type ON vms (vm_type);

UPDATE alembic_version SET version_num='0007' WHERE alembic_version.version_num = '0006';

-- Running upgrade 0007 -> 0008

ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}'::jsonb NOT NULL;

UPDATE alembic_version SET version_num='0008' WHERE alembic_version.version_num = '0007';

-- Running upgrade 0008 -> 0009

ALTER TABLE vms ADD COLUMN pmp_enabled BOOLEAN DEFAULT false NOT NULL;

CREATE INDEX ix_vms_pmp_enabled ON vms (pmp_enabled);

ALTER TABLE vms DROP COLUMN department;

UPDATE alembic_version SET version_num='0009' WHERE alembic_version.version_num = '0008';

-- Running upgrade 0009 -> 0010

ALTER TABLE vms ADD COLUMN backup_location VARCHAR(500);

UPDATE alembic_version SET version_num='0010' WHERE alembic_version.version_num = '0009';

-- Running upgrade 0010 -> 0011

COMMIT;

ALTER TYPE import_action ADD VALUE IF NOT EXISTS 'unchanged' AFTER 'update';

ALTER TABLE csv_import_rows ADD COLUMN changes JSONB DEFAULT '{}' NOT NULL;

ALTER TABLE csv_import_batches ADD COLUMN field_changes JSONB DEFAULT '{}' NOT NULL;

ALTER TABLE csv_import_batches ADD COLUMN ignored_columns JSONB DEFAULT '[]' NOT NULL;

UPDATE alembic_version SET version_num='0011' WHERE alembic_version.version_num = '0010';

-- Running upgrade 0011 -> 0012

CREATE TYPE network_role AS ENUM ('private', 'public', 'backup');

ALTER TABLE vm_networks ADD COLUMN role network_role DEFAULT 'private' NOT NULL;

UPDATE alembic_version SET version_num='0012' WHERE alembic_version.version_num = '0011';

-- Running upgrade 0012 -> 0013

CREATE TABLE app_settings (
    key VARCHAR(100) NOT NULL, 
    value VARCHAR(255) NOT NULL, 
    PRIMARY KEY (key)
);

CREATE TABLE decommission_acks (
    id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    vm_id UUID NOT NULL, 
    acked_date DATE NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_decommission_ack_user_vm UNIQUE (user_id, vm_id), 
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
    FOREIGN KEY(vm_id) REFERENCES vms (id) ON DELETE CASCADE
);

INSERT INTO app_settings (key, value) VALUES ('decommission_notify_days', '30');

UPDATE alembic_version SET version_num='0013' WHERE alembic_version.version_num = '0012';

-- Running upgrade 0013 -> 0014

COMMIT;

ALTER TYPE dropdown_category ADD VALUE IF NOT EXISTS 'cluster';

BEGIN;

CREATE TYPE storage_vendor AS ENUM ('synology', 'netapp');

CREATE TABLE storage_arrays (
    id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    vendor storage_vendor NOT NULL, 
    model VARCHAR(255), 
    mgmt_host VARCHAR(255), 
    datacenter VARCHAR(255), 
    description TEXT, 
    total_capacity_gb INTEGER DEFAULT '0' NOT NULL, 
    used_capacity_gb INTEGER DEFAULT '0' NOT NULL, 
    notes TEXT, 
    created_by_id UUID NOT NULL, 
    updated_by_id UUID NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_storage_arrays_name_nonempty CHECK (length(btrim(name)) > 0), 
    FOREIGN KEY(created_by_id) REFERENCES users (id), 
    FOREIGN KEY(updated_by_id) REFERENCES users (id)
);

CREATE TABLE storage_volumes (
    id UUID NOT NULL, 
    array_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    capacity_gb INTEGER DEFAULT '0' NOT NULL, 
    used_gb INTEGER DEFAULT '0' NOT NULL, 
    notes TEXT, 
    sort_order INTEGER DEFAULT '0' NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(array_id) REFERENCES storage_arrays (id) ON DELETE CASCADE
);

CREATE TABLE storage_luns (
    id UUID NOT NULL, 
    volume_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    size_gb INTEGER DEFAULT '0' NOT NULL, 
    used_gb INTEGER, 
    target_iqn VARCHAR(255), 
    cluster VARCHAR(255), 
    status VARCHAR(100), 
    sort_order INTEGER DEFAULT '0' NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(volume_id) REFERENCES storage_volumes (id) ON DELETE CASCADE
);

CREATE TABLE storage_nfs_shares (
    id UUID NOT NULL, 
    volume_id UUID NOT NULL, 
    export_path VARCHAR(500) NOT NULL, 
    used_gb INTEGER, 
    allowed_clients TEXT, 
    notes TEXT, 
    sort_order INTEGER DEFAULT '0' NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(volume_id) REFERENCES storage_volumes (id) ON DELETE CASCADE
);

INSERT INTO dropdown_options (id, category, value, created_at, updated_at) SELECT gen_random_uuid(), 'cluster', cluster, now(), now() FROM (SELECT DISTINCT cluster FROM vms WHERE cluster IS NOT NULL) s;

INSERT INTO app_settings (key, value) VALUES ('storage_usage_warn_pct', '85');

UPDATE alembic_version SET version_num='0014' WHERE alembic_version.version_num = '0013';

-- Running upgrade 0014 -> 0015

CREATE TABLE physical_clusters (
    id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description TEXT, 
    notes TEXT, 
    created_by_id UUID NOT NULL, 
    updated_by_id UUID NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_physical_clusters_name_nonempty CHECK (length(btrim(name)) > 0), 
    FOREIGN KEY(created_by_id) REFERENCES users (id), 
    FOREIGN KEY(updated_by_id) REFERENCES users (id)
);

CREATE TABLE physical_nodes (
    id UUID NOT NULL, 
    cluster_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    cpu_model VARCHAR(255), 
    cpu_cores INTEGER DEFAULT '0' NOT NULL, 
    cpu_threads INTEGER DEFAULT '0' NOT NULL, 
    ram_total_gb INTEGER DEFAULT '0' NOT NULL, 
    ram_used_gb INTEGER, 
    storage_usable_gb INTEGER DEFAULT '0' NOT NULL, 
    datacenter VARCHAR(255), 
    rack VARCHAR(100), 
    rack_unit VARCHAR(50), 
    ip_addresses JSONB DEFAULT '[]' NOT NULL, 
    notes TEXT, 
    sort_order INTEGER DEFAULT '0' NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_physical_nodes_name_nonempty CHECK (length(btrim(name)) > 0), 
    CONSTRAINT ck_physical_nodes_cpu_cores_nonnegative CHECK (cpu_cores >= 0), 
    CONSTRAINT ck_physical_nodes_cpu_threads_nonnegative CHECK (cpu_threads >= 0), 
    CONSTRAINT ck_physical_nodes_ram_total_nonnegative CHECK (ram_total_gb >= 0), 
    CONSTRAINT ck_physical_nodes_storage_nonnegative CHECK (storage_usable_gb >= 0), 
    FOREIGN KEY(cluster_id) REFERENCES physical_clusters (id) ON DELETE CASCADE
);

UPDATE alembic_version SET version_num='0015' WHERE alembic_version.version_num = '0014';

-- Running upgrade 0015 -> 0016

ALTER TABLE physical_nodes ADD COLUMN created_by_id UUID;

ALTER TABLE physical_nodes ADD FOREIGN KEY(created_by_id) REFERENCES users (id);

ALTER TABLE physical_nodes ADD COLUMN updated_by_id UUID;

ALTER TABLE physical_nodes ADD FOREIGN KEY(updated_by_id) REFERENCES users (id);

ALTER TABLE physical_nodes ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL;

ALTER TABLE physical_nodes ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL;

UPDATE physical_nodes n
        SET created_by_id = c.created_by_id,
            updated_by_id = c.updated_by_id
        FROM physical_clusters c
        WHERE n.cluster_id = c.id;

ALTER TABLE physical_nodes ALTER COLUMN created_by_id SET NOT NULL;

ALTER TABLE physical_nodes ALTER COLUMN updated_by_id SET NOT NULL;

UPDATE alembic_version SET version_num='0016' WHERE alembic_version.version_num = '0015';

-- Running upgrade 0016 -> 0017

UPDATE vms SET status = 'decommissioned' WHERE status = 'archived';

UPDATE vms SET status = 'powered_off' WHERE status = 'suspended';

ALTER TYPE vm_status RENAME TO vm_status_old;

CREATE TYPE vm_status AS ENUM ('running', 'powered_off', 'decommissioned', 'unknown');

ALTER TABLE vms ALTER COLUMN status TYPE vm_status USING status::text::vm_status;

DROP TYPE vm_status_old;

UPDATE alembic_version SET version_num='0017' WHERE alembic_version.version_num = '0016';

-- Running upgrade 0017 -> 0018

ALTER TABLE users ADD COLUMN auth_source VARCHAR(16) DEFAULT 'local' NOT NULL;

CREATE TABLE ldap_config (
    id SERIAL NOT NULL, 
    enabled BOOLEAN DEFAULT false NOT NULL, 
    server_uri VARCHAR(255) NOT NULL, 
    start_tls BOOLEAN DEFAULT false NOT NULL, 
    verify_tls BOOLEAN DEFAULT true NOT NULL, 
    bind_dn VARCHAR(512), 
    bind_password_encrypted TEXT, 
    user_base_dn VARCHAR(512) NOT NULL, 
    user_filter VARCHAR(512) DEFAULT '(uid={username})' NOT NULL, 
    email_attribute VARCHAR(64) DEFAULT 'mail' NOT NULL, 
    group_attribute VARCHAR(64) DEFAULT 'memberOf' NOT NULL, 
    admin_group_dn VARCHAR(512), 
    editor_group_dn VARCHAR(512), 
    viewer_group_dn VARCHAR(512), 
    default_role user_role DEFAULT 'viewer' NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_ldap_config_singleton CHECK (id = 1)
);

UPDATE alembic_version SET version_num='0018' WHERE alembic_version.version_num = '0017';

-- Running upgrade 0018 -> 0019

ALTER TABLE csv_import_rows ADD COLUMN warnings JSONB DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE csv_import_rows ALTER COLUMN warnings DROP DEFAULT;

DROP INDEX uq_vms_platform_external_id;

CREATE UNIQUE INDEX uq_vms_platform_external_id ON vms (platform, external_id) WHERE external_id IS NOT NULL AND platform <> 'proxmox';

UPDATE alembic_version SET version_num='0019' WHERE alembic_version.version_num = '0018';

-- Running upgrade 0019 -> 0020

CREATE INDEX ix_audit_log_powered_off ON audit_log (vm_id, changed_at DESC) WHERE field_name = 'status' AND new_value = 'powered_off';

UPDATE alembic_version SET version_num='0020' WHERE alembic_version.version_num = '0019';

-- Running upgrade 0020 -> 0021

ALTER TABLE vm_networks DROP COLUMN gateway;

ALTER TABLE vm_networks DROP COLUMN vlan;

ALTER TABLE vms DROP COLUMN os_name;

UPDATE alembic_version SET version_num='0021' WHERE alembic_version.version_num = '0020';

-- Running upgrade 0021 -> 0022

DROP INDEX IF EXISTS ix_vms_lifecycle;

ALTER TABLE vms DROP COLUMN IF EXISTS lifecycle;

DROP TYPE lifecycle;

UPDATE alembic_version SET version_num='0022' WHERE alembic_version.version_num = '0021';

-- Running upgrade 0022 -> 0023

ALTER TYPE import_action ADD VALUE IF NOT EXISTS 'decommission';

ALTER TABLE csv_import_batches ADD COLUMN full_inventory BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='0023' WHERE alembic_version.version_num = '0022';

-- Running upgrade 0023 -> debd8a48a62e

UPDATE vm_networks SET ip_address = btrim(split_part(btrim(ip_address), '/', 1)) WHERE ip_address <> btrim(split_part(btrim(ip_address), '/', 1));

UPDATE alembic_version SET version_num='debd8a48a62e' WHERE alembic_version.version_num = '0023';

-- Running upgrade debd8a48a62e -> 0024

CREATE TABLE backup_jobs (
    id UUID NOT NULL, 
    kind VARCHAR(20) NOT NULL, 
    status VARCHAR(20) NOT NULL, 
    filename VARCHAR(255), 
    size_bytes BIGINT, 
    error TEXT, 
    user_id UUID, 
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    finished_at TIMESTAMP WITH TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_backup_jobs_started_at ON backup_jobs (started_at);

UPDATE alembic_version SET version_num='0024' WHERE alembic_version.version_num = 'debd8a48a62e';

COMMIT;

