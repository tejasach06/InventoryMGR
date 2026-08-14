import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../api/core';
import type { User } from '../api/types';
import { UsersPanel } from '../routes/UsersPage';
import { makeUser, renderWithProviders } from './utils';
import { auth as authApi } from '../api/auth';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UsersPanel query states', () => {
  it('shows the loading skeleton while listUsers is pending', () => {
    vi.spyOn(authApi, 'listUsers').mockReturnValue(new Promise<User[]>(() => {}));

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    expect(screen.getByRole('table', { name: 'Loading data' })).toBeInTheDocument();
  });

  it('renders an error alert when listUsers rejects', async () => {
    vi.spyOn(authApi, 'listUsers').mockRejectedValue(new ApiError(500, 'Server explosion'));
    renderWithProviders(<UsersPanel />, { user: makeUser() });
    expect(await screen.findByRole('alert')).toHaveTextContent('Server explosion');
  });
  it('shows the empty state when listUsers resolves no users', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([]);

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    expect(await screen.findByText('No users')).toBeInTheDocument();
    expect(screen.getByText('Create the first managed user account.')).toBeInTheDocument();
  });

  it('shows the loading skeleton while listUsers is pending', () => {
    vi.spyOn(authApi, 'listUsers').mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<UsersPanel />, { user: makeUser() });
    expect(screen.getByRole('table', { name: 'Loading data' })).toBeInTheDocument();
  });

  it('renders a row and card for each user', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'a@b.c', role: 'viewer' }),
    ]);

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    // Both the desktop table row and the mobile card render in jsdom.
    expect(await screen.findAllByText('a@b.c')).toHaveLength(2);
    expect(screen.getByRole('rowheader', { name: 'a@b.c' })).toBeInTheDocument();
  });
});

describe('UsersPanel create flow', () => {
  it('reveals the create form when New user is clicked', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([]);

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows validation errors and does not submit when email and password are invalid', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([]);
    const createSpy = vi.spyOn(authApi, 'createUser').mockResolvedValue(makeUser());

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('keeps the password error when the password is shorter than 8 characters', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([]);
    const createSpy = vi.spyOn(authApi, 'createUser').mockResolvedValue(makeUser());

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@user.io' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.queryByText('Email is required.')).not.toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('calls createUser with the form payload and closes the form on success', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([]);
    const createSpy = vi.spyOn(authApi, 'createUser').mockResolvedValue(makeUser());

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@user.io' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longpass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        email: 'new@user.io',
        password: 'longpass1',
        role: 'viewer',
        is_active: true,
      }),
    );
    // onSuccess hides the form again.
    expect(await screen.findByRole('button', { name: 'New user' })).toBeInTheDocument();
  });
});

describe('UsersPanel update flow', () => {
  it('updates a user from the desktop row with the changed role and active flag', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'a@b.c', role: 'viewer', is_active: true }),
    ]);
    const updateSpy = vi.spyOn(authApi, 'updateUser').mockResolvedValue(
      makeUser({ id: 'u1', email: 'a@b.c', role: 'editor', is_active: false }),
    );

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    const roleSelect = await screen.findByLabelText('Role for a@b.c');
    fireEvent.change(roleSelect, { target: { value: 'editor' } });

    const row = roleSelect.closest('tr');
    expect(row).not.toBeNull();
    const scoped = within(row as HTMLElement);
    fireEvent.click(scoped.getByRole('checkbox'));
    fireEvent.click(scoped.getByRole('button', { name: 'Review access change' }));
    expect(await screen.findByRole('heading', { name: 'Review access change' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('u1', { role: 'editor', is_active: false }),
    );
  });

  it('updates a user from the mobile card after entering edit mode', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'a@b.c', role: 'viewer', is_active: true }),
    ]);
    const updateSpy = vi.spyOn(authApi, 'updateUser').mockResolvedValue(
      makeUser({ id: 'u1', email: 'a@b.c', role: 'admin', is_active: true }),
    );

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    const editButton = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editButton);

    const cardRoot = editButton.closest('div')?.parentElement;
    expect(cardRoot).not.toBeNull();
    const scoped = within(cardRoot as HTMLElement);
    fireEvent.change(scoped.getByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.click(scoped.getByRole('button', { name: 'Review access change' }));
    expect(await screen.findByRole('heading', { name: 'Review access change' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('u1', { role: 'admin', is_active: true }),
    );
  });
});


describe('UsersPanel delete flow', () => {
  it('opens a confirmation dialog and deletes a non-self user from the desktop row', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'delete-me@example.com', role: 'viewer' }),
    ]);
    const deleteSpy = vi.spyOn(authApi, 'deleteUser').mockResolvedValue(null);

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    const rowHeader = await screen.findByRole('rowheader', { name: 'delete-me@example.com' });
    const row = rowHeader.closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('heading', { name: 'Delete user' })).toBeInTheDocument();
    expect(screen.getByText('Permanently delete delete-me@example.com? This cannot be undone.')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('u1'));
  });

  it('renders delete rejection details from the desktop row', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'linked@example.com', role: 'viewer' }),
    ]);
    vi.spyOn(authApi, 'deleteUser').mockRejectedValue(new ApiError(409, 'Deactivate the account instead.'));

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    const rowHeader = await screen.findByRole('rowheader', { name: 'linked@example.com' });
    const row = rowHeader.closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Deactivate the account instead.');
  });

  it('deletes from the mobile card edit panel', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'card-delete@example.com', role: 'viewer' }),
    ]);
    const deleteSpy = vi.spyOn(authApi, 'deleteUser').mockResolvedValue(null);

    renderWithProviders(<UsersPanel />, { user: makeUser() });

    const editButton = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editButton);
    const cardRoot = editButton.closest('div')?.parentElement;
    expect(cardRoot).not.toBeNull();
    fireEvent.click(within(cardRoot as HTMLElement).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('u1'));
  });
});
