/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppNav, buildNavItems, canSeeUsers } from '../components/AppNav';
import { ImportBatch } from '../api/client';
import { summarizePreview } from '../routes/ImportCsvPage';

function SummaryFixture({ batch }: { batch: Pick<ImportBatch, 'summary' | 'rows'> }) {
  const summary = summarizePreview(batch);
  return (
    <dl aria-label="Preview summary">
      <div><dt>create</dt><dd>{summary.create}</dd></div>
      <div><dt>update</dt><dd>{summary.update}</dd></div>
      <div><dt>conflict</dt><dd>{summary.conflict}</dd></div>
      <div><dt>invalid</dt><dd>{summary.invalid}</dd></div>
    </dl>
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

    render(<SummaryFixture batch={batch} />);

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
    const { rerender } = render(<MemoryRouter><AppNav user={{ role: 'viewer' }} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();

    rerender(<MemoryRouter><AppNav user={{ role: 'admin' }} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
  });
});
