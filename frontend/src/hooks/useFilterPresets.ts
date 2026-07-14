import { useState, useEffect } from 'react';

type PresetData<F, O> = { filters: F; operators: O };

export function useFilterPresets<F, O>(storageKey: string) {
  const [presets, setPresets] = useState<Record<string, PresetData<F, O>>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setPresets(JSON.parse(stored));
    } catch (e) {
      console.error('Failed to parse filter presets', e);
    }
  }, [storageKey]);

  function savePreset(name: string, filters: F, operators: O) {
    const next = { ...presets, [name]: { filters, operators } };
    setPresets(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function deletePreset(name: string) {
    const next = { ...presets };
    delete next[name];
    setPresets(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  return { presets, savePreset, deletePreset };
}