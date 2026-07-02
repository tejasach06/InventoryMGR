import { z } from 'zod';
import { Vm, VmPayload } from '../api/client';

export const platforms = ['proxmox', 'vmware'] as const;
export const statuses = ['running', 'powered_off', 'suspended', 'archived', 'decommissioned', 'unknown'] as const;
export const criticalities = ['low', 'medium', 'high', 'critical'] as const;
export const environments = ['production', 'development', 'testing', 'uat', 'dr', 'staging', 'sandbox'] as const;
export const lifecycles = ['planned', 'active', 'retiring', 'retired'] as const;

const optionalText = z.string().transform((v) => {
  const t = v.trim();
  return t.length === 0 ? null : t;
});

const requiredText = (label: string) =>
  z.string().transform((v) => v.trim()).pipe(z.string().min(1, `${label} is required.`));

const nonNegativeInteger = (label: string) =>
  z.coerce.number().int(`${label} must be a whole number.`).min(0, `${label} must be 0 or greater.`);

const optionalDate = z.string().transform((v, ctx) => {
  const t = v.trim();
  if (t.length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date must use YYYY-MM-DD.' });
    return z.NEVER;
  }
  return t;
});

export const vmFormSchema = z.object({
  name: requiredText('Name'),
  fqdn: optionalText,
  platform: z.enum(platforms),
  datacenter: optionalText,
  cluster: requiredText('Cluster'),
  node: optionalText,
  external_id: optionalText,
  sr_id: optionalText,
  status: z.enum(statuses),
  environment: z.enum(environments),
  criticality: z.enum(criticalities),
  lifecycle: z.enum(lifecycles),
  cpu_cores: nonNegativeInteger('CPU cores'),
  memory_mb: z.coerce.number().min(0, 'Memory must be 0 or greater.').transform((gb) => Math.round(gb * 1024)),
  os_family: z.union([z.literal(''), z.enum(['linux', 'windows'])]).transform((v) => (v === '' ? null : v)),
  os_distribution: optionalText,
  os_version: optionalText,
  owner: optionalText,
  business_owner: optionalText,
  department: optionalText,
  monitoring_enabled: z.boolean(),
  backup_enabled: z.boolean(),
  ha_enabled: z.boolean(),
  description: optionalText,
  tags: z.string().transform(splitList),
  last_patch_date: optionalDate,
  last_vuln_scan_date: optionalDate,
  security_remarks: optionalText,
  decommission_date: optionalDate,
  last_verified_at: optionalDate,
});

export interface VmFormValues {
  name: string;
  fqdn: string;
  platform: 'proxmox' | 'vmware';
  datacenter: string;
  cluster: string;
  node: string;
  external_id: string;
  sr_id: string;
  status: typeof statuses[number];
  environment: typeof environments[number];
  criticality: typeof criticalities[number];
  lifecycle: typeof lifecycles[number];
  cpu_cores: number | string;
  memory_mb: number | string;
  os_family: string;
  os_distribution: string;
  os_version: string;
  owner: string;
  business_owner: string;
  department: string;
  monitoring_enabled: boolean;
  backup_enabled: boolean;
  ha_enabled: boolean;
  description: string;
  tags: string;
  last_patch_date: string;
  last_vuln_scan_date: string;
  security_remarks: string;
  decommission_date: string;
  last_verified_at: string;
}

export type VmFormErrors = Partial<Record<keyof VmFormValues, string>>;

function splitList(value: string): string[] {
  return value.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function emptyVmFormValues(): VmFormValues {
  return {
    name: '', fqdn: '', platform: 'proxmox', datacenter: '', cluster: '',
    node: '', external_id: '', sr_id: '', status: 'unknown', environment: 'production',
    criticality: 'medium', lifecycle: 'active', cpu_cores: 0, memory_mb: 0,
    os_family: '', os_distribution: '', os_version: '',
    owner: '', business_owner: '', department: '',
    monitoring_enabled: false, backup_enabled: false, ha_enabled: false,
    description: '', tags: '', last_patch_date: '', last_vuln_scan_date: '',
    security_remarks: '', decommission_date: '', last_verified_at: '',
  };
}

export const createDefaultVmFormValues = emptyVmFormValues;

export function vmToFormValues(vm: Vm): VmFormValues {
  return {
    name: vm.name,
    fqdn: vm.fqdn ?? '',
    platform: vm.platform,
    datacenter: vm.datacenter ?? '',
    cluster: vm.cluster,
    node: vm.node ?? '',
    external_id: vm.external_id ?? '',
    sr_id: vm.sr_id ?? '',
    status: vm.status,
    environment: vm.environment,
    criticality: vm.criticality,
    lifecycle: vm.lifecycle,
    cpu_cores: vm.cpu_cores,
    memory_mb: vm.memory_mb / 1024,
    os_family: vm.os_family ?? '',
    os_distribution: vm.os_distribution ?? '',
    os_version: vm.os_version ?? '',
    owner: vm.owner ?? '',
    business_owner: vm.business_owner ?? '',
    department: vm.department ?? '',
    monitoring_enabled: vm.monitoring_enabled,
    backup_enabled: vm.backup_enabled,
    ha_enabled: vm.ha_enabled,
    description: vm.description ?? '',
    tags: vm.tags.join('; '),
    last_patch_date: vm.last_patch_date ?? '',
    last_vuln_scan_date: vm.last_vuln_scan_date ?? '',
    security_remarks: vm.security_remarks ?? '',
    decommission_date: vm.decommission_date ?? '',
    last_verified_at: vm.last_verified_at ?? '',
  };
}

export interface VmFormValidation {
  ok: boolean;
  data?: VmPayload;
  errors: VmFormErrors;
}

export function validateVmFormInput(values: VmFormValues): VmFormValidation {
  const parsed = vmFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false, errors: collectErrors(parsed.error) };
  return { ok: true, data: parsed.data as unknown as VmPayload, errors: {} };
}

export function collectErrors(error: z.ZodError): VmFormErrors {
  const errors: VmFormErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof VmFormValues | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
