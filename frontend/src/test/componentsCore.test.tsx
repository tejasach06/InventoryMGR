import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '../api/client';
import { RoleGate, useCurrentUser } from '../components/AuthContext';
import { AppLayout } from '../components/Layout';
import {
  Alert,
  Badge,
  EmptyState,
  FieldError,
  PageHeader,
  PageTransition,
  Skeleton,
  Spinner,
  TableSkeleton,
} from '../components/ui';
import { makeUser, renderWithProviders } from './utils';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => '/inventory',
}));

beforeEach(() => {
  replaceMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AuthContext', () => {
  function ShowRole() {
    const user = useCurrentUser();
    return <span>role:{user.role}</span>;
  }

  it('provides the current user through context', () => {
    renderWithProviders(<ShowRole />, { user: makeUser({ role: 'editor' }) });
    expect(screen.getByText('role:editor')).toBeInTheDocument();
  });

  it('throws when useCurrentUser is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ShowRole />)).toThrow('useCurrentUser must be used inside CurrentUserProvider');
    spy.mockRestore();
  });

  it('renders children when the role is allowed', () => {
    renderWithProviders(
      <RoleGate allowed={['admin', 'editor']} message="denied">
        <span>secret content</span>
      </RoleGate>,
      { user: makeUser({ role: 'admin' }) },
    );
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });

  it('renders the denial message when the role is not allowed', () => {
    renderWithProviders(
      <RoleGate allowed={['admin']} message="You need admin access.">
        <span>secret content</span>
      </RoleGate>,
      { user: makeUser({ role: 'viewer' }) },
    );
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
    expect(screen.getByText('You need admin access.')).toBeInTheDocument();
  });
});

describe('AppLayout', () => {
  it('shows the user identity and admin navigation', () => {
    renderWithProviders(<AppLayout user={makeUser({ role: 'admin' })}>page body</AppLayout>);

    expect(screen.getByText('admin@example.local')).toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('toggles and persists the collapsed sidebar state', () => {
    renderWithProviders(<AppLayout user={makeUser()}>body</AppLayout>);

    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    fireEvent.click(collapse);

    expect(window.localStorage.getItem('sidebar-collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('starts collapsed when localStorage says so', () => {
    window.localStorage.setItem('sidebar-collapsed', 'true');
    renderWithProviders(<AppLayout user={makeUser()}>body</AppLayout>);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('logs out and redirects to /login', async () => {
    const logout = vi.spyOn(api, 'logout').mockResolvedValue(null);
    renderWithProviders(<AppLayout user={makeUser()}>body</AppLayout>);

    fireEvent.click(screen.getAllByRole('button', { name: 'Logout' })[0]);

    await waitFor(() => expect(logout).toHaveBeenCalled());
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });
});

describe('ui primitives', () => {
  it('uses role=alert for error tone and role=status otherwise', () => {
    const { rerender } = render(<Alert>boom</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');

    rerender(<Alert tone="success">done</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('done');
  });

  it('renders badges for known and unknown values', () => {
    render(
      <div>
        <Badge value="running" />
        <Badge value="mystery" />
      </div>,
    );
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });

  it('renders FieldError only when a message is present', () => {
    const { rerender } = render(<FieldError id="e1" message="required" />);
    expect(screen.getByText('required')).toHaveAttribute('id', 'e1');

    rerender(<FieldError id="e1" />);
    expect(screen.queryByText('required')).not.toBeInTheDocument();
  });

  it('renders PageHeader with optional eyebrow and actions', () => {
    const { rerender } = render(<PageHeader title="Inventory" />);
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();

    rerender(<PageHeader title="Inventory" eyebrow="VMs" actions={<button type="button">New</button>} />);
    expect(screen.getByText('VMs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('renders EmptyState with and without an icon', () => {
    const { rerender } = render(<EmptyState title="Nothing" body="No rows yet." />);
    expect(screen.getByRole('heading', { name: 'Nothing' })).toBeInTheDocument();

    rerender(<EmptyState title="Nothing" body="No rows yet." icon={<svg data-testid="icon" />} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders the loading and layout helpers', () => {
    render(
      <div>
        <Spinner />
        <Skeleton className="h-4" />
        <TableSkeleton rows={2} cols={3} />
        <PageTransition className="x">content</PageTransition>
      </div>,
    );
    const loading = screen.getByRole('status', { name: 'Loading' });
    expect(within(loading).getAllByRole('cell').length).toBe(6);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
