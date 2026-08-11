import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VmTable } from '../components/VmTable';
import { makeVm, renderWithProviders } from './utils';

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
