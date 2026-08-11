'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, ReactElement, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { settings as settingsApi } from '../api/settings';
import { ACCENT_STORAGE_KEY, AccentId, accentVars, DEFAULT_ACCENT, isAccentId } from '../lib/accentPresets';
import { useTheme } from './ThemeProvider';

interface AccentContextValue {
  accent: AccentId;
  setAccent: (accent: AccentId) => void;
}

const AccentContext = createContext<AccentContextValue | null>(null);

function applyAccent(id: AccentId, resolvedTheme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const variables = accentVars(id, resolvedTheme);
  document.documentElement.style.setProperty('--color-accent', variables.accent);
  document.documentElement.style.setProperty('--color-accent-hover', variables.hover);
  document.documentElement.style.setProperty('--color-accent-text', variables.text);
  document.documentElement.style.setProperty('--color-on-accent', variables.onAccent);
}

export function AccentProvider({ children }: { children: ReactNode }): ReactElement {
  const { resolvedTheme } = useTheme();
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
      if (isAccentId(stored)) setAccentState(stored);
    } catch {
      // Ignore storage failures; the default accent still applies for this session.
    }
  }, []);

  useEffect(() => {
    applyAccent(accent, resolvedTheme);
  }, [accent, resolvedTheme]);

  const setAccent = useCallback((nextAccent: AccentId) => {
    setAccentState(nextAccent);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, nextAccent);
    } catch {
      // Ignore storage failures; the in-memory accent still updates for this session.
    }
    applyAccent(nextAccent, resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo(() => ({ accent, setAccent }), [accent, setAccent]);
  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

export function useAccent(): { accent: AccentId; setAccent: (accent: AccentId) => void } {
  const value = useContext(AccentContext);
  if (!value) throw new Error('useAccent must be used inside AccentProvider');
  return value;
}

export function useAccentSync() {
  const { accent, setAccent } = useAccent();
  const { data } = useQuery({ queryKey: ['preferences', 'accent'], queryFn: settingsApi.getAccent });

  useEffect(() => {
    if (data && data.accent !== accent) setAccent(data.accent);
  }, [accent, data, setAccent]);
}
