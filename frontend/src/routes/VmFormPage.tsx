import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { api, detailMessage, Vm, VmPayload } from '../api/client';
import { Alert, FieldError, PageHeader } from '../components/ui';

const platforms = ['proxmox', 'vmware'] as const;
const statuses = ['running', 'stopped', 'suspended', 'unknown'] as const;
const criticalities = ['low', 'medium', 'high', 'critical'] as const;
const lifecycles = ['planned', 'active', 'retiring', 'retired'] as const;

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

function collectErrors(error: z.ZodError): VmFormErrors {
  const errors: VmFormErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof VmFormValues | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function TextInput({ name, label, values, errors, onChange, required = false, type = 'text' }: { name: keyof VmFormValues; label: string; values: VmFormValues; errors: VmFormErrors; onChange: (name: keyof VmFormValues, value: string | boolean) => void; required?: boolean; type?: string }) {
  const errorId = `${String(name)}-error`;
  const value = values[name];
  return (
    <div className="field">
      <label htmlFor={String(name)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <input id={String(name)} name={String(name)} type={type} value={typeof value === 'boolean' ? '' : value} onChange={(event) => onChange(name, event.target.value)} aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])} />
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

function SelectInput({ name, label, values, errors, onChange, options, required = false }: { name: keyof VmFormValues; label: string; values: VmFormValues; errors: VmFormErrors; onChange: (name: keyof VmFormValues, value: string | boolean) => void; options: readonly string[]; required?: boolean }) {
  const errorId = `${String(name)}-error`;
  return (
    <div className="field">
      <label htmlFor={String(name)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <select id={String(name)} name={String(name)} value={String(values[name])} onChange={(event) => onChange(name, event.target.value)} aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

export function VmFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<VmFormValues>(() => emptyVmFormValues());
  const [errors, setErrors] = useState<VmFormErrors>({});
  const vmQuery = useQuery({ queryKey: ['vm', id], queryFn: () => api.getVm(id ?? ''), enabled: mode === 'edit' && Boolean(id) });

  useEffect(() => {
    if (vmQuery.data) setValues(vmToFormValues(vmQuery.data));
  }, [vmQuery.data]);

  const save = useMutation({
    mutationFn: (payload: VmPayload) => (mode === 'create' ? api.createVm(payload) : api.updateVm(id ?? '', payload)),
    onSuccess: (vm) => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      queryClient.setQueryData(['vm', vm.id], vm);
      navigate(`/inventory/${vm.id}`);
    },
  });

  const title = useMemo(() => (mode === 'create' ? 'New VM' : `Edit ${vmQuery.data?.name ?? 'VM'}`), [mode, vmQuery.data]);

  function setField(name: keyof VmFormValues, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = vmFormSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(collectErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  if (vmQuery.isLoading) return <div className="loading" role="status">Loading VM…</div>;
  if (vmQuery.isError) return <Alert>{detailMessage(vmQuery.error)}</Alert>;

  return (
    <section>
      <PageHeader title={title} actions={<Link className="secondary" to={id ? `/inventory/${id}` : '/inventory'}>Cancel</Link>} />
      {save.isError ? <Alert>{detailMessage(save.error)}</Alert> : null}
      <form className="card vm-form" onSubmit={submit} noValidate>
        <fieldset className="form-section">
          <legend>Identity</legend>
          <div className="form-section-grid">
            <TextInput name="name" label="Name" values={values} errors={errors} onChange={setField} required />
            <SelectInput name="platform" label="Platform" values={values} errors={errors} onChange={setField} options={platforms} required />
            <TextInput name="external_id" label="External ID" values={values} errors={errors} onChange={setField} />
            <SelectInput name="status" label="Status" values={values} errors={errors} onChange={setField} options={statuses} required />
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>Placement</legend>
          <div className="form-section-grid">
            <TextInput name="environment" label="Environment" values={values} errors={errors} onChange={setField} required />
            <TextInput name="datacenter" label="Datacenter" values={values} errors={errors} onChange={setField} />
            <TextInput name="cluster" label="Cluster" values={values} errors={errors} onChange={setField} required />
            <TextInput name="host" label="Host" values={values} errors={errors} onChange={setField} required />
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>Capacity</legend>
          <div className="form-section-grid">
            <TextInput name="cpu_cores" label="CPU cores" values={values} errors={errors} onChange={setField} type="number" required />
            <TextInput name="memory_mb" label="Memory MB" values={values} errors={errors} onChange={setField} type="number" required />
            <TextInput name="disk_gb" label="Disk GB" values={values} errors={errors} onChange={setField} type="number" required />
            <TextInput name="os_name" label="Operating system" values={values} errors={errors} onChange={setField} />
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>Operations</legend>
          <div className="form-section-grid">
            <TextInput name="owner" label="Owner" values={values} errors={errors} onChange={setField} />
            <TextInput name="backup_status" label="Backup status" values={values} errors={errors} onChange={setField} />
            <div className="field checkbox-field">
              <input id="ha_enabled" name="ha_enabled" type="checkbox" checked={values.ha_enabled} onChange={(event) => setField('ha_enabled', event.target.checked)} />
              <label htmlFor="ha_enabled">HA enabled</label>
            </div>
            <TextInput name="dr_tier" label="DR tier" values={values} errors={errors} onChange={setField} />
            <SelectInput name="criticality" label="Criticality" values={values} errors={errors} onChange={setField} options={criticalities} required />
            <SelectInput name="lifecycle" label="Lifecycle" values={values} errors={errors} onChange={setField} options={lifecycles} required />
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>Metadata</legend>
          <div className="form-section-grid">
            <TextInput name="ip_addresses" label="IP addresses" values={values} errors={errors} onChange={setField} />
            <TextInput name="tags" label="Tags" values={values} errors={errors} onChange={setField} />
            <TextInput name="last_verified_at" label="Last verified date" values={values} errors={errors} onChange={setField} type="date" />
            <div className="field wide">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" value={values.notes} onChange={(event) => setField('notes', event.target.value)} rows={4} />
            </div>
          </div>
          <p className="muted">Separate IP addresses and tags with semicolons. Required fields are marked with an asterisk.</p>
        </fieldset>
        <div className="form-actions wide">
          <button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save VM'}</button>
        </div>
      </form>
    </section>
  );
}
