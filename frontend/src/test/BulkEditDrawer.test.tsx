import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkEditDrawer } from '../components/BulkEditDrawer';

afterEach(cleanup);

function open(onSubmit = vi.fn(), suggestions: Record<string, string[]> = {}, tagOptions: string[] = []) {
  render(
    <BulkEditDrawer
      open
      onClose={vi.fn()}
      targetLabel="12 VMs"
      onSubmit={onSubmit}
      pending={false}
      suggestions={suggestions}
      tagOptions={tagOptions}
    />,
  );
  return onSubmit;
}

describe('BulkEditDrawer', () => {
  it('labels the apply button with the target', () => {
    open();
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeInTheDocument();
  });

  it('sends only the fields the user touched', async () => {
    const onSubmit = open();

    await userEvent.selectOptions(screen.getByLabelText('Criticality'), 'critical');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 12 VMs' }));

    expect(onSubmit).toHaveBeenCalledWith({ criticality: 'critical' });
  });

  it('sends tag additions and removals separately', async () => {
    const onSubmit = open();

    await userEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    const addInput = screen.getByLabelText('Add tags');
    await userEvent.type(addInput, 'prod,eu-west{enter}');
    const removeInput = screen.getByLabelText('Remove tags');
    await userEvent.type(removeInput, 'legacy{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 12 VMs' }));

    expect(onSubmit).toHaveBeenCalledWith({
      tags_add: ['prod', 'eu-west'],
      tags_remove: ['legacy'],
    });
  });

  it('keeps apply disabled until something changes', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'running');
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeEnabled();
  });
});
