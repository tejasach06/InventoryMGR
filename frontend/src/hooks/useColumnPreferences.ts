'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { settings as settingsApi } from '../api/settings';
import { detailMessage } from '../api/core';
import { DEFAULT_COLUMNS, mergeWithDefaults, reorderColumnConfig, toggleColumnConfig, type ColumnConfig } from '../lib/columns';

export function useColumnPreferences(pageKey: string) {
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnsRef = useRef<ColumnConfig[]>(columns);
  columnsRef.current = columns;

  useEffect(() => {
    let cancelled = false;
    settingsApi.getColumnPreferences(pageKey)
      .then((data) => {
        if (!cancelled) {
          const merged = mergeWithDefaults(data.columns);
          columnsRef.current = merged;
          setColumns(merged);
        }
      })
      .catch((err) => { if (!cancelled) setError(detailMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pageKey]);

  const save = useCallback((cols: ColumnConfig[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      settingsApi.updateColumnPreferences(pageKey, cols).catch((err) => {
        setError(detailMessage(err));
      });
    }, 300);
  }, [pageKey]);

  const toggleColumn = useCallback((key: string) => {
    const next = toggleColumnConfig(columnsRef.current, key);
    columnsRef.current = next;
    setColumns(next);
    save(next);
  }, [save]);

  const reorderColumns = useCallback((fromKey: string, toKey: string) => {
    const next = reorderColumnConfig(columnsRef.current, fromKey, toKey);
    if (!next) return;
    columnsRef.current = next;
    setColumns(next);
    save(next);
  }, [save]);

  const resetToDefault = useCallback(() => {
    columnsRef.current = DEFAULT_COLUMNS;
    setColumns(DEFAULT_COLUMNS);
    save(DEFAULT_COLUMNS);
  }, [save]);

  const visibleColumns = columns
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order);

  return { columns, visibleColumns, loading, error, toggleColumn, reorderColumns, resetToDefault };
}
