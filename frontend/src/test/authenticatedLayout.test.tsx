import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
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
