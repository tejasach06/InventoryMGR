'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, detailMessage, User } from '../api/client';
import { ThemeSelect } from '../components/ThemeProvider';
import { Alert, FieldError, Logo, Spinner, cardClass, inputClass, labelClass, primaryButtonClass } from '../components/ui';

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
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[var(--color-accent)] via-[var(--color-accent-hover)] to-violet-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '28px 28px' }} aria-hidden="true" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-violet-400/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25" aria-hidden="true">
            <Logo className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">InventoryMGR</span>
        </div>
        <div className="relative">
          <h2 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight">Every virtual machine,<br />accounted for.</h2>
          <p className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-white/85">A single source of truth for your Proxmox and VMware fleet — inventory, lifecycle, ownership, and bulk CSV import in one console.</p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {['Unified Proxmox + VMware inventory', 'Role-based access for every team', 'Preview-then-commit CSV import'].map((f) => (
              <li key={f} className="flex items-center gap-2.5">
                <svg className="h-4 w-4 flex-shrink-0 text-white/75" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 4" /></svg>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">Secure, role-based VM inventory management.</p>
      </aside>
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
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
  const [submitted, setSubmitted] = useState(false);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [setupSubmitted, setSetupSubmitted] = useState(false);

  const setup = useQuery({ queryKey: ['setup-status'], queryFn: api.setupStatus, retry: false });
  const login = useMutation({
    mutationFn: () => api.login(email.trim(), password),
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
    return <div className="p-6" role="status">Checking setup status…</div>;
  }

  if (setup.data?.setup_required) {
    return (
      <AuthShell>
        <form className={`${cardClass} w-full max-w-md animate-rise`} onSubmit={submitSetup} noValidate>
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">InventoryMGR</p>
            <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">Create admin account</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Create the first administrator for this deployment.</p>
          </div>
          {setupAdmin.isError ? <Alert>{detailMessage(setupAdmin.error)}</Alert> : null}
          <div className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="setup-email">Email</label>
              <input className={inputClass} id="setup-email" name="email" type="email" value={setupEmail} onChange={(event) => setSetupEmail(event.target.value)} aria-describedby={setupEmailError ? 'setup-email-error' : undefined} autoComplete="email" />
              <FieldError id="setup-email-error" message={setupEmailError} />
            </div>
            <div>
              <label className={labelClass} htmlFor="setup-password">Password</label>
              <input className={inputClass} id="setup-password" name="password" type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} aria-describedby={setupPasswordError ? 'setup-password-error' : undefined} autoComplete="new-password" />
              <FieldError id="setup-password-error" message={setupPasswordError} />
            </div>
            <div>
              <label className={labelClass} htmlFor="setup-confirm-password">Confirm password</label>
              <input className={inputClass} id="setup-confirm-password" name="confirm-password" type="password" value={setupConfirmPassword} onChange={(event) => setSetupConfirmPassword(event.target.value)} aria-describedby={setupConfirmPasswordError ? 'setup-confirm-password-error' : undefined} autoComplete="new-password" />
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
      <form className={`${cardClass} w-full max-w-md animate-rise`} onSubmit={submitLogin} noValidate>
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">InventoryMGR</p>
          <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">Sign in</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Use your administrator-provided account.</p>
        </div>
        {setup.isError ? <Alert>{detailMessage(setup.error)}</Alert> : null}
        {login.isError ? <Alert>{detailMessage(login.error)}</Alert> : null}
        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="email">Email</label>
            <input className={inputClass} id="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby={emailError ? 'email-error' : undefined} autoComplete="email" />
            <FieldError id="email-error" message={emailError} />
          </div>
          <div>
            <label className={labelClass} htmlFor="password">Password</label>
            <input className={inputClass} id="password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={passwordError ? 'password-error' : undefined} autoComplete="current-password" />
            <FieldError id="password-error" message={passwordError} />
          </div>
        </div>
        <button className={primaryButtonClass + ' mt-6 w-full'} type="submit" disabled={login.isPending}>
          {login.isPending ? <><Spinner /> Signing in…</> : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
