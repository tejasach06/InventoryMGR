import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Drawer } from '../components/ui';
import { renderWithProviders } from './utils';

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open filters</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Filters"><button type="button">Apply</button></Drawer>
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
