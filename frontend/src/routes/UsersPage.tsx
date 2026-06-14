'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, User, UserRole } from '../api/client';
import { Alert, EmptyState, FieldError, PageHeader, cardClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, selectClass, tableBodyClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass } from '../components/ui';

const roles: UserRole[] = ['viewer', 'editor', 'admin'];

interface NewUserForm {
  email: string;
  password: string;
  role: UserRole;
  is_active: boolean;
}

function defaultNewUser(): NewUserForm {
  return { email: '', password: '', role: 'viewer', is_active: true };
}

function UserRow({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState('');
  const update = useMutation({
    mutationFn: () => {
      const payload: Partial<{ role: UserRole; is_active: boolean; password: string }> = { role, is_active: isActive };
      if (password.length > 0) payload.password = password;
      return api.updateUser(user.id, payload);
    },
    onSuccess: () => {
      setPassword('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <tr className={tableRowClass}>
      <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-100" scope="row">{user.email}</th>
      <td className="whitespace-nowrap px-4 py-3">
        <label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.email}</label>
        <select className={selectClass} id={`role-${user.id}`} value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={`active-${user.id}`}>
          <input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:focus:ring-blue-400" id={`active-${user.id}`} type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active
        </label>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <label className="sr-only" htmlFor={`password-${user.id}`}>New password for {user.email}</label>
        <input className={inputClass} id={`password-${user.id}`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave unchanged" />
      </td>
      <td className="whitespace-nowrap px-4 py-3"><button type="button" className={secondaryButtonClass} onClick={() => update.mutate()} disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save'}</button></td>
      <td className="min-w-60 px-4 py-3">{update.isError ? <span className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{detailMessage(update.error)}</span> : null}</td>
    </tr>
  );
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewUserForm>(() => defaultNewUser());
  const [submitted, setSubmitted] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers });
  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => {
      setForm(defaultNewUser());
      setSubmitted(false);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const emailError = submitted && form.email.trim().length === 0 ? 'Email is required.' : undefined;
  const passwordError = submitted && form.password.length < 8 ? 'Password must be at least 8 characters.' : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (form.email.trim().length === 0 || form.password.length < 8) return;
    create.mutate();
  }

  return (
    <section>
      <PageHeader title="Users" eyebrow="Admin only" />
      <form className={cardClass + ' mb-6 grid gap-4 lg:grid-cols-5 lg:items-end'} onSubmit={submit} noValidate>
        <div>
          <label className={labelClass} htmlFor="new-email">Email</label>
          <input className={inputClass} id="new-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} aria-describedby={emailError ? 'new-email-error' : undefined} />
          <FieldError id="new-email-error" message={emailError} />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-password">Password</label>
          <input className={inputClass} id="new-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} aria-describedby={passwordError ? 'new-password-error' : undefined} />
          <FieldError id="new-password-error" message={passwordError} />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-role">Role</label>
          <select className={selectClass} id="new-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select>
        </div>
        <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300" htmlFor="new-active"><input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:focus:ring-blue-400" id="new-active" type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active</label>
        <button className={primaryButtonClass} type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create user'}</button>
      </form>
      {create.isError ? <Alert>{detailMessage(create.error)}</Alert> : null}
      {users.isError ? <Alert>{detailMessage(users.error)}</Alert> : null}
      {users.isLoading ? <div className="p-6" role="status">Loading users…</div> : null}
      {users.data && users.data.length === 0 ? <EmptyState title="No users" body="Create the first managed user account." /> : null}
      {users.data && users.data.length > 0 ? (
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className="px-4 py-3" scope="col">Email</th>
                <th className="px-4 py-3" scope="col">Role</th>
                <th className="px-4 py-3" scope="col">Active</th>
                <th className="px-4 py-3" scope="col">New password</th>
                <th className="px-4 py-3" scope="col">Action</th>
                <th className="px-4 py-3" scope="col">Message</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>{users.data.map((user) => <UserRow key={user.id} user={user} />)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
