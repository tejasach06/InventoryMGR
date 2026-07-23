'use client';

import { Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, NetworkRole, VmPayload } from '../api/client';
import {
  Alert, FieldError, PageHeader, PageTransition, RemoveButton, SectionCard, Skeleton, Spinner,
  cardClass, helpTextClass, inputClass, labelClass, primaryButtonClass,
  secondaryButtonClass, sectionTitleClass, selectClass, textareaClass,
} from '../components/ui';
import {
  collectErrors, criticalities, emptyVmFormValues, environments,
  platforms, statuses, VmFormErrors, VmFormValues, vmFormSchema, vmToFormValues, vmTypes,
} from '../lib/vmForm';

type FieldChange = (name: keyof VmFormValues, value: string | boolean) => void;

interface BaseFieldProps {
  name: keyof VmFormValues;
  label: string;
  values: VmFormValues;
  errors: VmFormErrors;
  onChange: FieldChange;
  required?: boolean;
}

function TextInput({ name, label, values, errors, onChange, required = false, type = 'text', disabled = false }: BaseFieldProps & { type?: string; disabled?: boolean }) {
  const errorId = `${String(name)}-error`;
  const value = values[name];
  return (
    <div>
      <label className={labelClass} htmlFor={String(name)}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input className={inputClass} id={String(name)} name={String(name)} type={type}
        value={typeof value === 'boolean' ? '' : value}
        onChange={(e) => onChange(name, e.target.value)}
        disabled={disabled}
        aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])} />
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

function SelectInput({ name, label, values, errors, onChange, options, required = false }: BaseFieldProps & { options: readonly string[] }) {
  const errorId = `${String(name)}-error`;
  return (
    <div>
      <label className={labelClass} htmlFor={String(name)}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <select className={selectClass} id={String(name)} name={String(name)} value={String(values[name])}
        onChange={(e) => onChange(name, e.target.value)}
        aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])}>
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

function ComboInput({ name, label, values, errors, onChange, options, required = false, type = 'text' }: BaseFieldProps & { options: string[]; type?: string }) {
  const errorId = `${String(name)}-error`;
  const value = values[name];
  const raw = typeof value === 'boolean' ? '' : String(value ?? '');
  const query = raw.trim().toLowerCase();
  const matches = query.length > 0 ? options.filter((o) => o.toLowerCase().includes(query) && o.toLowerCase() !== query).slice(0, 8) : [];
  return (
    <div>
      <label className={labelClass} htmlFor={String(name)}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input className={inputClass} id={String(name)} name={String(name)} type={type} autoComplete="off" value={raw}
        onChange={(e) => onChange(name, e.target.value)}
        aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])} />
      {matches.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] dark:bg-[var(--color-surface)]">
          {matches.map((m) => (
            <li key={m}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(name, m)}
              className="block w-full px-3 py-2 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-tertiary)]">{m}</button></li>
          ))}
        </ul>
      )}
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

function CheckboxInput({ name, label, values, onChange }: BaseFieldProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2.5 lg:self-end">
      <input className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] dark:bg-[var(--color-surface-tertiary)]"
        id={String(name)} name={String(name)} type="checkbox" checked={values[name] as boolean}
        onChange={(e) => onChange(name, e.target.checked)} />
      <label className="text-sm font-medium text-[var(--color-text-primary)]" htmlFor={String(name)}>{label}</label>
    </div>
  );
}


type DiskRow = { name: string; size: string; unit: 'GB' | 'TB'; storage: string; type: string };

function DiskRows({ disks, setDisks }: { disks: DiskRow[]; setDisks: Dispatch<SetStateAction<DiskRow[]>> }) {
  const update = (i: number, patch: Partial<DiskRow>) => setDisks((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <p className={labelClass}>Disks</p>
      <div className="space-y-3">
        {disks.map((d, i) => (
          <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Disk {i + 1} name</span>
              <input aria-label={`Disk ${i + 1} name`} className={inputClass} type="text" placeholder="Disk name" value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Size</span>
              <input aria-label={`Disk ${i + 1} size`} className={inputClass} type="number" min="0" placeholder="Size" value={d.size} onChange={(e) => update(i, { size: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Unit</span>
              <select aria-label={`Disk ${i + 1} unit`} className={selectClass} value={d.unit} onChange={(e) => update(i, { unit: e.target.value as 'GB' | 'TB' })}>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Storage</span>
              <input aria-label={`Disk ${i + 1} storage`} className={inputClass} type="text" placeholder="Storage" value={d.storage} onChange={(e) => update(i, { storage: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Type</span>
              <div className="flex gap-2 items-end">
                <input aria-label={`Disk ${i + 1} type`} className={inputClass} type="text" placeholder="Type" value={d.type} onChange={(e) => update(i, { type: e.target.value })} />
                {disks.length > 1 && (
                  <RemoveButton onClick={() => setDisks((rows) => rows.filter((_, idx) => idx !== i))} label={`Remove disk ${i + 1}`} />
                )}
              </div>
            </label>
          </div>
        ))}
      </div>
      <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={() => setDisks((rows) => [...rows, { name: '', size: '', unit: 'GB', storage: '', type: '' }])}>
        + Add another disk
      </button>
    </div>
  );
}

type IpRow = { ip: string; role: NetworkRole; vlan: string; gateway: string };

function IpRows({ ips, setIps }: { ips: IpRow[]; setIps: Dispatch<SetStateAction<IpRow[]>> }) {
  const update = (i: number, patch: Partial<IpRow>) => setIps((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div>
      <p className={labelClass}>IP addresses</p>
      <div className="space-y-3">
        {ips.map((r, i) => (
          <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>IP Address {i + 1}</span>
              <input aria-label={`IP address ${i + 1}`} className={inputClass} type="text" placeholder="e.g. 10.0.0.10" value={r.ip} onChange={(e) => update(i, { ip: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Role</span>
              <select aria-label={`IP role ${i + 1}`} className={selectClass} value={r.role} onChange={(e) => update(i, { role: e.target.value as NetworkRole })}>
                <option value="private">Private</option>
                <option value="public">Public</option>
                <option value="backup">Backup</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>VLAN</span>
              <input aria-label={`VLAN ${i + 1}`} className={inputClass} type="number" min="0" placeholder="VLAN" value={r.vlan} onChange={(e) => update(i, { vlan: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Gateway</span>
              <div className="flex gap-2 items-end">
                <input aria-label={`Gateway ${i + 1}`} className={inputClass} type="text" placeholder="Gateway" value={r.gateway} onChange={(e) => update(i, { gateway: e.target.value })} />
                {ips.length > 1 && (
                  <RemoveButton onClick={() => setIps((rows) => rows.filter((_, idx) => idx !== i))} label={`Remove IP address ${i + 1}`} />
                )}
              </div>
            </label>
          </div>
        ))}
      </div>
      <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={() => setIps((rows) => [...rows, { ip: '', role: 'private' as NetworkRole, vlan: '', gateway: '' }])}>
        + Add IP address
      </button>
    </div>
  );
}

const EMPTY_OPTIONS = { cpu: [], datacenter: [], disk: [], os: [], os_by_family: { linux: [], windows: [] } };

export function VmFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<VmFormValues>(() => emptyVmFormValues());
  const [errors, setErrors] = useState<VmFormErrors>({});
  const [disks, setDisks] = useState<DiskRow[]>([{ name: '', size: '', unit: 'GB', storage: '', type: '' }]);
  const [ips, setIps] = useState<IpRow[]>([{ ip: '', role: 'private' as NetworkRole, vlan: '', gateway: '' }]);

  const vmQuery = useQuery({ queryKey: ['vm', id], queryFn: () => api.getVm(id ?? ''), enabled: mode === 'edit' && Boolean(id) });
  const optionsQuery = useQuery({ queryKey: ['settings', 'options'], queryFn: api.getDropdownOptions });
  const ownersQuery = useQuery({ queryKey: ['vm-owners'], queryFn: api.listVmOwners });

  const options = optionsQuery.data ?? EMPTY_OPTIONS;
  const owners = ownersQuery.data ?? [];

  useEffect(() => {
    if (vmQuery.data) {
      setValues(vmToFormValues(vmQuery.data));
      setDisks(vmQuery.data.disks.length > 0 ? vmQuery.data.disks.map((d) => ({
        name: d.disk_name,
        size: String(d.size_gb >= 1024 ? d.size_gb / 1024 : d.size_gb),
        unit: (d.size_gb >= 1024 ? 'TB' : 'GB') as 'GB' | 'TB',
        storage: d.storage_name ?? '',
        type: d.storage_type ?? '',
      })) : [{ name: '', size: '', unit: 'GB' as const, storage: '', type: '' }]);
      setIps(vmQuery.data.networks.length > 0 ? vmQuery.data.networks.map((n) => ({
        ip: n.ip_address,
        role: n.role,
        vlan: n.vlan !== null ? String(n.vlan) : '',
        gateway: n.gateway ?? '',
      })) : [{ ip: '', role: 'private' as NetworkRole, vlan: '', gateway: '' }]);
    }
  }, [vmQuery.data]);

  const save = useMutation({
    mutationFn: (payload: VmPayload) => (mode === 'create' ? api.createVm(payload) : api.updateVm(id ?? '', payload)),
  });

  const title = useMemo(() => (mode === 'create' ? 'New VM' : `Edit ${vmQuery.data?.name ?? 'VM'}`), [mode, vmQuery.data]);

  function setField(name: keyof VmFormValues, value: string | boolean) {
    setValues((c) => {
      const next = { ...c, [name]: value };
      const decommissionAllowed = next.status === 'decommissioned' || next.vm_type === 'temporary';
      if (!decommissionAllowed) next.decommission_date = '';
      if (name === 'backup_enabled' && !value) next.backup_location = '';
      return next;
    });
    setErrors((c) => ({ ...c, [name]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = vmFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = collectErrors(parsed.error);
      setErrors(fieldErrors);
      const firstKey = Object.keys(fieldErrors)[0];
      if (firstKey) { document.getElementById(firstKey)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.getElementById(firstKey)?.focus(); }
      return;
    }
    setErrors({});
    try {
      const payload = {
        ...parsed.data,
        disks: disks
          .filter((d) => d.size && Number(d.size) > 0)
          .map((d, i) => ({
            disk_name: d.name.trim() || `disk-${i + 1}`,
            size_gb: d.unit === 'TB' ? Number(d.size) * 1024 : Number(d.size),
            storage_name: d.storage.trim() || null,
            storage_type: d.type.trim() || null,
            sort_order: i,
          })),
        networks: ips
          .filter((r) => r.ip.trim())
          .map((r, i) => ({
            ip_address: r.ip.trim(),
            role: r.role,
            vlan: r.vlan.trim() ? Number(r.vlan) : null,
            gateway: r.gateway.trim() || null,
            sort_order: i,
          })),
      };
      const vm = await save.mutateAsync(payload as VmPayload);
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      queryClient.invalidateQueries({ queryKey: ['vm-owners'] });
      queryClient.invalidateQueries({ queryKey: ['decommissions'] });
      queryClient.setQueryData(['vm', vm.id], vm);
      router.push(`/inventory/${vm.id}`);
    } catch { /* save.isError displayed above the form */ }
  }

  if (vmQuery.isLoading) return (
    <div className={cardClass + ' space-y-8'} role="status" aria-label="Loading form">
      {[1, 2, 3].map((s) => (<div key={s} className="space-y-4"><Skeleton className="h-5 w-32" /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div></div>))}
    </div>
  );
  if (vmQuery.isError) return <Alert>{detailMessage(vmQuery.error)}</Alert>;

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-5xl 2xl:max-w-6xl">
        <PageHeader title={title} />
        {save.isError ? <Alert>{detailMessage(save.error)}</Alert> : null}
        <form className="space-y-5 pb-20" onSubmit={submit} noValidate>
          <SectionCard title="Identity">
            <div className="grid gap-4 lg:grid-cols-3">
              <TextInput name="name" label="Name" values={values} errors={errors} onChange={setField} required />
              <TextInput name="fqdn" label="FQDN" values={values} errors={errors} onChange={setField} />
              <SelectInput name="platform" label="Platform" values={values} errors={errors} onChange={setField} options={platforms} required />
              <TextInput name="external_id" label="VM-ID" values={values} errors={errors} onChange={setField} />
              <TextInput name="sr_id" label="SR-ID" values={values} errors={errors} onChange={setField} />
              <SelectInput name="status" label="Status" values={values} errors={errors} onChange={setField} options={statuses} required />
              <SelectInput name="environment" label="Environment" values={values} errors={errors} onChange={setField} options={environments} required />
              <SelectInput name="criticality" label="Criticality" values={values} errors={errors} onChange={setField} options={criticalities} required />
              {/* ponytail: no `required` marker here — z.enum(vmTypes) already guarantees a valid
                  value, and Testing Library's getByLabelText does a raw textContent match that would
                  include the "*" suffix. Add `required` back only if a test switches to regex. */}
              <SelectInput name="vm_type" label="VM Type" values={values} errors={errors} onChange={setField} options={vmTypes} />
            </div>
          </SectionCard>

          <SectionCard title="Location">
            <div className="grid gap-4 lg:grid-cols-3">
              <ComboInput name="datacenter" label="Datacenter" values={values} errors={errors} onChange={setField} options={options.datacenter} />
              <TextInput name="cluster" label="Cluster" values={values} errors={errors} onChange={setField} required />
              <TextInput name="node" label="Node" values={values} errors={errors} onChange={setField} />
            </div>
          </SectionCard>

          <SectionCard title="Hardware">
            <div className="grid gap-4 lg:grid-cols-3">
              <ComboInput name="cpu_cores" label="CPU cores" values={values} errors={errors} onChange={setField} options={options.cpu} type="number" required />
              <TextInput name="memory_mb" label="Memory GB" values={values} errors={errors} onChange={setField} type="number" required />
            </div>
            <DiskRows disks={disks} setDisks={setDisks} />
          </SectionCard>

          <SectionCard title="Network">
            <IpRows ips={ips} setIps={setIps} />
          </SectionCard>

          <SectionCard title="Operating System">
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="os_family">OS family</label>
                <select className={selectClass} id="os_family" name="os_family" value={values.os_family} onChange={(e) => setField('os_family', e.target.value)}>
                  <option value="">—</option>
                  <option value="linux">Linux</option>
                  <option value="windows">Windows</option>
                </select>
              </div>
              <ComboInput name="os_distribution" label="Operating system" values={values} errors={errors} onChange={setField}
                options={values.os_family === 'linux' || values.os_family === 'windows' ? options.os_by_family[values.os_family] : options.os} />
              <TextInput name="os_version" label="Version" values={values} errors={errors} onChange={setField} />
            </div>
          </SectionCard>

          <SectionCard title="Ownership">
            <div className="grid gap-4 lg:grid-cols-3">
              <ComboInput name="owner" label="Owner" values={values} errors={errors} onChange={setField} options={owners} />
              <TextInput name="business_owner" label="Business Owner" values={values} errors={errors} onChange={setField} />
            </div>
          </SectionCard>

          <SectionCard title="Operations">
            <div className="grid gap-4 lg:grid-cols-4">
              <CheckboxInput name="monitoring_enabled" label="Monitoring enabled" values={values} errors={errors} onChange={setField} />
              <CheckboxInput name="backup_enabled" label="Backup enabled" values={values} errors={errors} onChange={setField} />
              <CheckboxInput name="ha_enabled" label="HA enabled" values={values} errors={errors} onChange={setField} />
              <CheckboxInput name="pmp_enabled" label="PMP access enabled" values={values} errors={errors} onChange={setField} />
            </div>
            {values.backup_enabled && (
              <div className="mt-3 transition-all duration-200 ease-in-out">
                <label className={labelClass} htmlFor="backup_location">Backup Location</label>
                <input className={inputClass} id="backup_location" name="backup_location" type="text"
                  placeholder="e.g. NAS-01 /backups, Veeam, S3 bucket name"
                  value={values.backup_location}
                  onChange={(e) => setField('backup_location', e.target.value)} />
              </div>
            )}
          </SectionCard>

          <SectionCard title="Security">
            <div className="grid gap-4 lg:grid-cols-3">
              <TextInput name="last_patch_date" label="Last Patch Date" values={values} errors={errors} onChange={setField} type="date" />
              <TextInput name="last_vuln_scan_date" label="Last Vuln Scan" values={values} errors={errors} onChange={setField} type="date" />
              <TextInput name="decommission_date" label="Decommission Date" values={values} errors={errors} onChange={setField} type="date" disabled={!(values.status === 'decommissioned' || values.vm_type === 'temporary')} />
              <TextInput name="last_verified_at" label="Last Verified" values={values} errors={errors} onChange={setField} type="date" />
              <div className="lg:col-span-3">
                <label className={labelClass} htmlFor="security_remarks">Security Remarks</label>
                <textarea className={textareaClass} id="security_remarks" name="security_remarks" value={values.security_remarks} onChange={(e) => setField('security_remarks', e.target.value)} rows={2} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Notes & Tags">
            <div className="grid gap-4">
              <TextInput name="tags" label="Tags (semicolon-separated)" values={values} errors={errors} onChange={setField} />
              <div>
                <label className={labelClass} htmlFor="description">Description</label>
                <textarea className={textareaClass} id="description" name="description" value={values.description} onChange={(e) => setField('description', e.target.value)} rows={3} />
              </div>
            </div>
            <p className={helpTextClass}>Applications are managed on the VM detail page.</p>
          </SectionCard>

          <div className="sticky bottom-0 flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white/85 px-5 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
            <button className={primaryButtonClass} type="submit" disabled={save.isPending}>
              {save.isPending ? <><Spinner /> Saving…</> : 'Save VM'}
            </button>
            <Link className={secondaryButtonClass} href={id ? `/inventory/${id}` : '/inventory'}>Cancel</Link>
          </div>
        </form>
      </section>
    </PageTransition>
  );
}
