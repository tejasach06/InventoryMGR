import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { api } from '../api/client';
import { InventoryPage } from '../routes/InventoryPage';
import { makeUser, makeVm, renderWithProviders } from './utils';
import type { VmList } from '../api/client';

const { pushMock, router, searchParams } = vi.hoisted(() => {
  const pushMock = vi.fn();
  return { pushMock, router: { push: pushMock }, searchParams: new URLSearchParams() };
});

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/inventory',
  useSearchParams: () => searchParams,
}));

const list: VmList = { items: [makeVm()], total: 1, limit: 50, offset: 0 };

beforeEach(() => {
  pushMock.mockReset();
  vi.spyOn(api, 'listVms').mockResolvedValue(list);
  vi.spyOn(api, 'listVmOwners').mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  searchParams.forEach((_v, k) => searchParams.delete(k));
});

describe('InventoryPage dynamic filter disclosure', () => {
  it('keeps Search, Platform, Status, and Criticality always visible', () => {
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Platform')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Criticality')).toBeInTheDocument();
  });

  it('hides advanced filters until "+ Add filter" reveals them', () => {
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

    expect(screen.queryByLabelText('Node')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Node' }));

    expect(screen.getByLabelText('Node')).toBeInTheDocument();
  });

  it('encodes a non-default operator into the pushed URL', () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });
      fireEvent.change(screen.getByLabelText('Criticality'), { target: { value: 'high' } });
      fireEvent.change(screen.getByLabelText('Criticality operator'), { target: { value: 'neq' } });
      act(() => { vi.advanceTimersByTime(400); });
      const target = pushMock.mock.calls[0][0] as string;
      expect(target).toContain('criticality=high');
      expect(target).toContain('criticality_op=neq');
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits the operator param when it is the field default', () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });
      fireEvent.change(screen.getByLabelText('Criticality'), { target: { value: 'high' } });
      act(() => { vi.advanceTimersByTime(400); });
      const target = pushMock.mock.calls[0][0] as string;
      expect(target).toContain('criticality=high');
      expect(target).not.toContain('criticality_op');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pre-reveals an advanced filter that is already active from the URL', () => {
    searchParams.set('tag', 'web');
    renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });
    expect(screen.getByLabelText('Tag')).toBeInTheDocument();
  });
});
