import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, detailMessage } from '../api/client';
import { Alert, FieldError } from '../components/ui';

export function LoginPage() {
  const navigate = useNavigate();
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
      navigate('/inventory', { replace: true });
    },
  });
  const setupAdmin = useMutation({
    mutationFn: () => api.setupAdmin(setupEmail.trim(), setupPassword),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
      queryClient.setQueryData(['setup-status'], { setup_required: false });
      navigate('/inventory', { replace: true });
    },
  });

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

  if (queryClient.getQueryData(['me'])) {
    return <Navigate to="/inventory" replace />;
  }

  if (setup.isLoading) {
    return <div className="loading" role="status">Checking setup status…</div>;
  }

  if (setup.data?.setup_required) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={submitSetup} noValidate>
          <div>
            <p className="eyebrow">InventoryMGR</p>
            <h1>Create admin account</h1>
            <p className="muted">Create the first administrator for this deployment.</p>
          </div>
          {setupAdmin.isError ? <Alert>{detailMessage(setupAdmin.error)}</Alert> : null}
          <div className="field">
            <label htmlFor="setup-email">Email</label>
            <input id="setup-email" name="email" type="email" value={setupEmail} onChange={(event) => setSetupEmail(event.target.value)} aria-describedby={setupEmailError ? 'setup-email-error' : undefined} autoComplete="email" />
            <FieldError id="setup-email-error" message={setupEmailError} />
          </div>
          <div className="field">
            <label htmlFor="setup-password">Password</label>
            <input id="setup-password" name="password" type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} aria-describedby={setupPasswordError ? 'setup-password-error' : undefined} autoComplete="new-password" />
            <FieldError id="setup-password-error" message={setupPasswordError} />
          </div>
          <div className="field">
            <label htmlFor="setup-confirm-password">Confirm password</label>
            <input id="setup-confirm-password" name="confirm-password" type="password" value={setupConfirmPassword} onChange={(event) => setSetupConfirmPassword(event.target.value)} aria-describedby={setupConfirmPasswordError ? 'setup-confirm-password-error' : undefined} autoComplete="new-password" />
            <FieldError id="setup-confirm-password-error" message={setupConfirmPasswordError} />
          </div>
          <button type="submit" disabled={setupAdmin.isPending}>{setupAdmin.isPending ? 'Creating account…' : 'Create admin account'}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submitLogin} noValidate>
        <div>
          <p className="eyebrow">InventoryMGR</p>
          <h1>Sign in</h1>
          <p className="muted">Use your administrator-provided account.</p>
        </div>
        {setup.isError ? <Alert>{detailMessage(setup.error)}</Alert> : null}
        {login.isError ? <Alert>{detailMessage(login.error)}</Alert> : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby={emailError ? 'email-error' : undefined} autoComplete="email" />
          <FieldError id="email-error" message={emailError} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={passwordError ? 'password-error' : undefined} autoComplete="current-password" />
          <FieldError id="password-error" message={passwordError} />
        </div>
        <button type="submit" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
