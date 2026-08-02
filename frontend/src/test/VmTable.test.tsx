import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VmTable } from '../components/VmTable';
import { makeVm, renderWithProviders } from './utils';

describe('VmTable inline edits', () => {
  it('cancels on blur and commits only on Enter', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const vm = makeVm({ status: 'running' });
    renderWithProviders(<VmTable vms={[vm]} columns={[{ key: 'status' }]} selectedIds={new Set()} onToggle={() => {}} onToggleAll={() => {}} sortKey={null} sortDir="asc" onSort={() => {}} canEdit onUpdateCell={update} />);
    const cell = screen.getByTestId('cell-status');
    fireEvent.keyDown(cell, { key: 'Enter' });
    const select = screen.getByDisplayValue('running');
    fireEvent.change(select, { target: { value: 'powered_off' } });
    fireEvent.blur(select);
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.keyDown(screen.getByDisplayValue('running'), { key: 'Enter' });
    expect(update).toHaveBeenCalledWith(vm.id, 'status', 'running');
  });
});
