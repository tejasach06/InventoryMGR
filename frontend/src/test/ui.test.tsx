import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, Drawer } from '../components/ui';
import { renderWithProviders } from './utils';

afterEach(cleanup);

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open filters</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Filters"><button type="button">Apply</button></Drawer>
    </>
  );
}

function ConfirmHarness({ onConfirm, onCancel }: { onConfirm?: () => void; onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open confirm</button>
      <ConfirmDialog
        open={open}
        title="Delete Item"
        body="Are you sure you want to delete this?"
        confirmLabel="Confirm"
        onConfirm={onConfirm ?? (() => setOpen(false))}
        onCancel={onCancel ?? (() => setOpen(false))}
      />
    </>
  );
}

describe('Drawer', () => {
  it('traps focus, closes on Escape, and restores opener focus', () => {
    renderWithProviders(<DrawerHarness />);
    const opener = screen.getByRole('button', { name: 'Open filters' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    const apply = screen.getByRole('button', { name: 'Apply' });
    apply.focus();
    fireEvent.keyDown(apply, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Tab', shiftKey: true });
    expect(apply).toHaveFocus();
    fireEvent.keyDown(apply, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('ConfirmDialog', () => {
  it('traps focus, closes on Escape, and restores opener focus via useModalOverlay', () => {
    renderWithProviders(<ConfirmHarness />);
    const opener = screen.getByRole('button', { name: 'Open confirm' });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    confirmBtn.focus();
    fireEvent.keyDown(confirmBtn, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('triggers onConfirm when Confirm is clicked', () => {
    const onConfirm = vi.fn();
    renderWithProviders(<ConfirmHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
