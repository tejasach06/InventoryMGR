import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../api/core';
import { ImportCsvPage } from '../routes/ImportCsvPage';
import { makeImportBatch, makeImportRow, renderWithProviders } from './utils';
import { imports as importsApi } from '../api/imports';

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
    const preview = vi.spyOn(importsApi, 'previewImport').mockResolvedValue(makeImportBatch());
    renderWithProviders(<ImportCsvPage />);

    const previewButton = screen.getByRole('button', { name: 'Preview partial import' });
    expect(previewButton).toBeDisabled();

    const input = screen.getByLabelText('CSV file');
    const file = csvFile();
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('vms.csv')).toBeInTheDocument();
    expect(previewButton).toBeEnabled();

    fireEvent.click(previewButton);
    await waitFor(() => expect(preview).toHaveBeenCalledWith(file, false));
  });

  it('renders the preview summary and rows on success and commits a non-blocking batch', async () => {
    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({
        id: 'batch-9',
        summary: { create: 1, update: 0, unchanged: 0, conflict: 0, invalid: 0, decommission: 0 },
        rows: [makeImportRow({ row_number: 2, action: 'create', normalized: { name: 'web-01', platform: 'proxmox', cluster: 'cluster-a' } })],
      }),
    );
    const commit = vi.spyOn(importsApi, 'commitImport').mockResolvedValue({ created: 1, updated: 0, decommissioned: 0 });
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    const summary = await screen.findByLabelText('Preview summary');
    expect(within(summary).getByText('create')).toBeInTheDocument();
    expect(screen.getByText('Batch batch-9')).toBeInTheDocument();

    const commitButton = screen.getByRole('button', { name: 'Commit persisted batch' });
    expect(commitButton).toBeEnabled();

    fireEvent.click(commitButton);
    await waitFor(() => expect(commit).toHaveBeenCalledWith('batch-9', false));
    expect(await screen.findByText(/Import committed\./)).toBeInTheDocument();
  });

  it('blocks commit when the preview has conflict or invalid rows', async () => {
    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({
        summary: { create: 0, update: 0, unchanged: 0, conflict: 1, invalid: 0, decommission: 0 },
        rows: [makeImportRow({ action: 'conflict', errors: [{ field: 'identity', message: 'duplicate CSV identity' }] })],
      }),
    );
    const commit = vi.spyOn(importsApi, 'commitImport').mockResolvedValue({ created: 0, updated: 0, decommissioned: 0 });
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    await screen.findByLabelText('Preview summary');
    expect(screen.getByText(/Commit disabled:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit persisted batch' })).toBeDisabled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('shows an Alert when the preview request fails', async () => {
    vi.spyOn(importsApi, 'previewImport').mockRejectedValue(new ApiError(400, 'Missing required header: name'));
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    expect(await screen.findByText('Missing required header: name')).toBeInTheDocument();
  });

  it('accepts a CSV dropped onto the upload zone', () => {
    renderWithProviders(<ImportCsvPage />);
    const dropzone = screen.getByTestId('dropzone');
    fireEvent.drop(dropzone, { dataTransfer: { files: [csvFile('dropped.csv')] } });

    expect(screen.getByText('dropped.csv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview partial import' })).toBeEnabled();
  });
  it('clears selected file when clear button is clicked', () => {
    renderWithProviders(<ImportCsvPage />);
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    const file = csvFile('vms.csv');
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText('vms.csv')).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: 'Clear selected file' });
    fireEvent.click(clearButton);

    expect(screen.queryByText('vms.csv')).not.toBeInTheDocument();
    expect(screen.getByText('Drag and drop or click to upload')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview partial import' })).toBeDisabled();
  });

  it('downloads the CSV template from the API endpoint', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<ImportCsvPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Download template' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('tells the user the template ships sample rows to delete', () => {
    renderWithProviders(<ImportCsvPage />);

    expect(
      screen.getByText(/two SAMPLE- rows you should delete/i),
    ).toBeInTheDocument();
  });


  it('shows unchanged rows in their own summary card', async () => {
    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({ summary: { create: 0, update: 0, unchanged: 2, conflict: 0, invalid: 0, decommission: 0 } }),
    );
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    const card = await screen.findByTestId('summary-unchanged');
    expect(within(card).getByText('2')).toBeInTheDocument();
  });

  it('summarizes which fields the import will change', async () => {
    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({
        summary: { create: 0, update: 40, unchanged: 0, conflict: 0, invalid: 0, decommission: 0 },
        field_changes: { owner: 40, status: 3 },
      }),
    );
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    expect(await screen.findByText(/owner/)).toBeInTheDocument();
    expect(screen.getByText(/on 40 VMs/i)).toBeInTheDocument();
    expect(screen.getByText(/on 3 VMs/i)).toBeInTheDocument();
  });

  it('warns about ignored columns', async () => {
    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({ ignored_columns: ['vmid', 'maxmem'] }),
    );
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    expect(await screen.findByText(/2 columns ignored/i)).toBeInTheDocument();
    expect(screen.getByText(/vmid, maxmem/)).toBeInTheDocument();
  });

  it('previews every disk and every role-scoped IP in the row', async () => {
    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({
        rows: [
          makeImportRow({
            action: 'create',
            raw: {
              name: 'web-01',
              platform: 'proxmox',
              cluster: 'cluster-a',
              disks: 'os:100;data:500',
              private_ip: '10.0.0.5;10.0.0.6',
              public_ip: '203.0.113.4',
              backup_ip: '',
            },
          }),
        ],
      }),
    );
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    expect(await screen.findByText('os:100;data:500')).toBeInTheDocument();
    // All three role columns collapse into one cell; the empty one is skipped.
    expect(screen.getByText('10.0.0.5;10.0.0.6, 203.0.113.4')).toBeInTheDocument();
  });

  it('previews full inventory import and displays decommission warnings and rows', async () => {
    const preview = vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({
        id: 'batch-full',
        full_inventory: true,
        summary: { create: 0, update: 0, unchanged: 1, conflict: 0, invalid: 0, decommission: 1, decommission_candidate_total: 2 },
        rows: [
          makeImportRow({
            row_number: 2,
            action: 'unchanged',
            normalized: { name: 'alpha', platform: 'proxmox', cluster: 'cluster-a' },
          }),
          makeImportRow({
            id: 'row-decom',
            row_number: 3,
            action: 'decommission',
            raw: { name: 'beta', platform: 'proxmox', cluster: 'cluster-a' },
            normalized: null,
          }),
        ],
      }),
    );
    const commit = vi.spyOn(importsApi, 'commitImport').mockResolvedValue({ created: 0, updated: 0, decommissioned: 1 });
    renderWithProviders(<ImportCsvPage />);

    const file = csvFile();
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
    const fullPreviewBtn = screen.getByRole('button', { name: 'Preview full inventory import' });
    fireEvent.click(fullPreviewBtn);

    await waitFor(() => expect(preview).toHaveBeenCalledWith(file, true));

    expect(await screen.findByText(/Full inventory import: 1 VMs missing/)).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();

    const commitButton = screen.getByRole('button', { name: 'Commit persisted batch' });
    expect(commitButton).toBeEnabled();

    fireEvent.click(commitButton);
    await waitFor(() => expect(commit).toHaveBeenCalledWith('batch-full', false));
    expect(await screen.findByText(/1 decommissioned\./)).toBeInTheDocument();
  });

  it('requires confirmation checkbox when decommission exceeds 50% threshold', async () => {
    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(
      makeImportBatch({
        id: 'batch-major',
        full_inventory: true,
        summary: { create: 0, update: 0, unchanged: 1, conflict: 0, invalid: 0, decommission: 2, decommission_candidate_total: 3 },
        rows: [
          makeImportRow({ row_number: 2, action: 'unchanged', normalized: { name: 'alpha', platform: 'proxmox', cluster: 'c1' } }),
          makeImportRow({ id: 'r2', row_number: 3, action: 'decommission', raw: { name: 'beta', platform: 'proxmox', cluster: 'c1' }, normalized: null }),
          makeImportRow({ id: 'r3', row_number: 4, action: 'decommission', raw: { name: 'gamma', platform: 'proxmox', cluster: 'c1' }, normalized: null }),
        ],
      }),
    );
    const commit = vi.spyOn(importsApi, 'commitImport').mockResolvedValue({ created: 0, updated: 0, decommissioned: 2 });
    renderWithProviders(<ImportCsvPage />);

    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview full inventory import' }));

    const commitButton = await screen.findByRole('button', { name: 'Commit persisted batch' });
    expect(commitButton).toBeDisabled();

    const checkbox = screen.getByLabelText(/I confirm decommissioning more than half/);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(commitButton).toBeEnabled();

    fireEvent.click(commitButton);
    await waitFor(() => expect(commit).toHaveBeenCalledWith('batch-major', true));
  });
});
