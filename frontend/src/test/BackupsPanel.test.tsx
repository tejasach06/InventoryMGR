import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { backups as backupsApi } from '../api/backups';
import type { BackupsOverview } from '../api/types';
import { BackupsPanel } from '../routes/BackupsPanel';
import { makeUser, renderWithProviders } from './utils';

const mockOverview: BackupsOverview = {
  backups: [
    {
      name: 'inventorymgr-20260825T120000Z-manual.dump',
      size_bytes: 1048576 * 5, // 5 MB
      created_at: '2026-08-25T12:00:00Z',
    },
  ],
  jobs: [
    {
      id: 'job-1',
      kind: 'manual',
      status: 'success',
      filename: 'inventorymgr-20260825T120000Z-manual.dump',
      size_bytes: 1048576 * 5,
      error: 'Some warning message',
      user_id: 'u-admin',
      started_at: '2026-08-25T12:00:00Z',
      finished_at: '2026-08-25T12:00:05Z',
    },
  ],
  settings: {
    enabled: true,
    hour_utc: 3,
    retention: 14,
  },
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BackupsPanel', () => {
  it('renders overview data including backups, schedule settings, and download URL', async () => {
    vi.spyOn(backupsApi, 'overview').mockResolvedValue(mockOverview);

    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    await waitFor(() => {
      expect(screen.getAllByText('inventorymgr-20260825T120000Z-manual.dump')[0]).toBeInTheDocument();
      expect(screen.getByText('5 MB')).toBeInTheDocument();
      expect(screen.getByLabelText('Enable automated nightly backups')).toBeChecked();
    });

    const downloadLink = screen.getByRole('link', { name: 'Download' });
    expect(downloadLink).toHaveAttribute(
      'href',
      '/api/backups/inventorymgr-20260825T120000Z-manual.dump/download'
    );
  });

  it('renders loading skeletons while query is loading', () => {
    vi.spyOn(backupsApi, 'overview').mockReturnValue(new Promise<BackupsOverview>(() => {}));
    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    expect(document.querySelector('.animate-fade-in')).toBeInTheDocument();
  });

  it('renders error alert when query fails', async () => {
    vi.spyOn(backupsApi, 'overview').mockRejectedValue(new Error('Network failure'));
    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network failure');
    });
  });

  it('renders empty state when backups and jobs arrays are empty', async () => {
    vi.spyOn(backupsApi, 'overview').mockResolvedValue({
      backups: [],
      jobs: [],
      settings: { enabled: false, hour_utc: 2, retention: 7 },
    });

    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    await waitFor(() => {
      expect(screen.getByText('No backups yet.')).toBeInTheDocument();
      expect(screen.getByText('No recent activity.')).toBeInTheDocument();
    });
  });

  it('clicking "Back up now" triggers backup creation and handles error', async () => {
    vi.spyOn(backupsApi, 'overview').mockResolvedValue(mockOverview);
    const createSpy = vi.spyOn(backupsApi, 'create').mockRejectedValue(new Error('Disk full'));

    const user = userEvent.setup();
    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(createSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText('Disk full')).toBeInTheDocument();
    });
  });

  it('restore flow: handles cancel dialog, file change, error, and success', async () => {
    vi.spyOn(backupsApi, 'overview').mockResolvedValue(mockOverview);
    const restoreSpy = vi.spyOn(backupsApi, 'restore').mockRejectedValueOnce(new Error('Restore failed')).mockResolvedValueOnce({
      id: 'job-3',
      kind: 'restore',
      status: 'success',
      filename: 'test.dump',
      size_bytes: 1024,
      error: null,
      user_id: 'u-admin',
      started_at: '2026-08-25T14:00:00Z',
      finished_at: '2026-08-25T14:00:05Z',
    });
    const user = userEvent.setup();

    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore Database' })).toBeDisabled();
    });

    const fileInput = screen.getByLabelText('Backup Archive (.dump)');
    const confirmInput = screen.getByPlaceholderText('RESTORE');
    const restoreBtn = screen.getByRole('button', { name: 'Restore Database' });

    // Type partial confirm
    await user.type(confirmInput, 'REST');
    expect(restoreBtn).toBeDisabled();

    // Type full confirm but no file
    await user.type(confirmInput, 'ORE');
    expect(restoreBtn).toBeDisabled();

    // Select a file
    const file = new File(['PGDMPdummycontent'], 'test.dump', { type: 'application/octet-stream' });
    await user.upload(fileInput, file);
    expect(restoreBtn).toBeEnabled();

    // Empty file input change triggers null branch
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(restoreBtn).toBeDisabled();

    // Upload again
    await user.upload(fileInput, file);
    expect(restoreBtn).toBeEnabled();

    // Click restore -> opens confirm dialog -> Cancel
    await user.click(restoreBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const cancelRestoreBtn = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelRestoreBtn);

    // Open again -> Confirm -> fails
    await user.click(restoreBtn);
    const confirmRestoreBtn = screen.getByRole('button', { name: 'Restore Now' });
    await user.click(confirmRestoreBtn);

    await waitFor(() => {
      expect(screen.getByText('Restore failed')).toBeInTheDocument();
    });

    // Open again -> Confirm -> succeeds
    await user.click(restoreBtn);
    await user.click(screen.getByRole('button', { name: 'Restore Now' }));

    await waitFor(() => {
      expect(restoreSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Database restored successfully/)).toBeInTheDocument();
    });
  });

  it('deleting a backup: handles cancel dialog and confirm remove', async () => {
    vi.spyOn(backupsApi, 'overview').mockResolvedValue(mockOverview);
    const removeSpy = vi.spyOn(backupsApi, 'remove').mockResolvedValue(null);
    const user = userEvent.setup();

    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Delete backup inventorymgr-20260825T120000Z-manual.dump',
        })
      ).toBeInTheDocument();
    });

    // Click delete -> cancel
    await user.click(
      screen.getByRole('button', {
        name: 'Delete backup inventorymgr-20260825T120000Z-manual.dump',
      })
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Click delete -> confirm
    await user.click(
      screen.getByRole('button', {
        name: 'Delete backup inventorymgr-20260825T120000Z-manual.dump',
      })
    );
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    await user.click(confirmBtn);

    expect(removeSpy).toHaveBeenCalledWith('inventorymgr-20260825T120000Z-manual.dump');
  });

  it('submitting schedule form calls updateSettings and handles error', async () => {
    vi.spyOn(backupsApi, 'overview').mockResolvedValue(mockOverview);
    const updateSpy = vi.spyOn(backupsApi, 'updateSettings').mockRejectedValueOnce(new Error('Settings update failed')).mockResolvedValueOnce({
      enabled: false,
      hour_utc: 5,
      retention: 30,
    });
    const user = userEvent.setup();

    renderWithProviders(<BackupsPanel />, { user: makeUser() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Schedule' })).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Enable automated nightly backups'));
    await user.selectOptions(screen.getByLabelText('Run Hour (UTC)'), '5');
    await user.clear(screen.getByLabelText('Retention (dumps kept)'));
    await user.type(screen.getByLabelText('Retention (dumps kept)'), '30');

    // First save fails
    await user.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(screen.getByText('Settings update failed')).toBeInTheDocument();
    });

    // Second save succeeds
    await user.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    expect(updateSpy).toHaveBeenCalledTimes(2);
  });
});
