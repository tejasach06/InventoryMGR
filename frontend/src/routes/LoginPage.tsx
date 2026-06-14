'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, detailMessage, User } from '../api/client';
import { ThemeSelect } from '../components/ThemeProvider';
import { Alert, FieldError, inputClass, labelClass, primaryButtonClass } from '../components/ui';

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

  const cachedUser = queryClient.getQueryData<User>(['me']);
  useEffect(() => {
    if (cachedUser) router.replace('/inventory');
  }, [cachedUser, router]);

  const emailError = submitted && email.trim().length === 0 ? 'Email is required.' : undefined;
  const passwordError = submitted && password.length === 0 ? 'Password is required.' : undefined;
  const setupEmailError = setupSubmitted && setupEmail.trim().length === 0 ? 'Email is required.' : undefined;
  const setupPasswordError = setupSubmitted && setupPassword.length < 8 ? 'Password must be at least 8 characters.' : undefined;
  const setupConfirmPasswordError = setupSubmitted && setupConfirmPassword !== setupPassword ? 'Passwords do not match.' : undefined;

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (email.trim().length === 0 || password.length === 0) return;
    login.mutate();
  }

  function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupSubmitted(true);
    if (setupEmail.trim().length === 0 || setupPassword.length < 8 || setupConfirmPassword !== setupPassword) return;
    setupAdmin.mutate();
  }

  if (cachedUser) {
    return <div className="p-6" role="status">Redirecting…</div>;
  }

  if (setup.isLoading) {
    return <div className="p-6" role="status">Checking setup status…</div>;
  }

  if (setup.data?.setup_required) {
    return (
      <main className="relative flex min-h-screen items-center justify-center bg-slate-50 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_30rem),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.14),transparent_28rem)] px-4 py-12 dark:bg-slate-950 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_30rem),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.18),transparent_28rem)]">
        <div className="absolute right-4 top-4"><ThemeSelect /></div>
        <form className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/90 p-8 shadow-xl shadow-slate-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/60" onSubmit={submitSetup} noValidate>
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">InventoryMGR</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">Create admin account</h1>
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
          <button className={primaryButtonClass + ' mt-6 w-full'} type="submit" disabled={setupAdmin.isPending}>{setupAdmin.isPending ? 'Creating account…' : 'Create admin account'}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-50 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_30rem),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.14),transparent_28rem)] px-4 py-12 dark:bg-slate-950 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_30rem),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.18),transparent_28rem)]">
      <div className="absolute right-4 top-4"><ThemeSelect /></div>
      <form className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/90 p-8 shadow-xl shadow-slate-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/60" onSubmit={submitLogin} noValidate>
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">InventoryMGR</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">Sign in</h1>
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
        <button className={primaryButtonClass + ' mt-6 w-full'} type="submit" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
