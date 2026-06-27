/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppNav, buildNavItems, canSeeUsers } from '../components/AppNav';
import { ImportBatch } from '../api/client';
import { summarizePreview } from '../routes/ImportCsvPage';
import { ThemeProvider, ThemeSelect, THEME_STORAGE_KEY, resolveThemePreference } from '../components/ThemeProvider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/users',
}));

afterEach(() => {
  cleanup();
});

function SummaryFixture({ batch }: { batch: Pick<ImportBatch, 'summary' | 'rows'> }) {
  const summary = summarizePreview(batch);
  return createElement(
    'dl',
    { 'aria-label': 'Preview summary' },
    createElement('div', null, createElement('dt', null, 'create'), createElement('dd', null, summary.create)),
    createElement('div', null, createElement('dt', null, 'update'), createElement('dd', null, summary.update)),
    createElement('div', null, createElement('dt', null, 'conflict'), createElement('dd', null, summary.conflict)),
    createElement('div', null, createElement('dt', null, 'invalid'), createElement('dd', null, summary.invalid)),
  );
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function resetThemeDom() {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
}

describe('CSV preview summary rendering', () => {
  it('renders create/update/conflict/invalid counts from a persisted preview fixture', () => {
    const batch = {
      summary: { create: 1, update: 1, conflict: 0, invalid: 0 },
      rows: [
        { id: 'row-1', row_number: 2, raw: {}, normalized: { name: 'new-vm' }, action: 'create', target_vm_id: null, errors: [] },
        { id: 'row-2', row_number: 3, raw: {}, normalized: { name: 'existing-vm' }, action: 'update', target_vm_id: 'vm-1', errors: [] },
      ],
    } satisfies Pick<ImportBatch, 'summary' | 'rows'>;

    render(createElement(SummaryFixture, { batch }));

    const summary = screen.getByLabelText('Preview summary');
    expect(within(summary).getByText('create').nextSibling).toHaveTextContent('1');
    expect(within(summary).getByText('update').nextSibling).toHaveTextContent('1');
    expect(within(summary).getByText('conflict').nextSibling).toHaveTextContent('0');
    expect(within(summary).getByText('invalid').nextSibling).toHaveTextContent('0');
  });

  it('falls back to persisted row actions when summary counts are absent', () => {
    const summary = summarizePreview({
      summary: {},
      rows: [
        { id: 'row-1', row_number: 2, raw: {}, normalized: null, action: 'invalid', target_vm_id: null, errors: [{ field: 'name', message: 'name is required' }] },
        { id: 'row-2', row_number: 3, raw: {}, normalized: null, action: 'conflict', target_vm_id: null, errors: [{ field: 'identity', message: 'duplicate CSV identity' }] },
      ],
    } as unknown as Pick<ImportBatch, 'summary' | 'rows'>);

    expect(summary).toEqual({ create: 0, update: 0, conflict: 1, invalid: 1 });
  });
});

describe('role-based navigation', () => {
  it('allows only admins to see user management', () => {
    expect(canSeeUsers('admin')).toBe(true);
    expect(canSeeUsers('editor')).toBe(false);
    expect(canSeeUsers('viewer')).toBe(false);

    expect(buildNavItems({ role: 'viewer' }).filter((item) => item.visible).map((item) => item.label)).toEqual(['Inventory']);
    expect(buildNavItems({ role: 'editor' }).filter((item) => item.visible).map((item) => item.label)).toEqual(['Inventory', 'Import']);
    expect(buildNavItems({ role: 'admin' }).filter((item) => item.visible).map((item) => item.label)).toEqual(['Inventory', 'Import', 'Settings']);
  });

  it('renders Settings only for admins and never shows Users in nav', () => {
    const { rerender } = render(createElement(AppNav, { user: { role: 'viewer' } }));
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();

    rerender(createElement(AppNav, { user: { role: 'admin' } }));
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });
});

describe('theme controls', () => {
  beforeEach(() => {
    resetThemeDom();
  });

  it('resolves explicit and system theme preferences', () => {
    expect(resolveThemePreference('dark', false)).toBe('dark');
    expect(resolveThemePreference('light', true)).toBe('light');
    expect(resolveThemePreference('system', true)).toBe('dark');
    expect(resolveThemePreference('system', false)).toBe('light');
  });

  it('applies persisted dark theme on mount', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockMatchMedia(false);

    render(createElement(ThemeProvider, null, createElement(ThemeSelect)));

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(screen.getByLabelText('Theme')).toHaveValue('dark');
  });

  it('stores explicit light theme and removes storage for system theme', async () => {
    mockMatchMedia(true);
    render(createElement(ThemeProvider, null, createElement(ThemeSelect)));

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'light' } });

    await waitFor(() => expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light'));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
    expect(document.documentElement.style.colorScheme).toBe('light');

    fireEvent.change(select, { target: { value: 'system' } });

    await waitFor(() => expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull());
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});

