import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { api, ApiError } from '../api/client';
import { ImportCsvPage, TEMPLATE_HEADERS } from '../routes/ImportCsvPage';
import { makeImportBatch, makeImportRow, renderWithProviders } from './utils';

function csvFile(name = 'vms.csv'): File {
  return new File(['name,platform,cluster\nweb-01,proxmox,cluster-a'], name, { type: 'text/csv' });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ImportCsvPage', () => {
  it('disables Preview until a file is chosen, then previews the selected file', async () => {
    const preview = vi.spyOn(api, 'previewImport').mockResolvedValue(makeImportBatch());
    renderWithProviders(<ImportCsvPage />);

    const previewButton = screen.getByRole('button', { name: 'Preview CSV' });
    expect(previewButton).toBeDisabled();

    const input = screen.getByLabelText('CSV file');
    const file = csvFile();
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('vms.csv')).toBeInTheDocument();
    expect(previewButton).toBeEnabled();

    fireEvent.click(previewButton);
    await waitFor(() => expect(preview).toHaveBeenCalledWith(file));
  });

  it('renders the preview summary and rows on success and commits a non-blocking batch', async () => {
    vi.spyOn(api, 'previewImport').mockResolvedValue(
      makeImportBatch({
        id: 'batch-9',
        summary: { create: 1, update: 0, conflict: 0, invalid: 0 },
        rows: [makeImportRow({ row_number: 2, action: 'create', normalized: { name: 'web-01', platform: 'proxmox', cluster: 'cluster-a' } })],
      }),
    );
    const commit = vi.spyOn(api, 'commitImport').mockResolvedValue({ created: 1, updated: 0 });
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview CSV' }));

    const summary = await screen.findByLabelText('Preview summary');
    expect(within(summary).getByText('create')).toBeInTheDocument();
    expect(screen.getByText('Batch batch-9')).toBeInTheDocument();

    const commitButton = screen.getByRole('button', { name: 'Commit persisted batch' });
    expect(commitButton).toBeEnabled();

    fireEvent.click(commitButton);
    await waitFor(() => expect(commit).toHaveBeenCalledWith('batch-9'));
    expect(await screen.findByText(/Import committed\./)).toBeInTheDocument();
  });

  it('blocks commit when the preview has conflict or invalid rows', async () => {
    vi.spyOn(api, 'previewImport').mockResolvedValue(
      makeImportBatch({
        summary: { create: 0, update: 0, conflict: 1, invalid: 0 },
        rows: [makeImportRow({ action: 'conflict', errors: [{ field: 'identity', message: 'duplicate CSV identity' }] })],
      }),
    );
    const commit = vi.spyOn(api, 'commitImport').mockResolvedValue({ created: 0, updated: 0 });
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview CSV' }));

    await screen.findByLabelText('Preview summary');
    expect(screen.getByText(/Commit disabled:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit persisted batch' })).toBeDisabled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('shows an Alert when the preview request fails', async () => {
    vi.spyOn(api, 'previewImport').mockRejectedValue(new ApiError(400, 'Missing required header: name'));
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview CSV' }));

    expect(await screen.findByText('Missing required header: name')).toBeInTheDocument();
  });

  it('accepts a CSV dropped onto the upload zone', () => {
    renderWithProviders(<ImportCsvPage />);
    const dropzone = screen.getByRole('button', { name: 'Upload CSV file' });

    fireEvent.drop(dropzone, { dataTransfer: { files: [csvFile('dropped.csv')] } });

    expect(screen.getByText('dropped.csv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview CSV' })).toBeEnabled();
  });

  it('downloads a CSV template without a network call', () => {
    const createUrl = vi.fn(() => 'blob:template');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<ImportCsvPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Download template' }));

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('exposes template headers including sr_id, os_family, backup_enabled and not backup_status', () => {
    expect(TEMPLATE_HEADERS).toContain('sr_id');
    expect(TEMPLATE_HEADERS).toContain('os_family');
    expect(TEMPLATE_HEADERS).toContain('backup_enabled');
    expect(TEMPLATE_HEADERS).not.toContain('backup_status');
  });
});
