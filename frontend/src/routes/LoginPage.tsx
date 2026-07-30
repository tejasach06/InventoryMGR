'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, detailMessage } from '../api/client';
import { ThemeSelect } from '../components/ThemeProvider';
import { Alert, FieldError, Logo, Spinner, authInputClass, labelClass, primaryButtonClass } from '../components/ui';

const authCardClass = 'w-full max-w-[420px] animate-rise rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/85 p-8 shadow-overlay backdrop-blur-xl';

function validateLogin(email: string, password: string) {
  return {
    email: email.trim().length === 0 ? 'Email is required.' : undefined,
    password: password.length === 0 ? 'Password is required.' : undefined,
  };
}

function validateSetup(email: string, password: string, confirmPassword: string) {
  return {
    email: email.trim().length === 0 ? 'Email is required.' : undefined,
    password: password.length < 8 ? 'Password must be at least 8 characters.' : undefined,
    confirmPassword: confirmPassword !== password ? 'Passwords do not match.' : undefined,
  };
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <div className="absolute right-4 top-4 z-20"><ThemeSelect /></div>
      <aside className="auth-gradient relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '28px 28px' }} aria-hidden="true" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-orange-400/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <Logo className="h-9 w-9 rounded-lg ring-1 ring-white/20" />
          <span className="font-display text-lg font-semibold tracking-tight">InventoryMGR</span>
        </div>
        <div className="relative">
          <h2 className="font-display text-5xl font-semibold leading-[1.05] tracking-[-0.02em]">Every virtual machine,<br />accounted for.</h2>
          <p className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-white/85">A single source of truth for your Proxmox and VMware fleet — inventory, lifecycle, ownership, and bulk CSV import in one console.</p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {['Unified Proxmox + VMware inventory', 'Role-based access for every team', 'Preview-then-commit CSV import'].map((f) => (
              <li key={f} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#ffb690]/20 text-[#ffb690]">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6" /></svg>
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">Secure, role-based VM inventory management.</p>
      </aside>
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-secondary)] px-4 py-12">
        {children}
      </div>
    </main>
  );
}

export function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [setupSubmitted, setSetupSubmitted] = useState(false);

  const setup = useQuery({ queryKey: ['setup-status'], queryFn: api.setupStatus, retry: false });
  const login = useMutation({
    mutationFn: () => api.login(email.trim(), password, remember),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
      router.replace('/inventory');
    },
  });
  const setupAdmin = useMutation({
    mutationFn: () => api.setupAdmin(setupEmail.trim(), setupPassword),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
      queryClient.setQueryData(['setup-status'], { setup_required: false });
      router.replace('/inventory');
    },
  });

  useEffect(() => {
    // Clear the cached user when visiting login page to ensure fresh auth
    queryClient.removeQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const loginValidation = validateLogin(email, password);
  const emailError = submitted ? loginValidation.email : undefined;
  const passwordError = submitted ? loginValidation.password : undefined;
  const setupValidation = validateSetup(setupEmail, setupPassword, setupConfirmPassword);
  const setupEmailError = setupSubmitted ? setupValidation.email : undefined;
  const setupPasswordError = setupSubmitted ? setupValidation.password : undefined;
  const setupConfirmPasswordError = setupSubmitted ? setupValidation.confirmPassword : undefined;

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const errors = validateLogin(email, password);
    if (errors.email || errors.password) return;
    login.mutate();
  }

  function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupSubmitted(true);
    const errors = validateSetup(setupEmail, setupPassword, setupConfirmPassword);
    if (errors.email || errors.password || errors.confirmPassword) return;
    setupAdmin.mutate();
  }

  if (setup.isLoading) {
    return (
      <AuthShell>
        <div className={authCardClass} role="status">
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Spinner />
            <p className="text-sm text-[var(--color-text-secondary)]">Checking setup status…</p>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (setup.data?.setup_required) {
    return (
      <AuthShell>
        <form className={authCardClass} onSubmit={submitSetup} noValidate>
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-accent)]">InventoryMGR</p>
            <h1 className="font-display mt-2 text-3xl font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">Create admin account</h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Create the first administrator for this deployment.</p>
          </div>
          {setupAdmin.isError ? <Alert>{detailMessage(setupAdmin.error)}</Alert> : null}
          <div className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="setup-email">Email</label>
              <input className={authInputClass} id="setup-email" name="email" type="email" value={setupEmail} onChange={(event) => setSetupEmail(event.target.value)} aria-describedby={setupEmailError ? 'setup-email-error' : undefined} autoComplete="email" />
              <FieldError id="setup-email-error" message={setupEmailError} />
            </div>
            <div>
              <label className={labelClass} htmlFor="setup-password">Password</label>
              <input className={authInputClass} id="setup-password" name="password" type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} aria-describedby={setupPasswordError ? 'setup-password-error' : undefined} autoComplete="new-password" />
              <FieldError id="setup-password-error" message={setupPasswordError} />
            </div>
            <div>
              <label className={labelClass} htmlFor="setup-confirm-password">Confirm password</label>
              <input className={authInputClass} id="setup-confirm-password" name="confirm-password" type="password" value={setupConfirmPassword} onChange={(event) => setSetupConfirmPassword(event.target.value)} aria-describedby={setupConfirmPasswordError ? 'setup-confirm-password-error' : undefined} autoComplete="new-password" />
              <FieldError id="setup-confirm-password-error" message={setupConfirmPasswordError} />
            </div>
          </div>
          <button className={primaryButtonClass + ' mt-6 w-full'} type="submit" disabled={setupAdmin.isPending}>
            {setupAdmin.isPending ? <><Spinner /> Creating account…</> : 'Create admin account'}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className={authCardClass} onSubmit={submitLogin} noValidate>
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-accent)]">InventoryMGR</p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">Sign in</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Use your administrator-provided account.</p>
        </div>
        {setup.isError ? <Alert>{detailMessage(setup.error)}</Alert> : null}
        {login.isError ? <Alert>{detailMessage(login.error)}</Alert> : null}
        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="email">Email</label>
            <input className={authInputClass} id="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby={emailError ? 'email-error' : undefined} autoComplete="email" autoFocus />
            <FieldError id="email-error" message={emailError} />
          </div>
          <div>
            <label className={labelClass} htmlFor="password">Password</label>
            <input className={authInputClass} id="password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={passwordError ? 'password-error' : undefined} autoComplete="current-password" />
            <FieldError id="password-error" message={passwordError} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)] focus:ring-[var(--color-accent)]"
            />
            Keep me signed in on this device
          </label>
        </div>
        <button className={primaryButtonClass + ' mt-6 w-full'} type="submit" disabled={login.isPending}>
          {login.isPending ? <><Spinner /> Signing in…</> : 'Sign in'}
        </button>
        <div className="mt-6 border-t border-[var(--color-border)] pt-6">
          <button
            type="button"
            disabled
            aria-describedby="ldap-hint"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-tertiary)] disabled:cursor-not-allowed"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12M5 4v8M11 4v8" />
            </svg>
            Sign in with LDAP
          </button>
          <p id="ldap-hint" className="mt-2 text-center text-xs text-[var(--color-text-tertiary)]">
            LDAP not configured. Contact your administrator.
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
