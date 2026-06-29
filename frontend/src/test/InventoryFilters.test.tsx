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
});

describe('InventoryPage filters', () => {
  it('applies every dropdown filter and pushes the query after debounce', () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<InventoryPage />, { user: makeUser({ role: 'admin' }) });

      fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'vmware' } });
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'powered_off' } });
      fireEvent.change(screen.getByLabelText('Criticality'), { target: { value: 'high' } });
      fireEvent.change(screen.getByLabelText('Lifecycle'), { target: { value: 'retired' } });

      act(() => { vi.advanceTimersByTime(400); });

      expect(pushMock).toHaveBeenCalledTimes(1);
      const target = pushMock.mock.calls[0][0] as string;
      expect(target).toContain('platform=vmware');
      expect(target).toContain('status=powered_off');
      expect(target).toContain('criticality=high');
      expect(target).toContain('lifecycle=retired');
    } finally {
      vi.useRealTimers();
    }
  });
});
