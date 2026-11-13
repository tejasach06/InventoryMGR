import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Providers } from '../app/providers';
import { auth as authApi } from '../api/auth';
import { ApiError } from '../api/core';
import AuthenticatedLayout from '../app/(app)/layout';
import { makeUser, renderWithProviders } from './utils';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  replaceMock.mockReset();
});

function RejectedRequest({ mutation, error }: { mutation: boolean; error: Error }) {
  const client = useQueryClient();
  const request = async () => { throw error; };
  const action = useMutation({ mutationFn: request });
  return <button onClick={() => {
    if (mutation) action.mutate();
    else void client.fetchQuery({ queryKey: ['inventory'], queryFn: request }).catch(() => {});
  }}>Load inventory</button>;
}

describe('expired sessions with a cached account', () => {
  it.each([false, true])('redirects after a rejected request (mutation=%s)', async (mutation) => {
    vi.spyOn(authApi, 'me').mockResolvedValue(makeUser());
    render(<Providers><AuthenticatedLayout>
      <RejectedRequest mutation={mutation} error={new ApiError(401, 'Not authenticated')} />
    </AuthenticatedLayout></Providers>);
    fireEvent.click(await screen.findByText('Load inventory'));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('Load inventory')).toBeNull();
  });

  it.each([new ApiError(403, 'Forbidden'), new Error('Network request failed')])('keeps the session after %s', async (error) => {
    vi.spyOn(authApi, 'me').mockResolvedValue(makeUser());
    render(<Providers><AuthenticatedLayout>
      <RejectedRequest mutation={false} error={error} />
    </AuthenticatedLayout></Providers>);
    fireEvent.click(await screen.findByText('Load inventory'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText('Load inventory')).toBeInTheDocument();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AuthenticatedLayout', () => {
  it('redirects to /login when /auth/me returns 401', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValue(new ApiError(401, 'Not authenticated'));
    renderWithProviders(
      <AuthenticatedLayout>
        <div>Child content</div>
      </AuthenticatedLayout>
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('Child content')).toBeNull();
  });

  it('does not redirect when /auth/me fails with a network error', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValue(new Error('Network request failed'));
    renderWithProviders(
      <AuthenticatedLayout>
        <div>Child content</div>
      </AuthenticatedLayout>
    );

    await waitFor(() => {
      expect(screen.getByText('Could not load your session.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Child content')).toBeNull();
  });

  it('renders children for an authenticated editor', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue(makeUser({ role: 'editor' }));
    renderWithProviders(
      <AuthenticatedLayout>
        <div>Child content</div>
      </AuthenticatedLayout>
    );

    await waitFor(() => {
      expect(screen.getByText('Child content')).toBeInTheDocument();
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
