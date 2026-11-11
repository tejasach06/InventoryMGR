import { cleanup, render, screen, within } from '@testing-library/react';
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

  it.each(['running', 'powered_off', 'decommissioned'])('only offers writable statuses and submits %s', async (status) => {
    const onSubmit = open();
    const select = screen.getByLabelText('Status');
    expect(select).toHaveValue('');
    expect(within(select).getAllByRole('option').map((option) => option.getAttribute('value')))
      .toEqual(['', 'running', 'powered_off', 'decommissioned']);
    await userEvent.selectOptions(select, status);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 12 VMs' }));
    expect(onSubmit).toHaveBeenCalledWith({ status });
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

  it('sends application additions and removals separately', async () => {
    const onSubmit = open();

    await userEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    await userEvent.type(screen.getByLabelText('Add applications'), 'Nginx,My App{enter}');
    await userEvent.type(screen.getByLabelText('Remove applications'), 'Legacy App{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 12 VMs' }));

    expect(onSubmit).toHaveBeenCalledWith({
      applications_add: ['Nginx', 'My App'],
      applications_remove: ['Legacy App'],
    });
  });

  it('keeps apply disabled until something changes', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'running');
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeEnabled();
  });

  it('resets staged modifications when closed and re-opened', async () => {
    const { rerender } = render(
      <BulkEditDrawer
        open
        onClose={vi.fn()}
        targetLabel="12 VMs"
        onSubmit={vi.fn()}
        pending={false}
        suggestions={{}}
        tagOptions={[]}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'running');
    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeEnabled();

    rerender(
      <BulkEditDrawer
        open={false}
        onClose={vi.fn()}
        targetLabel="12 VMs"
        onSubmit={vi.fn()}
        pending={false}
        suggestions={{}}
        tagOptions={[]}
      />,
    );

    rerender(
      <BulkEditDrawer
        open
        onClose={vi.fn()}
        targetLabel="12 VMs"
        onSubmit={vi.fn()}
        pending={false}
        suggestions={{}}
        tagOptions={[]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Apply to 12 VMs' })).toBeDisabled();
  });
});
