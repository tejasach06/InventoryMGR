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
});


it('renders selectable sortable rows and all optional value columns', () => {
  const onToggle = vi.fn();
  const onToggleAll = vi.fn();
  const onSort = vi.fn();
  const vm = makeVm({
    id: 'vm-rich',
    name: 'rich-vm',
    node: 'node-a',
    fqdn: 'rich.example.local',
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
    'monitoring_enabled', 'pmp_enabled', 'health', 'resources', 'fqdn', 'private_ip', 'public_ip', 'backup_ip', 'tags', 'unknown_col',
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
  const vm = makeVm({ node: null, fqdn: null, owner: null, os_family: null, networks: [], tags: [] });
  renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'node' }, { key: 'fqdn' }, { key: 'owner' }, { key: 'os_family' }, { key: 'private_ip' }, { key: 'tags' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} onUpdateCell={update} />);

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
