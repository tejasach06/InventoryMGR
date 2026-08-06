/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { AccentProvider, useAccent, useAccentSync } from '../components/AccentProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import { ACCENT_STORAGE_KEY, AccentId, accentVars } from '../lib/accentPresets';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  for (const property of ['--color-accent', '--color-accent-hover', '--color-accent-text', '--color-on-accent']) {
    document.documentElement.style.removeProperty(property);
  }
});

function AccentProbe(): ReactElement {
  useAccentSync();
  const { accent } = useAccent();
  return <output aria-label="accent">{accent}</output>;
}

function renderAccentProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AccentProvider><AccentProbe /></AccentProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('accent presets', () => {
  it('returns Blue dark variables', () => {
    expect(accentVars('blue', 'dark')).toEqual({
      accent: '#60a5fa',
      hover: '#93c5fd',
      text: '#60a5fa',
      onAccent: '#05142a',
    });
  });

  it('falls back to Orange for an unknown id', () => {
    expect(accentVars('bogus' as AccentId, 'light')).toEqual({
      accent: '#f97316',
      hover: '#ea580c',
      text: '#c2410c',
      onAccent: '#1c0a00',
    });
  });
});

describe('AccentProvider', () => {
  it('applies every dark custom property from a stored accent', async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, 'blue');
    vi.spyOn(api, 'getAccent').mockResolvedValue({ accent: 'blue' });

    renderAccentProvider();

    await waitFor(() => expect(screen.getByLabelText('accent')).toHaveTextContent('blue'));
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#60a5fa');
    expect(document.documentElement.style.getPropertyValue('--color-accent-hover')).toBe('#93c5fd');
    expect(document.documentElement.style.getPropertyValue('--color-accent-text')).toBe('#60a5fa');
    expect(document.documentElement.style.getPropertyValue('--color-on-accent')).toBe('#05142a');
  });

  it('replaces a valid local accent with the server preference', async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, 'blue');
    vi.spyOn(api, 'getAccent').mockResolvedValue({ accent: 'violet' });

    renderAccentProvider();

    await waitFor(() => expect(screen.getByLabelText('accent')).toHaveTextContent('violet'));
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#a78bfa');
  });
});
