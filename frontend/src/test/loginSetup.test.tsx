/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../routes/LoginPage';
import { ThemeProvider } from '../components/ThemeProvider';
import type * as ApiClient from '../api/client';

const { replaceMock, setupStatusMock, setupAdminMock, loginMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  setupStatusMock: vi.fn(),
  setupAdminMock: vi.fn(),
  loginMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('../api/client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return {
    ...actual,
    api: {
      ...actual.api,
      setupStatus: setupStatusMock,
      setupAdmin: setupAdminMock,
      login: loginMock,
    },
  };
});

function mockMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderLoginPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      ThemeProvider,
      null,
      createElement(QueryClientProvider, { client: queryClient }, createElement(LoginPage)),
    ),
  );
}

beforeEach(() => {
  mockMatchMedia();
  replaceMock.mockReset();
  setupStatusMock.mockReset();
  setupAdminMock.mockReset();
  loginMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('LoginPage new-setup conversion', () => {
  it('converts to the admin onboarding form when setup is required', async () => {
    setupStatusMock.mockResolvedValue({ setup_required: true });

    renderLoginPage();

    expect(await screen.findByRole('heading', { name: 'Create admin account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create admin account' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows the sign-in form when setup is already complete', async () => {
    setupStatusMock.mockResolvedValue({ setup_required: false });

    renderLoginPage();

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create admin account' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
  });

  it('creates the first admin and redirects to the app on submit', async () => {
    setupStatusMock.mockResolvedValue({ setup_required: true });
    setupAdminMock.mockResolvedValue({
      user: { id: 'u1', email: 'admin@example.local', role: 'admin', is_active: true },
    });

    renderLoginPage();

    await screen.findByRole('heading', { name: 'Create admin account' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.local' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'supersecret123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'supersecret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create admin account' }));

    await waitFor(() =>
      expect(setupAdminMock).toHaveBeenCalledWith('admin@example.local', 'supersecret123'),
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/inventory'));
  });
});
