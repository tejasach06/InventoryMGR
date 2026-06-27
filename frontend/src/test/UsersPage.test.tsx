import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { api, ApiError } from '../api/client';
import type { User } from '../api/client';
import { UsersPanel } from '../routes/UsersPage';
import { makeUser, renderWithProviders } from './utils';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UsersPanel query states', () => {
  it('shows the loading skeleton while listUsers is pending', () => {
    vi.spyOn(api, 'listUsers').mockReturnValue(new Promise<User[]>(() => {}));

    renderWithProviders(<UsersPanel />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('renders an error alert when listUsers rejects', async () => {
    vi.spyOn(api, 'listUsers').mockRejectedValue(new ApiError(500, 'Server is down'));

    renderWithProviders(<UsersPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Server is down');
  });

  it('shows the empty state when listUsers resolves no users', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);

    renderWithProviders(<UsersPanel />);

    expect(await screen.findByText('No users')).toBeInTheDocument();
    expect(screen.getByText('Create the first managed user account.')).toBeInTheDocument();
  });

  it('renders a row and card for each user', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'a@b.c', role: 'viewer' }),
    ]);

    renderWithProviders(<UsersPanel />);

    // Both the desktop table row and the mobile card render in jsdom.
    expect(await screen.findAllByText('a@b.c')).toHaveLength(2);
    expect(screen.getByRole('rowheader', { name: 'a@b.c' })).toBeInTheDocument();
  });
});

describe('UsersPanel create flow', () => {
  it('reveals the create form when New user is clicked', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);

    renderWithProviders(<UsersPanel />);

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows validation errors and does not submit when email and password are invalid', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createUser').mockResolvedValue(makeUser());

    renderWithProviders(<UsersPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('keeps the password error when the password is shorter than 8 characters', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createUser').mockResolvedValue(makeUser());

    renderWithProviders(<UsersPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@user.io' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.queryByText('Email is required.')).not.toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('calls createUser with the form payload and closes the form on success', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createUser').mockResolvedValue(makeUser());

    renderWithProviders(<UsersPanel />);

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
    vi.spyOn(api, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'a@b.c', role: 'viewer', is_active: true }),
    ]);
    const updateSpy = vi.spyOn(api, 'updateUser').mockResolvedValue(
      makeUser({ id: 'u1', email: 'a@b.c', role: 'editor', is_active: false }),
    );

    renderWithProviders(<UsersPanel />);

    const roleSelect = await screen.findByLabelText('Role for a@b.c');
    fireEvent.change(roleSelect, { target: { value: 'editor' } });

    const row = roleSelect.closest('tr');
    expect(row).not.toBeNull();
    const scoped = within(row as HTMLElement);
    fireEvent.click(scoped.getByRole('checkbox'));
    fireEvent.click(scoped.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('u1', { role: 'editor', is_active: false }),
    );
  });

  it('updates a user from the mobile card after entering edit mode', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([
      makeUser({ id: 'u1', email: 'a@b.c', role: 'viewer', is_active: true }),
    ]);
    const updateSpy = vi.spyOn(api, 'updateUser').mockResolvedValue(
      makeUser({ id: 'u1', email: 'a@b.c', role: 'admin', is_active: true }),
    );

    renderWithProviders(<UsersPanel />);

    const editButton = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editButton);

    const cardRoot = editButton.closest('div')?.parentElement;
    expect(cardRoot).not.toBeNull();
    const scoped = within(cardRoot as HTMLElement);
    fireEvent.change(scoped.getByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.click(scoped.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('u1', { role: 'admin', is_active: true }),
    );
  });
});
