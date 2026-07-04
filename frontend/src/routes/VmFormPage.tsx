'use client';

import { Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, VmPayload } from '../api/client';
import {
  Alert, FieldError, PageHeader, PageTransition, Skeleton, Spinner,
  cardClass, helpTextClass, inputClass, labelClass, primaryButtonClass,
  secondaryButtonClass, sectionTitleClass, selectClass, textareaClass,
} from '../components/ui';
import {
  collectErrors, criticalities, emptyVmFormValues, environments,
  platforms, statuses, VmFormErrors, VmFormValues, vmFormSchema, vmToFormValues,
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
        <ul className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {matches.map((m) => (
            <li key={m}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(name, m)}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">{m}</button></li>
          ))}
        </ul>
      )}
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

function CheckboxInput({ name, label, values, onChange }: BaseFieldProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900 lg:self-end">
      <input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:focus:ring-blue-400"
        id={String(name)} name={String(name)} type="checkbox" checked={values[name] as boolean}
        onChange={(e) => onChange(name, e.target.checked)} />
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={String(name)}>{label}</label>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-900/[0.04] dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none">
      <h2 className={sectionTitleClass}>{title}</h2>
      <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">{children}</div>
    </section>
  );
}

type DiskRow = { name: string; size: string; unit: 'GB' | 'TB'; storage: string; type: string };

const rowRemoveClass = 'inline-flex h-[42px] w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-lg leading-none text-slate-400 transition-colors hover:border-red-300 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-slate-700 dark:text-slate-500 dark:hover:border-red-500/40 dark:hover:text-red-400';
const rowAddClass = 'mt-2.5 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';

function DiskRows({ disks, setDisks }: { disks: DiskRow[]; setDisks: Dispatch<SetStateAction<DiskRow[]>> }) {
  const update = (i: number, patch: Partial<DiskRow>) => setDisks((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
      <p className={labelClass}>Disks</p>
      <div className="space-y-2">
        {disks.map((d, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <input aria-label={`Disk ${i + 1} name`} className={inputClass} type="text" placeholder="Disk name" value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
            </div>
            <div className="w-24">
              <input aria-label={`Disk ${i + 1} size`} className={inputClass} type="number" min="0" placeholder="Size" value={d.size} onChange={(e) => update(i, { size: e.target.value })} />
            </div>
            <div className="w-20">
              <select aria-label={`Disk ${i + 1} unit`} className={selectClass} value={d.unit} onChange={(e) => update(i, { unit: e.target.value as 'GB' | 'TB' })}>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </div>
            <div className="flex-1">
              <input aria-label={`Disk ${i + 1} storage`} className={inputClass} type="text" placeholder="Storage" value={d.storage} onChange={(e) => update(i, { storage: e.target.value })} />
            </div>
            <div className="w-28">
              <input aria-label={`Disk ${i + 1} type`} className={inputClass} type="text" placeholder="Type" value={d.type} onChange={(e) => update(i, { type: e.target.value })} />
            </div>
            {disks.length > 1 && (
              <button type="button" aria-label={`Remove disk ${i + 1}`} className={rowRemoveClass} onClick={() => setDisks((rows) => rows.filter((_, idx) => idx !== i))}>×</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className={rowAddClass} onClick={() => setDisks((rows) => [...rows, { name: '', size: '', unit: 'GB', storage: '', type: '' }])}>
        <span aria-hidden="true">+</span> Add another disk
      </button>
    </div>
  );
}

type IpRow = { ip: string; vlan: string; gateway: string };

function IpRows({ ips, setIps }: { ips: IpRow[]; setIps: Dispatch<SetStateAction<IpRow[]>> }) {
  const update = (i: number, patch: Partial<IpRow>) => setIps((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div>
      <p className={labelClass}>IP addresses</p>
      <div className="space-y-2">
        {ips.map((r, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <input aria-label={`IP address ${i + 1}`} className={inputClass} type="text" placeholder="e.g. 10.0.0.10" value={r.ip} onChange={(e) => update(i, { ip: e.target.value })} />
            </div>
            <div className="w-24">
              <input aria-label={`VLAN ${i + 1}`} className={inputClass} type="number" min="0" placeholder="VLAN" value={r.vlan} onChange={(e) => update(i, { vlan: e.target.value })} />
            </div>
            <div className="flex-1">
              <input aria-label={`Gateway ${i + 1}`} className={inputClass} type="text" placeholder="Gateway" value={r.gateway} onChange={(e) => update(i, { gateway: e.target.value })} />
            </div>
            {ips.length > 1 && (
              <button type="button" aria-label={`Remove IP address ${i + 1}`} className={rowRemoveClass} onClick={() => setIps((rows) => rows.filter((_, idx) => idx !== i))}>×</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className={rowAddClass} onClick={() => setIps((rows) => [...rows, { ip: '', vlan: '', gateway: '' }])}>
        <span aria-hidden="true">+</span> Add IP address
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
  const [ips, setIps] = useState<IpRow[]>([{ ip: '', vlan: '', gateway: '' }]);

  const vmQuery = useQuery({ queryKey: ['vm', id], queryFn: () => api.getVm(id ?? ''), enabled: mode === 'edit' && Boolean(id) });
  const optionsQuery = useQuery({ queryKey: ['settings', 'options'], queryFn: api.getDropdownOptions });
  const ownersQuery = useQuery({ queryKey: ['vm-owners'], queryFn: api.listVmOwners });

  const options = optionsQuery.data ?? EMPTY_OPTIONS;
  const owners = ownersQuery.data ?? [];

  useEffect(() => { if (vmQuery.data) setValues(vmToFormValues(vmQuery.data)); }, [vmQuery.data]);

  const save = useMutation({
    mutationFn: (payload: VmPayload) => (mode === 'create' ? api.createVm(payload) : api.updateVm(id ?? '', payload)),
  });

  const title = useMemo(() => (mode === 'create' ? 'New VM' : `Edit ${vmQuery.data?.name ?? 'VM'}`), [mode, vmQuery.data]);

  function setField(name: keyof VmFormValues, value: string | boolean) {
    setValues((c) => {
      const next = { ...c, [name]: value };
      if (name === 'status' && value !== 'decommissioned') next.decommission_date = '';
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
      const vm = await save.mutateAsync(parsed.data as unknown as VmPayload);
      if (mode === 'create') {
        const sub: Promise<unknown>[] = [];
        disks
          .filter((d) => Number(d.size) > 0)
          .forEach((d, i) => sub.push(api.addDisk(vm.id, {
            disk_name: d.name.trim() || `disk-${i + 1}`,
            size_gb: d.unit === 'TB' ? Number(d.size) * 1024 : Number(d.size),
            storage_name: d.storage.trim() || null,
            storage_type: d.type.trim() || null,
            sort_order: i,
          })));
        ips
          .filter((r) => r.ip.trim())
          .forEach((r, i) => sub.push(api.addNetwork(vm.id, {
            ip_address: r.ip.trim(),
            vlan: r.vlan.trim() ? Number(r.vlan) : null,
            gateway: r.gateway.trim() || null,
            sort_order: i,
          })));
        await Promise.allSettled(sub);
      }
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      queryClient.invalidateQueries({ queryKey: ['vm-owners'] });
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
          <FormSection title="Identity">
            <div className="grid gap-4 lg:grid-cols-3">
              <TextInput name="name" label="Name" values={values} errors={errors} onChange={setField} required />
              <TextInput name="fqdn" label="FQDN" values={values} errors={errors} onChange={setField} />
              <SelectInput name="platform" label="Platform" values={values} errors={errors} onChange={setField} options={platforms} required />
              <TextInput name="external_id" label="VM-ID" values={values} errors={errors} onChange={setField} />
              <TextInput name="sr_id" label="SR-ID" values={values} errors={errors} onChange={setField} />
              <SelectInput name="status" label="Status" values={values} errors={errors} onChange={setField} options={statuses} required />
              <SelectInput name="environment" label="Environment" values={values} errors={errors} onChange={setField} options={environments} required />
              <SelectInput name="criticality" label="Criticality" values={values} errors={errors} onChange={setField} options={criticalities} required />
            </div>
          </FormSection>

          <FormSection title="Location">
            <div className="grid gap-4 lg:grid-cols-3">
              <ComboInput name="datacenter" label="Datacenter" values={values} errors={errors} onChange={setField} options={options.datacenter} />
              <TextInput name="cluster" label="Cluster" values={values} errors={errors} onChange={setField} required />
              <TextInput name="node" label="Node" values={values} errors={errors} onChange={setField} />
            </div>
          </FormSection>

          <FormSection title="Hardware">
            <div className="grid gap-4 lg:grid-cols-3">
              <ComboInput name="cpu_cores" label="CPU cores" values={values} errors={errors} onChange={setField} options={options.cpu} type="number" required />
              <TextInput name="memory_mb" label="Memory GB" values={values} errors={errors} onChange={setField} type="number" required />
            </div>
            {mode === 'create' && <DiskRows disks={disks} setDisks={setDisks} />}
          </FormSection>

          {mode === 'create' && (
            <FormSection title="Network">
              <IpRows ips={ips} setIps={setIps} />
            </FormSection>
          )}

          <FormSection title="Operating System">
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
          </FormSection>

          <FormSection title="Ownership">
            <div className="grid gap-4 lg:grid-cols-3">
              <ComboInput name="owner" label="Owner" values={values} errors={errors} onChange={setField} options={owners} />
              <TextInput name="business_owner" label="Business Owner" values={values} errors={errors} onChange={setField} />
              <TextInput name="department" label="Department" values={values} errors={errors} onChange={setField} />
            </div>
          </FormSection>

          <FormSection title="Operations">
            <div className="grid gap-4 lg:grid-cols-3">
              <CheckboxInput name="monitoring_enabled" label="Monitoring enabled" values={values} errors={errors} onChange={setField} />
              <CheckboxInput name="backup_enabled" label="Backup enabled" values={values} errors={errors} onChange={setField} />
              <CheckboxInput name="ha_enabled" label="HA enabled" values={values} errors={errors} onChange={setField} />
            </div>
          </FormSection>

          <FormSection title="Security">
            <div className="grid gap-4 lg:grid-cols-3">
              <TextInput name="last_patch_date" label="Last Patch Date" values={values} errors={errors} onChange={setField} type="date" />
              <TextInput name="last_vuln_scan_date" label="Last Vuln Scan" values={values} errors={errors} onChange={setField} type="date" />
              <TextInput name="decommission_date" label="Decommission Date" values={values} errors={errors} onChange={setField} type="date" disabled={values.status !== 'decommissioned'} />
              <TextInput name="last_verified_at" label="Last Verified" values={values} errors={errors} onChange={setField} type="date" />
              <div className="lg:col-span-3">
                <label className={labelClass} htmlFor="security_remarks">Security Remarks</label>
                <textarea className={textareaClass} id="security_remarks" name="security_remarks" value={values.security_remarks} onChange={(e) => setField('security_remarks', e.target.value)} rows={2} />
              </div>
            </div>
          </FormSection>

          <FormSection title="Notes & Tags">
            <div className="grid gap-4">
              <TextInput name="tags" label="Tags (semicolon-separated)" values={values} errors={errors} onChange={setField} />
              <div>
                <label className={labelClass} htmlFor="description">Description</label>
                <textarea className={textareaClass} id="description" name="description" value={values.description} onChange={(e) => setField('description', e.target.value)} rows={3} />
              </div>
            </div>
            <p className={helpTextClass}>{mode === 'create' ? 'Applications are managed on the VM detail page. Additional disks and networks can be added there too.' : 'Disks, networks, and applications are also managed on the VM detail page.'}</p>
          </FormSection>

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
