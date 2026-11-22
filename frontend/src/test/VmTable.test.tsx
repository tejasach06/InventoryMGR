import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VmTable } from '../components/VmTable';
import { makeVm, renderWithProviders } from './utils';

afterEach(cleanup);

describe('VmTable inline edits', () => {
  it('starts editing on click and commits on blur or Enter', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const vm = makeVm({ status: 'running' });
    renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'status' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} canEdit onUpdateCell={update} />);

    const cell = screen.getByTestId('cell-status');
    fireEvent.click(cell);
    const select = screen.getByDisplayValue('running');
    fireEvent.change(select, { target: { value: 'powered_off' } });
    fireEvent.blur(select);
    await waitFor(() => expect(update).toHaveBeenCalledWith(vm.id, 'status', 'powered_off'));

    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByDisplayValue('running'), { key: 'Enter' });
    await waitFor(() => expect(update).toHaveBeenCalledWith(vm.id, 'status', 'running'));
  });

  it('starts editing via keyboard using Enter and Space', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const vm = makeVm({ name: 'test-vm', status: 'running', owner: 'alice' });
    renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'status' }, { key: 'owner' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} canEdit onUpdateCell={update} />);

    const statusCell = screen.getByTestId('cell-status');
    expect(statusCell).not.toHaveAttribute('role');
    const statusBtn = screen.getByRole('button', { name: 'Edit Status for test-vm' });
    expect(statusCell).toContainElement(statusBtn);

    // A native button turns Enter/Space into a click
    fireEvent.click(statusBtn);
    const select = screen.getByDisplayValue('running');
    expect(select).toBeInTheDocument();
    fireEvent.keyDown(select, { key: 'Escape' });
    expect(screen.queryByDisplayValue('running')).not.toBeInTheDocument();

    // Press Space to start editing owner
    fireEvent.click(screen.getByRole('button', { name: 'Edit Owner for test-vm' }));
    const input = screen.getByDisplayValue('alice');
    expect(input).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
  });

  it('removes 3px borderLeft side-tab and displays fallback non-color-only status badge when status column is hidden', () => {
    const vm = makeVm({ name: 'web-prod', status: 'running' });
    const { container, rerender } = renderWithProviders(
      <VmTable vms={[vm]} columns={[{ key: 'name' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} />
    );

    const row = container.querySelector('tbody tr');
    expect(row).not.toHaveAttribute('style');

    // When status column is hidden but name is shown, status Badge appears in name cell
    const nameCell = screen.getByTestId('cell-name');
    expect(nameCell).toHaveTextContent('web-prod');
    expect(nameCell).toHaveTextContent('running');

    // When both name and status columns are hidden, status Badge appears in checkbox cell
    rerender(
      <VmTable vms={[vm]} columns={[{ key: 'cluster' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} />
    );
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('provides >=24px hit area wrapper for row and select-all checkboxes', () => {
    const vm = makeVm({ id: 'vm-1', name: 'vm-one' });
    renderWithProviders(
      <VmTable vms={[vm]} columns={[{ key: 'name' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} />
    );

    const selectAllWrapper = screen.getByLabelText('Select all').closest('label');
    expect(selectAllWrapper).toHaveClass('min-h-6', 'min-w-6');

    const rowCheckboxWrapper = screen.getByLabelText('Select vm-one').closest('label');
    expect(rowCheckboxWrapper).toHaveClass('min-h-6', 'min-w-6');
  });
});


it('renders selectable sortable rows and all optional value columns', () => {
  const onToggle = vi.fn();
  const onToggleAll = vi.fn();
  const onSort = vi.fn();
  const vm = makeVm({
    id: 'vm-rich',
    name: 'rich-vm',
    node: 'node-a',
    virtual_hosts: ['rich.example.local'],
    owner: null,
    monitoring_enabled: false,
    pmp_enabled: true,
    networks: [
      { id: 'private', vm_id: 'vm-rich', ip_address: '10.0.0.5', role: 'private', sort_order: 0 },
      { id: 'public', vm_id: 'vm-rich', ip_address: '203.0.113.5', role: 'public', sort_order: 1 },
      { id: 'backup', vm_id: 'vm-rich', ip_address: '172.16.0.5', role: 'backup', sort_order: 2 },
    ],
    tags: ['one', 'two', 'three', 'four'],
  });
  const columns = [
    'name', 'platform', 'cluster', 'node', 'status', 'environment', 'criticality', 'os_family', 'owner',
    'monitoring_enabled', 'pmp_enabled', 'health', 'cpu_cores', 'memory_mb', 'virtual_hosts', 'private_ip', 'public_ip', 'backup_ip', 'tags', 'unknown_col',
  ].map((key) => ({ key }));

  renderWithProviders(<VmTable vms={[vm]} columns={columns} selectedIds={new Set([vm.id])} onToggle={onToggle} onToggleAll={onToggleAll} sortKey="name" sortDir="desc" onSort={onSort} />);

  expect(screen.getByLabelText('Select all')).toBeChecked();
  fireEvent.click(screen.getByLabelText('Select all'));
  expect(onToggleAll).toHaveBeenCalledWith(['vm-rich']);
  fireEvent.click(screen.getByLabelText('Select rich-vm'));
  expect(onToggle).toHaveBeenCalledWith('vm-rich');
  fireEvent.click(screen.getByRole('button', { name: /Name/ }));
  expect(onSort).toHaveBeenCalledWith('name');

  expect(screen.getByRole('link', { name: 'rich-vm' })).toHaveAttribute('href', '/inventory/vm-rich');
  expect(screen.getByText('node-a')).toBeInTheDocument();
  expect(screen.getByText('Disabled')).toBeInTheDocument();
  expect(screen.getByText('Enabled')).toBeInTheDocument();
  expect(screen.getByText('203.0.113.5')).toBeInTheDocument();
  expect(screen.getByText('172.16.0.5')).toBeInTheDocument();
  expect(screen.getByText('+1')).toBeInTheDocument();
});

it('renders fallbacks for missing optional values and blocks inline edit for read-only users', () => {
  const update = vi.fn();
  const vm = makeVm({ node: null, virtual_hosts: [], owner: null, os_family: null, networks: [], tags: [] });
  renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'node' }, { key: 'virtual_hosts' }, { key: 'owner' }, { key: 'os_family' }, { key: 'private_ip' }, { key: 'tags' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} onUpdateCell={update} />);

  fireEvent.click(screen.getByTestId('cell-owner'));
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByText('unknown')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getByTestId('cell-tags')).toHaveTextContent('');
});

it('keeps inline status editor compact at the clicked cell width', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(123);
  const vm = makeVm({ status: 'running' });
  renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'status' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} canEdit onUpdateCell={vi.fn()} />);

  const cell = screen.getByTestId('cell-status');
  fireEvent.click(cell);
  const select = screen.getByDisplayValue('running');

  expect(cell).toHaveStyle({ width: '123px' });
  expect(select).toHaveClass('py-1');
});

it('supports owner inline edit cancellation and swallowed update failures', async () => {
  const update = vi.fn().mockRejectedValue(new Error('nope'));
  const vm = makeVm({ owner: 'alice' });
  renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'owner' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} canEdit onUpdateCell={update} />);

  fireEvent.click(screen.getByTestId('cell-owner'));
  const input = screen.getByDisplayValue('alice');
  fireEvent.change(input, { target: { value: 'bob' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(update).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('cell-owner'));
  fireEvent.change(screen.getByDisplayValue('alice'), { target: { value: 'carol' } });
  fireEvent.keyDown(screen.getByDisplayValue('carol'), { key: 'Enter' });
  await waitFor(() => expect(update).toHaveBeenCalledWith(vm.id, 'owner', 'carol'));
  expect(screen.queryByDisplayValue('carol')).not.toBeInTheDocument();
});


it('commits environment and criticality inline select edits', async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  const vm = makeVm({ environment: 'production', criticality: 'high' });
  renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'environment' }, { key: 'criticality' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} canEdit onUpdateCell={update} />);

  fireEvent.click(screen.getByTestId('cell-environment'));
  fireEvent.change(screen.getByDisplayValue('production'), { target: { value: 'development' } });
  fireEvent.keyDown(screen.getByDisplayValue('development'), { key: 'Enter' });
  await waitFor(() => expect(update).toHaveBeenCalledWith(vm.id, 'environment', 'development'));

  fireEvent.click(screen.getByTestId('cell-criticality'));
  fireEvent.change(screen.getByDisplayValue('high'), { target: { value: 'critical' } });
  fireEvent.blur(screen.getByDisplayValue('critical'));
  await waitFor(() => expect(update).toHaveBeenCalledWith(vm.id, 'criticality', 'critical'));
});

it('renders sort buttons and aria-sort for late-enabled columns and health_score mapping', () => {
  const onSort = vi.fn();
  const vm = makeVm({ datacenter: 'dc-1', tags: ['web'] });
  const columns = [
    { key: 'datacenter' },
    { key: 'private_ip' },
    { key: 'tags' },
    { key: 'health_score' },
  ];

  renderWithProviders(
    <VmTable
      vms={[vm]}
      columns={columns}
      selectedIds={new Set()}
      onToggle={() => {}}
      onToggleAll={() => {}}
      sortKey="datacenter"
      sortDir="asc"
      onSort={onSort}
    />,
  );

  const dcHeader = screen.getByRole('columnheader', { name: /Datacenter/i });
  expect(dcHeader).toHaveAttribute('aria-sort', 'ascending');
  const dcButton = screen.getByRole('button', { name: /Datacenter/i });
  fireEvent.click(dcButton);
  expect(onSort).toHaveBeenCalledWith('datacenter');

  const ipHeader = screen.getByRole('columnheader', { name: /Private IP/i });
  expect(ipHeader).toHaveAttribute('aria-sort', 'none');
  const ipButton = screen.getByRole('button', { name: /Private IP/i });
  fireEvent.click(ipButton);
  expect(onSort).toHaveBeenCalledWith('private_ip');

  const tagsHeader = screen.getByRole('columnheader', { name: /Tags/i });
  expect(tagsHeader).toHaveAttribute('aria-sort', 'none');
  const tagsButton = screen.getByRole('button', { name: /Tags/i });
  fireEvent.click(tagsButton);
  expect(onSort).toHaveBeenCalledWith('tags');
});

it('correctly associates health_score column with health sortKey', () => {
  const onSort = vi.fn();
  const vm = makeVm({ health_score: 85 });

  renderWithProviders(
    <VmTable
      vms={[vm]}
      columns={[{ key: 'health_score' }]}
      selectedIds={new Set()}
      onToggle={() => {}}
      onToggleAll={() => {}}
      sortKey="health"
      sortDir="desc"
      onSort={onSort}
    />,
  );

  const healthHeader = screen.getByRole('columnheader', { name: /Health/i });
  expect(healthHeader).toHaveAttribute('aria-sort', 'descending');
  const healthButton = screen.getByRole('button', { name: /Health/i });
  fireEvent.click(healthButton);
  expect(onSort).toHaveBeenCalledWith('health_score');
});

it('renders a value for every column the drawer can enable', () => {
  const vm = makeVm({
    vm_type: 'temporary', datacenter: 'dc-east', business_owner: 'Biz Owner', technical_owner: 'Tech Owner',
    backup_enabled: true, ha_enabled: false, updated_at: '2026-03-05T10:00:00Z', created_at: '2026-01-02T10:00:00Z',
  });
  const keys = ['vm_type', 'datacenter', 'business_owner', 'technical_owner', 'backup_enabled', 'ha_enabled', 'updated_at', 'created_at'];
  renderWithProviders(<VmTable vms={[vm]} columns={keys.map((key) => ({ key }))} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} />);
  for (const key of keys) expect(screen.getByTestId(`cell-${key}`).textContent?.trim()).not.toBe('');
  expect(screen.getByTestId('cell-datacenter')).toHaveTextContent('dc-east');
  expect(screen.getByTestId('cell-backup_enabled')).toHaveTextContent('Enabled');
  expect(screen.getByTestId('cell-ha_enabled')).toHaveTextContent('Disabled');
  expect(screen.getByTestId('cell-updated_at')).toHaveTextContent('2026');
});
