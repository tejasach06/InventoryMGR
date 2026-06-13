'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, detailMessage, VmPayload } from '../api/client';
import { Alert, FieldError, PageHeader, cardClass, inputClass, primaryButtonClass, secondaryButtonClass, selectClass, textareaClass } from '../components/ui';
import { collectErrors, criticalities, emptyVmFormValues, lifecycles, platforms, statuses, VmFormErrors, VmFormValues, vmFormSchema, vmToFormValues } from '../lib/vmForm';

function TextInput({ name, label, values, errors, onChange, required = false, type = 'text' }: { name: keyof VmFormValues; label: string; values: VmFormValues; errors: VmFormErrors; onChange: (name: keyof VmFormValues, value: string | boolean) => void; required?: boolean; type?: string }) {
  const errorId = `${String(name)}-error`;
  const value = values[name];
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={String(name)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <input className={inputClass} id={String(name)} name={String(name)} type={type} value={typeof value === 'boolean' ? '' : value} onChange={(event) => onChange(name, event.target.value)} aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])} />
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

function SelectInput({ name, label, values, errors, onChange, options, required = false }: { name: keyof VmFormValues; label: string; values: VmFormValues; errors: VmFormErrors; onChange: (name: keyof VmFormValues, value: string | boolean) => void; options: readonly string[]; required?: boolean }) {
  const errorId = `${String(name)}-error`;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={String(name)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <select className={selectClass} id={String(name)} name={String(name)} value={String(values[name])} onChange={(event) => onChange(name, event.target.value)} aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

export function VmFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const router = useRouter();
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
      router.push(`/inventory/${vm.id}`);
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

  if (vmQuery.isLoading) return <div className="p-6" role="status">Loading VM…</div>;
  if (vmQuery.isError) return <Alert>{detailMessage(vmQuery.error)}</Alert>;

  return (
    <section>
      <PageHeader title={title} actions={<Link className={secondaryButtonClass} href={id ? `/inventory/${id}` : '/inventory'}>Cancel</Link>} />
      {save.isError ? <Alert>{detailMessage(save.error)}</Alert> : null}
      <form className={cardClass + ' space-y-8'} onSubmit={submit} noValidate>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-slate-950">Identity</legend>
          <div className="grid gap-4 lg:grid-cols-4">
            <TextInput name="name" label="Name" values={values} errors={errors} onChange={setField} required />
            <SelectInput name="platform" label="Platform" values={values} errors={errors} onChange={setField} options={platforms} required />
            <TextInput name="external_id" label="External ID" values={values} errors={errors} onChange={setField} />
            <SelectInput name="status" label="Status" values={values} errors={errors} onChange={setField} options={statuses} required />
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-slate-950">Placement</legend>
          <div className="grid gap-4 lg:grid-cols-4">
            <TextInput name="environment" label="Environment" values={values} errors={errors} onChange={setField} required />
            <TextInput name="datacenter" label="Datacenter" values={values} errors={errors} onChange={setField} />
            <TextInput name="cluster" label="Cluster" values={values} errors={errors} onChange={setField} required />
            <TextInput name="host" label="Host" values={values} errors={errors} onChange={setField} required />
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-slate-950">Capacity</legend>
          <div className="grid gap-4 lg:grid-cols-4">
            <TextInput name="cpu_cores" label="CPU cores" values={values} errors={errors} onChange={setField} type="number" required />
            <TextInput name="memory_mb" label="Memory MB" values={values} errors={errors} onChange={setField} type="number" required />
            <TextInput name="disk_gb" label="Disk GB" values={values} errors={errors} onChange={setField} type="number" required />
            <TextInput name="os_name" label="Operating system" values={values} errors={errors} onChange={setField} />
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-slate-950">Operations</legend>
          <div className="grid gap-4 lg:grid-cols-4">
            <TextInput name="owner" label="Owner" values={values} errors={errors} onChange={setField} />
            <TextInput name="backup_status" label="Backup status" values={values} errors={errors} onChange={setField} />
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 lg:self-end">
              <input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" id="ha_enabled" name="ha_enabled" type="checkbox" checked={values.ha_enabled} onChange={(event) => setField('ha_enabled', event.target.checked)} />
              <label className="text-sm font-medium text-slate-700" htmlFor="ha_enabled">HA enabled</label>
            </div>
            <TextInput name="dr_tier" label="DR tier" values={values} errors={errors} onChange={setField} />
            <SelectInput name="criticality" label="Criticality" values={values} errors={errors} onChange={setField} options={criticalities} required />
            <SelectInput name="lifecycle" label="Lifecycle" values={values} errors={errors} onChange={setField} options={lifecycles} required />
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-slate-950">Metadata</legend>
          <div className="grid gap-4 lg:grid-cols-4">
            <TextInput name="ip_addresses" label="IP addresses" values={values} errors={errors} onChange={setField} />
            <TextInput name="tags" label="Tags" values={values} errors={errors} onChange={setField} />
            <TextInput name="last_verified_at" label="Last verified date" values={values} errors={errors} onChange={setField} type="date" />
            <div className="lg:col-span-4">
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="notes">Notes</label>
              <textarea className={textareaClass} id="notes" name="notes" value={values.notes} onChange={(event) => setField('notes', event.target.value)} rows={4} />
            </div>
          </div>
          <p className="text-sm text-slate-500">Separate IP addresses and tags with semicolons. Required fields are marked with an asterisk.</p>
        </fieldset>
        <div>
          <button className={primaryButtonClass} type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save VM'}</button>
        </div>
      </form>
    </section>
  );
}
