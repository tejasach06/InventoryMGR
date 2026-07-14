'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, detailMessage } from '../api/client';

export interface ColumnConfig {
  key: string;
  visible: boolean;
  order: number;
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'name', visible: true, order: 0 },
  { key: 'platform', visible: true, order: 1 },
  { key: 'cluster', visible: true, order: 2 },
  { key: 'status', visible: true, order: 3 },
  { key: 'resources', visible: true, order: 4 },
  { key: 'criticality', visible: true, order: 5 },
  { key: 'ip_address', visible: true, order: 6 },
  { key: 'updated_at', visible: true, order: 7 },
  { key: 'fqdn', visible: false, order: 8 },
  { key: 'environment', visible: false, order: 9 },
  { key: 'lifecycle', visible: false, order: 10 },
  { key: 'vm_type', visible: false, order: 11 },
  { key: 'datacenter', visible: false, order: 12 },
  { key: 'node', visible: false, order: 13 },
  { key: 'os', visible: false, order: 14 },
  { key: 'owner', visible: false, order: 15 },
  { key: 'business_owner', visible: false, order: 16 },
  { key: 'technical_owner', visible: false, order: 17 },
  { key: 'pmp_enabled', visible: false, order: 18 },
  { key: 'monitoring_enabled', visible: false, order: 19 },
  { key: 'backup_enabled', visible: false, order: 20 },
  { key: 'ha_enabled', visible: false, order: 21 },
  { key: 'health_score', visible: false, order: 22 },
  { key: 'tags', visible: false, order: 23 },
  { key: 'created_at', visible: false, order: 24 },
];

export const COLUMN_LABELS: Record<string, string> = {
  name: 'Name',
  platform: 'Platform',
  cluster: 'Cluster',
  status: 'Status',
  resources: 'Resources',
  criticality: 'Criticality',
  ip_address: 'IP Address',
  updated_at: 'Updated',
  fqdn: 'FQDN',
  environment: 'Environment',
  lifecycle: 'Lifecycle',
  vm_type: 'Type',
  datacenter: 'Datacenter',
  node: 'Node',
  os: 'OS',
  owner: 'Owner',
  business_owner: 'Business Owner',
  technical_owner: 'Technical Owner',
  pmp_enabled: 'PMP',
  monitoring_enabled: 'Monitoring',
  backup_enabled: 'Backup',
  ha_enabled: 'HA',
  health_score: 'Health',
  tags: 'Tags',
  created_at: 'Created',
};

// Merge in columns added after the user saved their preferences.
export function mergeWithDefaults(saved: ColumnConfig[]): ColumnConfig[] {
  const savedKeys = new Set(saved.map((c) => c.key));
  let nextOrder = saved.reduce((max, c) => Math.max(max, c.order), -1) + 1;
  const merged = [...saved];
  for (const def of DEFAULT_COLUMNS) {
    if (!savedKeys.has(def.key)) merged.push({ key: def.key, visible: false, order: nextOrder++ });
  }
  return merged;
}

export function useColumnPreferences(pageKey: string) {
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getColumnPreferences(pageKey)
      .then((data) => { if (!cancelled) setColumns(mergeWithDefaults(data.columns)); })
      .catch((err) => { if (!cancelled) setError(detailMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pageKey]);

  const save = useCallback((cols: ColumnConfig[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.updateColumnPreferences(pageKey, cols).catch((err) => {
        setError(detailMessage(err));
      });
    }, 300);
  }, [pageKey]);

  const toggleColumn = useCallback((key: string) => {
    setColumns((prev) => {
      const next = prev.map((c) => c.key === key ? { ...c, visible: !c.visible } : c);
      save(next);
      return next;
    });
  }, [save]);

  const reorderColumns = useCallback((fromKey: string, toKey: string) => {
    setColumns((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const fromIdx = sorted.findIndex((c) => c.key === fromKey);
      const toIdx = sorted.findIndex((c) => c.key === toKey);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const reordered = [...sorted];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      const withNewOrder = reordered.map((c, i) => ({ ...c, order: i }));
      save(withNewOrder);
      return withNewOrder;
    });
  }, [save]);

  const resetToDefault = useCallback(() => {
    setColumns(DEFAULT_COLUMNS);
    save(DEFAULT_COLUMNS);
  }, [save]);

  const visibleColumns = columns
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order);

  return { columns, visibleColumns, loading, error, toggleColumn, reorderColumns, resetToDefault };
}
