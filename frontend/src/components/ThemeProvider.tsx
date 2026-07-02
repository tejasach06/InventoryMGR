'use client';

import { ChangeEvent, createContext, ReactElement, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/classNames';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'inventorymgr-theme';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeMediaQuery = '(prefers-color-scheme: dark)';

export function resolveThemePreference(theme: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

function applyResolvedTheme(resolvedTheme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  document.documentElement.style.colorScheme = resolvedTheme;
}

// Dark is the product default: with no stored preference we resolve to dark rather
// than following the OS. 'system' remains explicitly selectable and is persisted.
const DEFAULT_THEME: ThemePreference = 'dark';

function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    if (stored !== null) window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    return DEFAULT_THEME;
  }
  return DEFAULT_THEME;
}

function readSystemPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(themeMediaQuery).matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULT_THEME);
  const [prefersDark, setPrefersDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const resolvedTheme = resolveThemePreference(theme, prefersDark);

  useEffect(() => {
    const nextTheme = readStoredTheme();
    const nextPrefersDark = readSystemPreference();
    setThemeState(nextTheme);
    setPrefersDark(nextPrefersDark);
    applyResolvedTheme(resolveThemePreference(nextTheme, nextPrefersDark));
    setMounted(true);

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    let media: MediaQueryList;
    try {
      media = window.matchMedia(themeMediaQuery);
    } catch {
      return undefined;
    }

    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setPrefersDark(event.matches);
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (mounted) applyResolvedTheme(resolvedTheme);
  }, [mounted, resolvedTheme]);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme);
    try {
      // Persist every choice (including 'system') so it survives reloads and is
      // distinguishable from the dark default.
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage failures; the in-memory theme still updates for this session.
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): { theme: ThemePreference; resolvedTheme: ResolvedTheme; setTheme: (theme: ThemePreference) => void } {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

export function ThemeSelect({ className }: { className?: string }): ReactElement {
  const { theme, setTheme } = useTheme();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    setTheme(event.target.value as ThemePreference);
  }

  return (
    <label className={cn('inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300', className)}>
      <span>Theme</span>
      <select
        aria-label="Theme"
        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
        value={theme}
        onChange={handleChange}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
