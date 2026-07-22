import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../components/NotificationBell';
import { renderWithProviders } from './utils';
import { api } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: { ...actual.api, decommissionNotifications: vi.fn(), ackDecommissions: vi.fn() },
  };
});

const due = [
  { vm_id: '1', name: 'web-01', decommission_date: '2026-08-01', days_remaining: 5, unread: true },
  { vm_id: '2', name: 'db-02', decommission_date: '2026-07-10', days_remaining: -3, unread: false },
];

describe('NotificationBell', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(api.decommissionNotifications).mockResolvedValue(due as never);
    vi.mocked(api.ackDecommissions).mockResolvedValue(null as never);
  });

  it('hides the badge when nothing is unread', async () => {
    vi.mocked(api.decommissionNotifications).mockResolvedValueOnce([] as never);
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(api.decommissionNotifications).toHaveBeenCalled());
    expect(screen.queryByTestId('notif-badge')).toBeNull();
  });

  it('opens panel, lists VMs, marks overdue red, and acks on open', async () => {
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId('notif-badge')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('web-01')).toBeInTheDocument();
    expect(screen.getByText('db-02').closest('a')).toHaveClass('text-red-600');
    await waitFor(() => expect(api.ackDecommissions).toHaveBeenCalledWith());
  });
});
