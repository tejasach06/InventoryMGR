import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../components/NotificationBell';
import { renderWithProviders } from './utils';
import { vms as vmsApi } from '../api/vms';

vi.mock('../api/vms', () => ({
  vms: { decommissionNotifications: vi.fn(), ackDecommissions: vi.fn() },
}));

const due = [
  { vm_id: '1', name: 'web-01', decommission_date: '2026-08-01', days_remaining: 5, unread: true },
  { vm_id: '2', name: 'db-02', decommission_date: '2026-07-10', days_remaining: -3, unread: false },
];

describe('NotificationBell', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(vmsApi.decommissionNotifications).mockResolvedValue(due as never);
    vi.mocked(vmsApi.ackDecommissions).mockResolvedValue(null as never);
  });

  it('hides the badge when nothing is unread', async () => {
    vi.mocked(vmsApi.decommissionNotifications).mockResolvedValueOnce([] as never);
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(vmsApi.decommissionNotifications).toHaveBeenCalled());
    expect(screen.queryByTestId('notif-badge')).toBeNull();
  });

  it('opens panel, lists VMs, marks overdue red, and acks on open', async () => {
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId('notif-badge')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('web-01')).toBeInTheDocument();
    expect(screen.getByText('db-02').closest('a')).toHaveClass('text-[var(--color-criticality-critical)]');
    await waitFor(() => expect(vmsApi.ackDecommissions).toHaveBeenCalledWith());
  });
  it('dismisses a single alert optimistically and calls scoped ackDecommissions', async () => {
    renderWithProviders(<NotificationBell />);
    await screen.findByTestId('notif-badge');
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('web-01')).toBeInTheDocument();
    expect(screen.getByText('db-02')).toBeInTheDocument();

    vi.mocked(vmsApi.decommissionNotifications).mockResolvedValue([due[1]] as never);
    fireEvent.click(screen.getByRole('button', { name: /dismiss alert for web-01/i }));
    await waitFor(() => expect(screen.queryByText('web-01')).toBeNull());
    expect(screen.getByText('db-02')).toBeInTheDocument();
    expect(vmsApi.ackDecommissions).toHaveBeenCalledWith(['1']);
  });

  it('closes panel on outside click and Escape key', async () => {
    renderWithProviders(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Upcoming decommissions')).toBeInTheDocument();

    // Outside click
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('Upcoming decommissions')).toBeNull());

    // Re-open and test Escape key
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Upcoming decommissions')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Upcoming decommissions')).toBeNull());
  });
});
