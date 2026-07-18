import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api/client';
import { InventoryToolbar } from '../components/InventoryToolbar';
import { emptyFilterState } from '../components/filters/filterConfig';
import type { ColumnConfig } from '../hooks/useColumnPreferences';
import type { Filters } from '../routes/InventoryPage';

const columns: ColumnConfig[] = [
  { key: 'name', visible: true, order: 0 },
  { key: 'fqdn', visible: false, order: 1 },
];

function renderToolbar(filters: Filters = { ...emptyFilterState }) {
  const onApply = vi.fn();
  const onToggleColumn = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InventoryToolbar
        filters={filters}
        onApply={onApply}
        columns={columns}
        onToggleColumn={onToggleColumn}
        onReorderColumns={vi.fn()}
        onResetColumns={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onApply, onToggleColumn };
}

beforeEach(() => {
  vi.spyOn(api, 'listVmOwners').mockResolvedValue(['alice']);
  vi.spyOn(api, 'listVmClusters').mockResolvedValue(['cluster-a']);
  vi.spyOn(api, 'listVmNodes').mockResolvedValue(['node-1']);
  vi.spyOn(api, 'listVmTags').mockResolvedValue(['web']);
  vi.spyOn(api, 'listVmApplications').mockResolvedValue(['app-1']);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InventoryToolbar card', () => {
  it('shows the search field and both drawer triggers', () => {
    renderToolbar();
    expect(screen.getByRole('searchbox', { name: 'Search VMs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Columns/ })).toBeInTheDocument();
  });

  it('does not render any filter control outside the drawer', () => {
    renderToolbar();
    // Status/Platform/Criticality segmented groups live in the drawer only.
    expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Platform' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Criticality' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Presets/ })).not.toBeInTheDocument();
  });

  it('applies the free-text query as the user types, without opening a drawer', async () => {
    const { onApply } = renderToolbar();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search VMs' }), 'web');
    expect(onApply).toHaveBeenCalled();
    const last = onApply.mock.calls.at(-1)![0] as Filters;
    expect(last.q).toEqual(['web']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('badges the Filters trigger with the active filter count, ignoring search', () => {
    renderToolbar({ ...emptyFilterState, q: ['web'], status: ['running'], environment: ['production'] });
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('2');
  });

  it('renders a chip per active filter and clears them all on demand', async () => {
    const { onApply } = renderToolbar({ ...emptyFilterState, status: ['running'] });
    expect(screen.getByText('running')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    const applied = onApply.mock.calls.at(-1)![0] as Filters;
    expect(applied.status).toEqual([]);
  });

  it('keeps the search query when Clear all removes the filters', async () => {
    const { onApply } = renderToolbar({ ...emptyFilterState, q: ['web'], status: ['running'] });
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    const applied = onApply.mock.calls.at(-1)![0] as Filters;
    expect(applied.q).toEqual(['web']);
    expect(applied.status).toEqual([]);
  });

  it('hides the chip row when only a search query is set', () => {
    renderToolbar({ ...emptyFilterState, q: ['web'] });
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
  });
});

describe('InventoryToolbar filter drawer', () => {
  it('opens the filter drawer with every filter group inside', async () => {
    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Status' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Platform' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Criticality' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Filter presets' })).toBeInTheDocument();
  });

  it('stages edits and only applies them when Apply is pressed', async () => {
    const { onApply } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /running/ }));

    expect(onApply).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Apply (1)' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply (1)' }));
    expect((onApply.mock.calls.at(-1)![0] as Filters).status).toEqual(['running']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('discards staged edits when Cancel is pressed', async () => {
    const { onApply } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /running/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).getByRole('button', { name: 'Apply (0)' })).toBeInTheDocument();
  });

  it('stages a preset instead of applying it immediately', async () => {
    const { onApply } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Running in Prod' }));

    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: /^Apply/ }));
    const applied = onApply.mock.calls.at(-1)![0] as Filters;
    expect(applied.status).toEqual(['running']);
    expect(applied.environment).toEqual(['production']);
  });
});

describe('InventoryToolbar column drawer', () => {
  it('opens the column drawer from the card', async () => {
    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toBeChecked();
  });

  it('persists a column toggle immediately, with no Apply step', async () => {
    const { onToggleColumn } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('FQDN'));
    expect(onToggleColumn).toHaveBeenCalledWith('fqdn');
  });

  it('never shows both drawers at once', async () => {
    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getByLabelText('Name')).toBeInTheDocument();
  });
});
