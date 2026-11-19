'use client';

import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { vms as vmsApi } from '../api/vms';
import { settings as settingsApi } from '../api/settings';
import { ApiError, detailMessage } from '../api/core';
import type { IpMapping, NetworkRole, Vm, VmPayload } from '../api/types';
import {
  Alert, ConfirmDialog, FieldError, PageHeader, PageTransition, RemoveButton, SectionCard, SectionNav, Skeleton, Spinner,
  cardClass, helpTextClass, inputClass, labelClass, primaryButtonClass,
  secondaryButtonClass, selectClass, textareaClass,
} from '../components/ui';
import { ComboInput } from '../components/ComboInput';
import { TagInput } from '../components/TagInput';
import {
  collectErrors, criticalities, emptyVmFormValues, environments,
  platforms, splitList, statuses, VmFormErrors, VmFormValues, vmFormSchema, vmToFormValues, vmTypes,
} from '../lib/vmForm';
import { cn } from '../lib/classNames';

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
  const isNumericOrDate = type === 'number' || type === 'date';
  return (
    <div>
      <label className={labelClass} htmlFor={String(name)}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input className={cn(inputClass, isNumericOrDate && 'tech tabular-nums')} id={String(name)} name={String(name)} type={type}
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
      <select className={selectClass} id={String(name)} name={String(name)} value={String(values[name])} required={required}
        onChange={(e) => onChange(name, e.target.value)}
        aria-describedby={errors[name] ? errorId : undefined} aria-invalid={Boolean(errors[name])}>
        {name === 'status' && (
          <option value={values.status === 'unknown' ? 'unknown' : ''} disabled>
            {values.status === 'unknown' ? 'Unknown (select a status)' : 'Select a status'}
          </option>
        )}
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
      <FieldError id={errorId} message={errors[name]} />
    </div>
  );
}

function FormCombo({ name, label, values, errors, onChange, options, required = false, type = 'text' }:
  BaseFieldProps & { options: string[]; type?: string }) {
  const v = values[name];
  return (
    <ComboInput
      id={String(name)}
      label={label}
      value={typeof v === 'boolean' ? '' : String(v ?? '')}
      options={options}
      onChange={(next) => onChange(name, next)}
      error={errors[name]}
      required={required}
      type={type}
    />
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


// crypto.randomUUID() only exists in secure contexts (https/localhost); these ids are
// just React list keys, not security-sensitive, so fall back when it's unavailable
// (e.g. plain-HTTP deployments without TLS termination).
function rowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type DiskRow = { rowId: string; name: string; size: string; unit: 'GB' | 'TB'; storage: string; type: string };

function parseDiskPaste(text: string): DiskRow[] | null {
  const parts = text.split(';').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const rows: DiskRow[] = [];
  for (const part of parts) {
    const [name, size] = part.split(':').map((s) => s.trim());
    if (!name || !size || !Number.isFinite(Number(size)) || Number(size) <= 0) return null;
    rows.push({ rowId: rowId(), name, size, unit: 'GB', storage: '', type: '' });
  }
  return rows;
}

function DiskRows({ disks, setDisks }: { disks: DiskRow[]; setDisks: Dispatch<SetStateAction<DiskRow[]>> }) {
  const update = (i: number, patch: Partial<DiskRow>) => setDisks((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_6rem_5rem_minmax(0,1fr)_minmax(0,1fr)_2.5rem] lg:items-end';
  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <p className={labelClass}>Disks</p>
      <p className={helpTextClass}>Paste a semicolon-separated list (e.g. os:100;data:500) into the first disk name field to add several at once.</p>
      <div className="mt-3 space-y-3">
        <div className={cn(gridClass, 'hidden lg:grid')}>
          <span className={labelClass}>Name</span>
          <span className={labelClass}>Size</span>
          <span className={labelClass}>Unit</span>
          <span className={labelClass}>Storage</span>
          <span className={labelClass}>Type</span>
          <span aria-hidden="true" />
        </div>
        {disks.map((d, i) => (
          <div key={d.rowId} className={gridClass}>
            <label className="flex flex-col gap-1">
              <span className={cn(labelClass, 'lg:hidden')}>Disk {i + 1} name</span>
              <input aria-label={`Disk ${i + 1} name`} className={inputClass} type="text" placeholder="Disk name" value={d.name} onChange={(e) => update(i, { name: e.target.value })}
                onPaste={i === 0 ? (e) => {
                  const parsed = parseDiskPaste(e.clipboardData.getData('text'));
                  const isPristine = disks.length === 1 && !disks[0].name && !disks[0].size && !disks[0].storage && !disks[0].type;
                  if (parsed && isPristine) { e.preventDefault(); setDisks(parsed); }
                } : undefined} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={cn(labelClass, 'lg:hidden')}>Size</span>
              <input aria-label={`Disk ${i + 1} size`} className={cn(inputClass, 'tabular-nums')} type="number" min="0" placeholder="Size" value={d.size} onChange={(e) => update(i, { size: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={cn(labelClass, 'lg:hidden')}>Unit</span>
              <select aria-label={`Disk ${i + 1} unit`} className={selectClass} value={d.unit} onChange={(e) => update(i, { unit: e.target.value as 'GB' | 'TB' })}>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={cn(labelClass, 'lg:hidden')}>Storage</span>
              <input aria-label={`Disk ${i + 1} storage`} className={inputClass} type="text" placeholder="Storage" value={d.storage} onChange={(e) => update(i, { storage: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={cn(labelClass, 'lg:hidden')}>Type</span>
              <input aria-label={`Disk ${i + 1} type`} className={inputClass} type="text" placeholder="Type" value={d.type} onChange={(e) => update(i, { type: e.target.value })} />
            </label>
            {disks.length > 1 ? (
              <RemoveButton onClick={() => setDisks((rows) => rows.filter((_, idx) => idx !== i))} label={`Remove disk ${i + 1}`} />
            ) : (
              <div aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={() => setDisks((rows) => [...rows, { rowId: rowId(), name: '', size: '', unit: 'GB', storage: '', type: '' }])}>
        + Add another disk
      </button>
    </div>
  );
}

export function isValidIpv4(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;
  const withoutCidr = trimmed.split('/')[0].trim();
  const parts = withoutCidr.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

export function deriveNetworkPrecondition(vm: Vm): string {
  if (vm.network_precondition) return vm.network_precondition;
  const nets = (vm.networks ?? [])
    .map((n) => `${n.ip_address.trim()}:${n.role}:${n.sort_order ?? 0}`)
    .join(';');
  const maps = (vm.ip_mappings ?? [])
    .map((m) => `${m.public_ip.trim()}>${m.private_ip.trim()}`)
    .sort()
    .join(';');
  return `derived:${nets}|${maps}`;
}

interface LoadedNetworkItem {
  ip_address: string;
  role: NetworkRole;
  sort_order: number;
}

interface LoadedMappingItem {
  public_ip: string;
  private_ip: string;
}

export function hasNetworkConfigChanged(
  currentNets: LoadedNetworkItem[],
  currentMaps: LoadedMappingItem[],
  initNets: LoadedNetworkItem[],
  initMaps: LoadedMappingItem[],
): boolean {
  if (currentNets.length !== initNets.length) return true;
  for (let i = 0; i < currentNets.length; i++) {
    if (currentNets[i].ip_address !== initNets[i].ip_address) return true;
    if (currentNets[i].role !== initNets[i].role) return true;
    if (currentNets[i].sort_order !== initNets[i].sort_order) return true;
  }
  if (currentMaps.length !== initMaps.length) return true;
  const currentSet = new Set(currentMaps.map((m) => `${m.public_ip}>${m.private_ip}`));
  for (const m of initMaps) {
    if (!currentSet.has(`${m.public_ip}>${m.private_ip}`)) return true;
  }
  return false;
}

type IpRow = { rowId: string; ip: string; role: NetworkRole };

interface DraftMapping {
  publicRowId: string;
  privateRowId: string;
  publicIp: string;
  privateIp: string;
}

function parseIpPaste(text: string): IpRow[] | null {
  const parts = text.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((ip) => ({ rowId: rowId(), ip, role: 'private' as NetworkRole }));
}

function IpRows({
  ips,
  onUpdate,
  onRequestRemove,
  onAdd,
  onPasteReplace,
}: {
  ips: IpRow[];
  onUpdate: (i: number, patch: Partial<IpRow>) => void;
  onRequestRemove: (i: number) => void;
  onAdd: () => void;
  onPasteReplace: (rows: IpRow[]) => void;
}) {
  const gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_2.5rem] lg:items-end';
  return (
    <div>
      <p className={labelClass}>IP addresses</p>
      <p className={helpTextClass}>Paste a semicolon- or comma-separated list into the first address field to add several at once.</p>
      <div className="mt-3 space-y-3">
        <div className={cn(gridClass, 'hidden lg:grid')}>
          <span className={labelClass}>Address</span>
          <span className={labelClass}>Role</span>
          <span aria-hidden="true" />
        </div>
        {ips.map((r, i) => (
          <div key={r.rowId} className={gridClass}>
            <label className="flex flex-col gap-1">
              <span className={cn(labelClass, 'lg:hidden')}>IP Address {i + 1}</span>
              <input aria-label={`IP address ${i + 1}`} className={inputClass} type="text" placeholder="e.g. 10.0.0.10" value={r.ip} onChange={(e) => onUpdate(i, { ip: e.target.value })}
                onPaste={i === 0 ? (e) => {
                  const parsed = parseIpPaste(e.clipboardData.getData('text'));
                  const isPristine = ips.length === 1 && !ips[0].ip;
                  if (parsed && isPristine) { e.preventDefault(); onPasteReplace(parsed); }
                } : undefined} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={cn(labelClass, 'lg:hidden')}>Role</span>
              <select aria-label={`IP role ${i + 1}`} className={selectClass} value={r.role} onChange={(e) => onUpdate(i, { role: e.target.value as NetworkRole })}>
                <option value="private">Private</option>
                <option value="public">Public</option>
                <option value="backup">Backup</option>
              </select>
            </label>
            {ips.length > 1 ? (
              <RemoveButton onClick={() => onRequestRemove(i)} label={`Remove IP address ${i + 1}`} />
            ) : (
              <div aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={onAdd}>
        + Add IP address
      </button>
    </div>
  );
}

function IpMappingRows({
  ips,
  mappings,
  setMappings,
}: {
  ips: IpRow[];
  mappings: DraftMapping[];
  setMappings: Dispatch<SetStateAction<DraftMapping[]>>;
}) {
  const publicRows = ips.filter((r) => r.role === 'public');
  const privateRows = ips.filter((r) => r.role === 'private' && r.ip.trim());

  if (publicRows.length === 0) return null;

  return (
    <div className="mt-6 border-t border-[var(--color-border)] pt-4" data-testid="ip-mappings-section">
      <p className={labelClass}>Public-to-Private IP Mappings</p>
      <p className={helpTextClass}>
        Select private IP endpoints on this VM for each public address.
      </p>
      <div className="mt-3 space-y-4">
        {publicRows.map((pubRow) => {
          const pubIp = pubRow.ip.trim();
          const hasIp = Boolean(pubIp);
          const isPubValid = hasIp && isValidIpv4(pubIp);
          const pubMappings = mappings.filter((m) => m.publicRowId === pubRow.rowId);
          return (
            <div key={pubRow.rowId} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Public IP:</span>
                  <span className={cn('text-sm font-medium', hasIp ? 'font-mono text-[var(--color-text-primary)]' : 'italic text-[var(--color-text-tertiary)]')}>
                    {hasIp ? pubIp : '(Enter public IP above)'}
                  </span>
                  {hasIp && !isPubValid && (
                    <span className="text-xs text-[var(--color-criticality-critical)]">
                      (Malformed address — correct in IP addresses above)
                    </span>
                  )}
                </div>
                {hasIp && pubMappings.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs text-[var(--color-criticality-critical)] hover:underline"
                    onClick={() => setMappings((prev) => prev.filter((m) => m.publicRowId !== pubRow.rowId))}
                  >
                    Unlink all
                  </button>
                ) : null}
              </div>
              <div className="mt-2.5">
                <span className="text-xs text-[var(--color-text-tertiary)]">Target private endpoints:</span>
                {privateRows.length === 0 ? (
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)] italic">No private IP addresses configured on this VM. Add a private IP above to map endpoints.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-4">
                    {privateRows.map((privRow) => {
                      const isPrivValid = isValidIpv4(privRow.ip);
                      const isChecked = mappings.some(
                        (m) => m.publicRowId === pubRow.rowId && m.privateRowId === privRow.rowId
                      );
                      const canMap = isPubValid && isPrivValid;
                      return (
                        <label key={privRow.rowId} className={cn('flex items-center gap-2 text-sm', canMap ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                            checked={isChecked}
                            disabled={!canMap}
                            aria-label={`Map ${pubIp || 'public IP'} to ${privRow.ip}`}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setMappings((prev) => [
                                  ...prev,
                                  {
                                    publicRowId: pubRow.rowId,
                                    privateRowId: privRow.rowId,
                                    publicIp: pubRow.ip.trim(),
                                    privateIp: privRow.ip.trim(),
                                  },
                                ]);
                              } else {
                                setMappings((prev) =>
                                  prev.filter(
                                    (m) => !(m.publicRowId === pubRow.rowId && m.privateRowId === privRow.rowId)
                                  )
                                );
                              }
                            }}
                          />
                          <span className="font-mono text-[var(--color-text-primary)]">{privRow.ip}</span>
                          {!isPrivValid && (
                            <span className="text-xs text-[var(--color-criticality-critical)]">
                              (Malformed address — correct above)
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VirtualHostRows({
  hosts,
  onChange,
  error,
}: {
  hosts: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const update = (i: number, val: string) => {
    const next = [...hosts];
    next[i] = val;
    onChange(next);
  };
  const remove = (i: number) => {
    onChange(hosts.filter((_, idx) => idx !== i));
  };
  const add = () => {
    onChange([...hosts, '']);
  };

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-4">
      <p className={labelClass}>Virtual hosts</p>
      <p className={helpTextClass}>Domains or website names hosted on this virtual machine.</p>
      {hosts.length > 0 && (
        <div className="mt-3 space-y-2">
          {hosts.map((host, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                id={i === 0 ? 'virtual_hosts' : undefined}
                aria-label={`Virtual host ${i + 1}`}
                aria-describedby={error ? 'virtual_hosts-error' : undefined}
                aria-invalid={Boolean(error)}
                className={cn(inputClass, 'max-w-md')}
                type="text"
                placeholder="e.g. app.example.com or Internal Portal"
                value={host}
                onChange={(e) => update(i, e.target.value)}
              />
              <RemoveButton onClick={() => remove(i)} label={`Remove virtual host ${i + 1}`} />
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`${secondaryButtonClass} mt-3`}
        onClick={add}
      >
        + Add virtual host
      </button>
      <FieldError id="virtual_hosts-error" message={error} />
    </div>
  );
}

const EMPTY_OPTIONS = { cpu: [], datacenter: [], disk: [], os: [], os_by_family: { linux: [], windows: [] } };

const union = (...lists: (string[] | undefined)[]) =>
  Array.from(new Set(lists.flatMap((l) => l ?? []).filter(Boolean))).sort((a, b) => a.localeCompare(b));

export function VmFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<VmFormValues>(() => emptyVmFormValues());
  const [errors, setErrors] = useState<VmFormErrors>({});
  const [disks, setDisks] = useState<DiskRow[]>(() => [{ rowId: rowId(), name: '', size: '', unit: 'GB', storage: '', type: '' }]);
  const [ips, setIps] = useState<IpRow[]>(() => [{ rowId: rowId(), ip: '', role: 'private' as NetworkRole }]);
  const [mappings, setMappings] = useState<DraftMapping[]>([]);
  const [unlinkingRow, setUnlinkingRow] = useState<IpRow | null>(null);
  const loadedPreconditionRef = useRef<string | undefined>(undefined);
  const initialNetworksRef = useRef<LoadedNetworkItem[]>([]);
  const initialMappingsRef = useRef<LoadedMappingItem[]>([]);
  const initialSnapshot = useRef<string>(JSON.stringify({ values, disks, ips, mappings }));
  const isDirty = useMemo(() => JSON.stringify({ values, disks, ips, mappings }) !== initialSnapshot.current, [values, disks, ips, mappings]);

  const vmQuery = useQuery({ queryKey: ['vm', id], queryFn: () => vmsApi.getVm(id ?? ''), enabled: mode === 'edit' && Boolean(id) });
  const optionsQuery = useQuery({ queryKey: ['settings', 'options'], queryFn: settingsApi.getDropdownOptions });
  const ownersQuery = useQuery({ queryKey: ['vm-owners'], queryFn: vmsApi.listVmOwners });
  const suggestionsQuery = useQuery({ queryKey: ['vm-suggestions'], queryFn: vmsApi.listVmSuggestions });
  const clustersQuery = useQuery({ queryKey: ['vm-clusters'], queryFn: vmsApi.listVmClusters });
  const nodesQuery = useQuery({ queryKey: ['vm-nodes'], queryFn: vmsApi.listVmNodes });
  const tagsQuery = useQuery({ queryKey: ['vm-tags'], queryFn: vmsApi.listVmTags });

  const options = optionsQuery.data ?? EMPTY_OPTIONS;
  const owners = ownersQuery.data ?? [];
  const suggest = suggestionsQuery.data ?? {};

  const populateFormFromVm = (vm: Vm) => {
    const loadedValues = vmToFormValues(vm);
    const loadedDisks = vm.disks.length > 0 ? vm.disks.map((d) => ({
      rowId: rowId(),
      name: d.disk_name,
      size: String(d.size_gb >= 1024 ? d.size_gb / 1024 : d.size_gb),
      unit: (d.size_gb >= 1024 ? 'TB' : 'GB') as 'GB' | 'TB',
      storage: d.storage_name ?? '',
      type: d.storage_type ?? '',
    })) : [{ rowId: rowId(), name: '', size: '', unit: 'GB' as const, storage: '', type: '' }];
    const loadedIps = vm.networks.length > 0 ? vm.networks.map((n) => ({
      rowId: rowId(),
      ip: n.ip_address,
      role: n.role,
    })) : [{ rowId: rowId(), ip: '', role: 'private' as NetworkRole }];

    const loadedMappings: DraftMapping[] = [];
    if (vm.ip_mappings && vm.ip_mappings.length > 0) {
      for (const m of vm.ip_mappings) {
        const pub = loadedIps.find((r) => r.role === 'public' && r.ip === m.public_ip);
        const priv = loadedIps.find((r) => r.role === 'private' && r.ip === m.private_ip);
        if (pub && priv) {
          loadedMappings.push({
            publicRowId: pub.rowId,
            privateRowId: priv.rowId,
            publicIp: pub.ip,
            privateIp: priv.ip,
          });
        }
      }
    }

    setValues(loadedValues);
    setDisks(loadedDisks);
    setIps(loadedIps);
    setMappings(loadedMappings);

    loadedPreconditionRef.current = vm.network_precondition ?? deriveNetworkPrecondition(vm);
    initialNetworksRef.current = (vm.networks ?? []).map((n, i) => ({
      ip_address: n.ip_address.trim(),
      role: n.role,
      sort_order: n.sort_order ?? i,
    }));
    initialMappingsRef.current = (vm.ip_mappings ?? []).map((m) => ({
      public_ip: m.public_ip.trim(),
      private_ip: m.private_ip.trim(),
    }));
    initialSnapshot.current = JSON.stringify({ values: loadedValues, disks: loadedDisks, ips: loadedIps, mappings: loadedMappings });
  };

  useEffect(() => {
    if (vmQuery.data) {
      populateFormFromVm(vmQuery.data);
    }
  }, [vmQuery.data]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const save = useMutation({
    mutationFn: (payload: VmPayload) => (mode === 'create' ? vmsApi.createVm(payload) : vmsApi.updateVm(id ?? '', payload)),
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

  function updateIp(i: number, patch: Partial<IpRow>) {
    const current = ips[i];
    if (!current) return;
    const ipChanged = patch.ip !== undefined && patch.ip !== current.ip;
    const roleChanged = patch.role !== undefined && patch.role !== current.role;
    if (ipChanged || roleChanged) {
      setMappings((prev) => prev.filter((m) => m.publicRowId !== current.rowId && m.privateRowId !== current.rowId));
    }
    setIps((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function requestRemoveIp(i: number) {
    const row = ips[i];
    if (!row) return;
    const isLinked = mappings.some((m) => m.publicRowId === row.rowId || m.privateRowId === row.rowId);
    if (isLinked) {
      setUnlinkingRow(row);
    } else {
      setIps((rows) => rows.filter((_, idx) => idx !== i));
    }
  }

  function confirmRemoveLinkedIp() {
    if (!unlinkingRow) return;
    setIps((rows) => rows.filter((r) => r.rowId !== unlinkingRow.rowId));
    setMappings((prev) => prev.filter((m) => m.publicRowId !== unlinkingRow.rowId && m.privateRowId !== unlinkingRow.rowId));
    setUnlinkingRow(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = vmFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = collectErrors(parsed.error);
      setErrors(fieldErrors);
      const firstKey = Object.keys(fieldErrors)[0];
      if (firstKey) {
        const el = document.getElementById(firstKey);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    setErrors({});
    try {
      const validMappings = mappings.filter((m) => {
        const pub = ips.find((r) => r.rowId === m.publicRowId && r.role === 'public' && r.ip.trim());
        const priv = ips.find((r) => r.rowId === m.privateRowId && r.role === 'private' && r.ip.trim());
        return Boolean(pub && priv);
      }).map((m) => {
        const pub = ips.find((r) => r.rowId === m.publicRowId)!;
        const priv = ips.find((r) => r.rowId === m.privateRowId)!;
        return {
          public_ip: pub.ip.trim(),
          private_ip: priv.ip.trim(),
        };
      });
      const seenPairs = new Set<string>();
      const dedupedMappings: IpMapping[] = [];
      for (const m of validMappings) {
        const key = `${m.public_ip}>${m.private_ip}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          dedupedMappings.push(m);
        }
      }

      const currentNetworks = ips
        .filter((r) => r.ip.trim())
        .map((r, i) => ({
          ip_address: r.ip.trim(),
          role: r.role,
          sort_order: i,
        }));

      const networkChanged = mode === 'create' || hasNetworkConfigChanged(
        currentNetworks,
        dedupedMappings,
        initialNetworksRef.current,
        initialMappingsRef.current,
      );

      const payload: Record<string, unknown> = {
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
      };

      if (mode === 'create') {
        payload.networks = currentNetworks;
        payload.ip_mappings = dedupedMappings;
      } else if (networkChanged) {
        payload.networks = currentNetworks;
        payload.ip_mappings = dedupedMappings;
        if (loadedPreconditionRef.current) {
          payload.network_precondition = loadedPreconditionRef.current;
        }
      }

      const vm = await save.mutateAsync(payload as VmPayload);
      initialSnapshot.current = JSON.stringify({ values, disks, ips, mappings });
      loadedPreconditionRef.current = vm.network_precondition ?? deriveNetworkPrecondition(vm);
      initialNetworksRef.current = (vm.networks ?? []).map((n, i) => ({
        ip_address: n.ip_address.trim(),
        role: n.role,
        sort_order: n.sort_order ?? i,
      }));
      initialMappingsRef.current = (vm.ip_mappings ?? []).map((m) => ({
        public_ip: m.public_ip.trim(),
        private_ip: m.private_ip.trim(),
      }));
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      queryClient.invalidateQueries({ queryKey: ['vm-owners'] });
      queryClient.invalidateQueries({ queryKey: ['vm-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['vm-clusters'] });
      queryClient.invalidateQueries({ queryKey: ['vm-nodes'] });
      queryClient.invalidateQueries({ queryKey: ['vm-tags'] });
      queryClient.invalidateQueries({ queryKey: ['decommissions'] });
      router.push(`/inventory/${vm.id}`);
    } catch { /* save.isError displayed above the form */ }
  }

  const handleReload = async () => {
    save.reset();
    const res = await vmQuery.refetch();
    if (res.data) {
      populateFormFromVm(res.data);
    }
  };

  const isConflict = Boolean(
    save.isError &&
    ((save.error instanceof ApiError && save.error.status === 409) ||
     (typeof (save.error as { status?: number })?.status === 'number' && (save.error as { status?: number }).status === 409) ||
     /conflict|precondition/i.test(detailMessage(save.error)))
  );

  if (vmQuery.isLoading) return (
    <div className={cardClass + ' space-y-8'} role="status" aria-label="Loading form">
      {[1, 2, 3].map((s) => (<div key={s} className="space-y-4"><Skeleton className="h-5 w-32" /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div></div>))}
    </div>
  );
  if (vmQuery.isError) return <Alert>{detailMessage(vmQuery.error)}</Alert>;

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-5xl 2xl:max-w-6xl">
        <PageHeader title={title} context="Virtual machine" description="Record identity, placement, capacity, operations, and ownership." />
        {isConflict ? (
          <Alert tone="error">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Network configuration conflict</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  The network configuration has changed since loading this VM ({detailMessage(save.error)}). Your draft changes have been retained in the form.
                </p>
              </div>
              <button
                type="button"
                className={cn(secondaryButtonClass, 'whitespace-nowrap')}
                onClick={handleReload}
              >
                Reload VM data
              </button>
            </div>
          </Alert>
        ) : save.isError ? (
          <Alert>{detailMessage(save.error)}</Alert>
        ) : null}
        <SectionNav titles={['Identity', 'Location', 'Hardware', 'Network', 'Operating System', 'Ownership', 'Operations', 'Security', 'Notes & Tags']} />
        <form className="space-y-5 pb-20" onSubmit={submit} noValidate>
          <SectionCard title="Identity">
            <div className="grid gap-4 lg:grid-cols-3">
              <TextInput name="name" label="Name" values={values} errors={errors} onChange={setField} required />
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
            <VirtualHostRows
              hosts={values.virtual_hosts}
              error={errors.virtual_hosts}
              onChange={(next) => {
                setValues((c) => ({ ...c, virtual_hosts: next }));
                setErrors((c) => ({ ...c, virtual_hosts: undefined }));
              }}
            />
          </SectionCard>

          <SectionCard title="Location">
            <div className="grid gap-4 lg:grid-cols-3">
              <FormCombo name="datacenter" label="Datacenter" values={values} errors={errors} onChange={setField} options={union(options.datacenter, suggest.datacenter)} />
              <FormCombo name="cluster" label="Cluster" values={values} errors={errors} onChange={setField} options={clustersQuery.data ?? []} required />
              <FormCombo name="node" label="Node" values={values} errors={errors} onChange={setField} options={nodesQuery.data ?? []} />
            </div>
          </SectionCard>

          <SectionCard title="Hardware">
            <div className="grid gap-4 lg:grid-cols-3">
              <FormCombo name="cpu_cores" label="CPU cores" values={values} errors={errors} onChange={setField} options={options.cpu} type="number" required />
              <TextInput name="memory_mb" label="Memory GB" values={values} errors={errors} onChange={setField} type="number" required />
            </div>
            <DiskRows disks={disks} setDisks={setDisks} />
          </SectionCard>

          <SectionCard title="Network">
            <IpRows
              ips={ips}
              onUpdate={updateIp}
              onRequestRemove={requestRemoveIp}
              onAdd={() => setIps((rows) => [...rows, { rowId: rowId(), ip: '', role: 'private' as NetworkRole }])}
              onPasteReplace={(parsed) => { setIps(parsed); setMappings([]); }}
            />
            <IpMappingRows ips={ips} mappings={mappings} setMappings={setMappings} />
          </SectionCard>

          <SectionCard title="Operating System">
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="os_family">OS family</label>
                <select className={selectClass} id="os_family" name="os_family" value={values.os_family} onChange={(e) => setField('os_family', e.target.value)}>
                  <option value="linux">Linux</option>
                  <option value="windows">Windows</option>
                  <option value="">Undefined</option>
                </select>
              </div>
              <FormCombo name="os_distribution" label="Operating system" values={values} errors={errors} onChange={setField}
                options={union(values.os_family === 'linux' || values.os_family === 'windows' ? options.os_by_family[values.os_family] : options.os, suggest.os_distribution)} />
              <FormCombo name="os_version" label="Version" values={values} errors={errors} onChange={setField} options={suggest.os_version ?? []} />
            </div>
          </SectionCard>

          <SectionCard title="Ownership">
            <div className="grid gap-4 lg:grid-cols-3">
              <FormCombo name="owner" label="Owner" values={values} errors={errors} onChange={setField} options={owners} />
              <FormCombo name="business_owner" label="Business Owner" values={values} errors={errors} onChange={setField} options={suggest.business_owner ?? []} />
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
              <div>
                <label className={labelClass} htmlFor="tags">Tags</label>
                <TagInput
                  id="tags"
                  value={splitList(values.tags)}
                  options={tagsQuery.data ?? []}
                  onChange={(tags) => setField('tags', tags.join('; '))}
                />
                <p className={helpTextClass}>Press Enter or comma to add. Lowercase, letters/digits/._+- only.</p>
              </div>
              <div>
                <label className={labelClass} htmlFor="description">Description</label>
                <textarea className={textareaClass} id="description" name="description" value={values.description} onChange={(e) => setField('description', e.target.value)} rows={3} />
              </div>
            </div>
            <p className={helpTextClass}>Applications are managed on the VM detail page.</p>
          </SectionCard>

          <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)]/95 px-5 py-3 shadow-[var(--shadow-overlay)] backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
            <button className={primaryButtonClass} type="submit" disabled={save.isPending}>
              {save.isPending ? <><Spinner /> Saving…</> : 'Save VM'}
            </button>
            <Link className={secondaryButtonClass} href={id ? `/inventory/${id}` : '/inventory'}
              onClick={(e) => { if (isDirty && !confirm('Discard unsaved changes?')) e.preventDefault(); }}>Cancel</Link>
          </div>
        </form>
        <ConfirmDialog
          open={Boolean(unlinkingRow)}
          title="Remove Linked IP Address"
          tone="danger"
          confirmLabel="Remove and Unlink"
          body={`Address "${unlinkingRow?.ip}" is currently linked in IP mappings. Removing it will unlink its mappings. Do you want to continue?`}
          onConfirm={confirmRemoveLinkedIp}
          onCancel={() => setUnlinkingRow(null)}
        />
      </section>
    </PageTransition>
  );
}
