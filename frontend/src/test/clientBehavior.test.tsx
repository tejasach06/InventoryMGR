/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppNav, buildNavItems, canSeeUsers } from '../components/AppNav';
import { ImportBatch } from '../api/client';
import { summarizePreview } from '../routes/ImportCsvPage';

vi.mock('next/navigation', () => ({
  usePathname: () => '/users',
}));

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
        { id: 'row-1', row_number: 2, raw: {}, normalized: null, action: 'invalid', target_vm_id: null, errors: [{ field: 'host', message: 'host is required' }] },
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
    expect(buildNavItems({ role: 'editor' }).filter((item) => item.visible).map((item) => item.label)).toEqual(['Inventory', 'CSV Import']);
    expect(buildNavItems({ role: 'admin' }).filter((item) => item.visible).map((item) => item.label)).toEqual(['Inventory', 'CSV Import', 'Users']);
  });

  it('renders Users only for admins', () => {
    const { rerender } = render(createElement(AppNav, { user: { role: 'viewer' } }));
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();

    rerender(createElement(AppNav, { user: { role: 'admin' } }));
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
  });
});
