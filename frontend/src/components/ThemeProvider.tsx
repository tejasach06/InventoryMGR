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

function SunIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  );
}

function MoonIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M14 8.5A6 6 0 1 1 7.5 2 4.5 4.5 0 0 0 14 8.5z" />
    </svg>
  );
}

function MonitorIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 14h5M8 11v3" />
    </svg>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: ReactElement }[] = [
  { value: 'system', label: 'System theme', icon: <MonitorIcon /> },
  { value: 'light', label: 'Light theme', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark theme', icon: <MoonIcon /> },
];

export function ThemeToggle({
  className,
  direction = 'row',
}: {
  className?: string;
  direction?: 'row' | 'col';
}): ReactElement {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-tertiary)]/50 p-0.5',
        direction === 'col' ? 'flex-col' : 'flex-row',
        className
      )}
    >
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={theme === opt.value}
          aria-label={opt.label}
          title={opt.label}
          onClick={() => setTheme(opt.value)}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
            theme === opt.value
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
              : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
          )}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
