import { z } from 'zod';
import { Vm, VmPayload } from '../api/client';

export const platforms = ['proxmox', 'vmware'] as const;
export const statuses = ['running', 'stopped', 'suspended', 'unknown'] as const;
export const criticalities = ['low', 'medium', 'high', 'critical'] as const;
export const lifecycles = ['planned', 'active', 'retiring', 'retired'] as const;

const optionalText = z.string().transform((value) => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
});

const requiredText = (label: string) => z.string().transform((value) => value.trim()).pipe(z.string().min(1, `${label} is required.`));
const nonNegativeInteger = (label: string) => z.coerce.number().int(`${label} must be a whole number.`).min(0, `${label} must be 0 or greater.`);

export const vmFormSchema = z.object({
  name: requiredText('Name'),
  platform: z.enum(platforms),
  environment: requiredText('Environment'),
  datacenter: optionalText,
  cluster: requiredText('Cluster'),
  host: requiredText('Host'),
  external_id: optionalText,
  status: z.enum(statuses),
  cpu_cores: nonNegativeInteger('CPU cores'),
  memory_mb: nonNegativeInteger('Memory MB'),
  disk_gb: nonNegativeInteger('Disk GB'),
  os_name: optionalText,
  ip_addresses: z.string().transform(splitList),
  owner: optionalText,
  notes: optionalText,
  backup_status: optionalText,
  ha_enabled: z.boolean(),
  dr_tier: optionalText,
  criticality: z.enum(criticalities),
  lifecycle: z.enum(lifecycles),
  tags: z.string().transform(splitList),
  last_verified_at: z.string().transform((value, context) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Last verified date must use YYYY-MM-DD.' });
      return z.NEVER;
    }
    return trimmed;
  }),
});

export interface VmFormValues {
  name: string;
  platform: 'proxmox' | 'vmware';
  environment: string;
  datacenter: string;
  cluster: string;
  host: string;
  external_id: string;
  status: 'running' | 'stopped' | 'suspended' | 'unknown';
  cpu_cores: number | string;
  memory_mb: number | string;
  disk_gb: number | string;
  os_name: string;
  ip_addresses: string;
  owner: string;
  notes: string;
  backup_status: string;
  ha_enabled: boolean;
  dr_tier: string;
  criticality: 'low' | 'medium' | 'high' | 'critical';
  lifecycle: 'planned' | 'active' | 'retiring' | 'retired';
  tags: string;
  last_verified_at: string;
}

export type VmFormErrors = Partial<Record<keyof VmFormValues, string>>;

function splitList(value: string): string[] {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function emptyVmFormValues(): VmFormValues {
  return {
    name: '',
    platform: 'proxmox',
    environment: '',
    datacenter: '',
    cluster: '',
    host: '',
    external_id: '',
    status: 'unknown',
    cpu_cores: 0,
    memory_mb: 0,
    disk_gb: 0,
    os_name: '',
    ip_addresses: '',
    owner: '',
    notes: '',
    backup_status: '',
    ha_enabled: false,
    dr_tier: '',
    criticality: 'medium',
    lifecycle: 'active',
    tags: '',
    last_verified_at: '',
  };
}

export const createDefaultVmFormValues = emptyVmFormValues;

export interface VmFormValidation {
  ok: boolean;
  data?: VmPayload;
  errors: VmFormErrors;
}

export function validateVmFormInput(values: VmFormValues): VmFormValidation {
  const parsed = vmFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, errors: collectErrors(parsed.error) };
  }
  return { ok: true, data: parsed.data, errors: {} };
}

export function vmToFormValues(vm: Vm): VmFormValues {
  return {
    name: vm.name,
    platform: vm.platform,
    environment: vm.environment,
    datacenter: vm.datacenter ?? '',
    cluster: vm.cluster,
    host: vm.host,
    external_id: vm.external_id ?? '',
    status: vm.status,
    cpu_cores: vm.cpu_cores,
    memory_mb: vm.memory_mb,
    disk_gb: vm.disk_gb,
    os_name: vm.os_name ?? '',
    ip_addresses: vm.ip_addresses.join('; '),
    owner: vm.owner ?? '',
    notes: vm.notes ?? '',
    backup_status: vm.backup_status ?? '',
    ha_enabled: vm.ha_enabled,
    dr_tier: vm.dr_tier ?? '',
    criticality: vm.criticality,
    lifecycle: vm.lifecycle,
    tags: vm.tags.join('; '),
    last_verified_at: vm.last_verified_at ?? '',
  };
}

export function collectErrors(error: z.ZodError): VmFormErrors {
  const errors: VmFormErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof VmFormValues | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
