import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { ImportCsvPage } from '../routes/ImportCsvPage';
import { imports as importsApi } from '../api/imports';
import { makeImportBatch, makeImportRow, renderWithProviders } from './utils';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ImportCsvPage - IP Mappings', () => {
  it('documents ip_mappings format and update semantics in CSV format reference', () => {
    renderWithProviders(<ImportCsvPage />);

    expect(
      screen.getByText(/Map public IPs to private IPs with ip_mappings using public>private/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Missing or blank mappings preserve existing links; nonblank cells add pairs idempotently/)
    ).toBeInTheDocument();
  });

  it('renders IP mappings in the preview table when present on a row', async () => {
    const batch = makeImportBatch({
      id: 'batch-ip-test',
      filename: 'inventory.csv',
      summary: {
        create: 1,
        update: 0,
        unchanged: 0,
        conflict: 0,
        invalid: 0,
        decommission: 0,
      },
      rows: [
        makeImportRow({
          id: 'row-1',
          row_number: 1,
          action: 'create',
          raw: {
            name: 'mapped-vm',
            platform: 'proxmox',
            cluster: 'prod',
            public_ip: '203.0.113.10',
            private_ip: '10.0.0.10',
            ip_mappings: '203.0.113.10>10.0.0.10',
          },
          normalized: {
            name: 'mapped-vm',
            platform: 'proxmox',
            cluster: 'prod',
            ip_mappings: [
              { public_ip: '203.0.113.10', private_ip: '10.0.0.10' },
            ],
          },
        }),
      ],
    });

    vi.spyOn(importsApi, 'previewImport').mockResolvedValue(batch);

    renderWithProviders(<ImportCsvPage />);

    const file = new File(['name,platform,cluster\n'], 'inventory.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Preview partial import' }));

    expect(await screen.findByText(/batch-ip-test/i)).toBeInTheDocument();
    expect(screen.getByText('Mappings:')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.10>10.0.0.10')).toBeInTheDocument();
  });
});
