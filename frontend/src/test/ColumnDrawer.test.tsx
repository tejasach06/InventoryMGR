import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnDrawer } from '../components/ColumnDrawer';
import type { ColumnConfig } from '../hooks/useColumnPreferences';

const columns: ColumnConfig[] = [
  { key: 'name', visible: true, order: 0 },
  { key: 'cluster', visible: true, order: 1 },
  { key: 'fqdn', visible: false, order: 2 },
];

function renderDrawer(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    columns,
    onClose: vi.fn(),
    onToggle: vi.fn(),
    onReorder: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ColumnDrawer {...(props as Parameters<typeof ColumnDrawer>[0])} />);
  return props;
}

afterEach(cleanup);

describe('ColumnDrawer', () => {
  it('renders nothing while closed', () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders every column as a labelled checkbox in order', () => {
    renderDrawer();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByLabelText('Name')).toBeChecked();
    expect(screen.getByLabelText('Cluster')).toBeChecked();
    expect(screen.getByLabelText('FQDN')).not.toBeChecked();
  });

  it('reports the column key when a checkbox is toggled', async () => {
    const props = renderDrawer();
    await userEvent.click(screen.getByLabelText('FQDN'));
    expect(props.onToggle).toHaveBeenCalledWith('fqdn');
  });

  it('reports a reset when Reset to default is pressed', async () => {
    const props = renderDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('closes when the drawer close button is pressed', async () => {
    const props = renderDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a reorder when one row is dropped onto another', () => {
    const props = renderDrawer();
    const rows = screen.getAllByRole('listitem');
    // jsdom has no drag engine; drive React's synthetic drag handlers directly.
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => 'fqdn' };
    fireEvent.dragStart(rows[2], { dataTransfer });
    fireEvent.dragOver(rows[0], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });
    expect(props.onReorder).toHaveBeenCalledWith('fqdn', 'name');
  });
});
