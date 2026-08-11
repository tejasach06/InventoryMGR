import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { auth as authApi } from '../api/auth';
import { ApiError } from '../api/core';
import { LoginPage } from '../routes/LoginPage';
import { makeUser, renderWithProviders } from './utils';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

beforeEach(() => {
  replaceMock.mockReset();
  vi.spyOn(authApi, 'setupStatus').mockResolvedValue({ setup_required: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LoginPage sign-in flow', () => {
  it('blocks submission and shows field errors when email/password are empty', async () => {
    const login = vi.spyOn(authApi, 'login');
    renderWithProviders(<LoginPage />);

    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('logs in with trimmed credentials and redirects to /inventory', async () => {
    const login = vi.spyOn(authApi, 'login').mockResolvedValue({ user: makeUser() });
    renderWithProviders(<LoginPage />);

    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  admin@example.local  ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('admin@example.local', 'hunter2pass', false));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/inventory'));
  });

  it('passes remember=true to authApi.login when checkbox is checked', async () => {
    const login = vi.spyOn(authApi, 'login').mockResolvedValue({ user: makeUser() });
    renderWithProviders(<LoginPage />);

    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.local' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2pass' } });
    fireEvent.click(screen.getByLabelText('Keep me signed in on this device'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('admin@example.local', 'hunter2pass', true));
  });

  it('shows an Alert when authentication fails', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    renderWithProviders(<LoginPage />);

    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.local' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
