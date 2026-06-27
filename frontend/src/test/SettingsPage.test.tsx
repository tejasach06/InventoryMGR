import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '../api/client';
import type { DropdownOption } from '../api/client';
import { SettingsPage } from '../routes/SettingsPage';
import { renderWithProviders } from './utils';

const cpuOptions: DropdownOption[] = [{ id: 'o1', category: 'cpu', value: '8', family: null }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('shows the loading skeleton on first render before the options query resolves', () => {
    // The query is pending on the initial synchronous render; resolution happens on
    // a later microtask, so asserting before any await observes the loading state.
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(cpuOptions);

    renderWithProviders(<SettingsPage />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders an error alert when the options query rejects', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockRejectedValue(new ApiError(500, 'Boom'));

    renderWithProviders(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders every category tab plus the users tab and lists the cpu option', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(cpuOptions);

    renderWithProviders(<SettingsPage />);

    expect(await screen.findByRole('tab', { name: 'CPU cores' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Datacenter' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Disk size (GB)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Operating system' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('switches the active panel when a different tab is clicked', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(cpuOptions);
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />);

    const cpuTab = await screen.findByRole('tab', { name: 'CPU cores' });
    expect(cpuTab).toHaveAttribute('aria-selected', 'true');

    const datacenterTab = screen.getByRole('tab', { name: 'Datacenter' });
    await user.click(datacenterTab);

    expect(datacenterTab).toHaveAttribute('aria-selected', 'true');
    expect(cpuTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-datacenter');
    expect(screen.getByText('No options yet. Add the first one above.')).toBeInTheDocument();
    expect(screen.queryByText('8')).not.toBeInTheDocument();
  });

  it('creates a new option from the category add form', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(cpuOptions);
    const createSpy = vi
      .spyOn(api, 'createDropdownOption')
      .mockResolvedValue({ id: 'o2', category: 'cpu', value: '16', family: null });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />);

    await screen.findByRole('tab', { name: 'CPU cores' });
    await user.type(screen.getByLabelText('Add CPU cores option'), '16');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith('cpu', '16'));
  });

  it('edits an existing option and saves the new value', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(cpuOptions);
    const updateSpy = vi
      .spyOn(api, 'updateDropdownOption')
      .mockResolvedValue({ id: 'o1', category: 'cpu', value: '12', family: null });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />);

    await screen.findByRole('tab', { name: 'CPU cores' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const editInput = screen.getByLabelText('Edit 8');
    await user.clear(editInput);
    await user.type(editInput, '12');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('o1', '12'));
  });

  it('deletes an option after the confirm dialog is accepted', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(cpuOptions);
    const deleteSpy = vi.spyOn(api, 'deleteDropdownOption').mockResolvedValue(null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />);

    await screen.findByRole('tab', { name: 'CPU cores' });
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('o1'));
  });

  it('shows the users panel when the Users tab is selected', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue(cpuOptions);
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />);

    const usersTab = await screen.findByRole('tab', { name: 'Users' });
    await user.click(usersTab);

    expect(usersTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-users');
  });

  it('creates an OS option with the selected family from the add form', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue([
      { id: 'o3', category: 'os', value: 'Ubuntu 22.04', family: 'linux' },
    ]);
    const createSpy = vi
      .spyOn(api, 'createDropdownOption')
      .mockResolvedValue({ id: 'o4', category: 'os', value: 'Debian 12', family: 'linux' });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole('tab', { name: 'Operating system' }));
    await user.selectOptions(screen.getByLabelText('OS family'), 'Linux');
    await user.type(screen.getByLabelText('Add Operating system option'), 'Debian 12');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith('os', 'Debian 12', 'linux'));
  });

  it('edits an OS option and saves the selected family', async () => {
    vi.spyOn(api, 'getAllDropdownOptions').mockResolvedValue([
      { id: 'o3', category: 'os', value: 'Ubuntu 22.04', family: 'linux' },
    ]);
    const updateSpy = vi
      .spyOn(api, 'updateDropdownOption')
      .mockResolvedValue({ id: 'o3', category: 'os', value: 'Ubuntu 22.04', family: 'windows' });
    const user = userEvent.setup();

    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole('tab', { name: 'Operating system' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Family for Ubuntu 22.04'), 'Windows');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('o3', 'Ubuntu 22.04', 'windows'));
  });
});
