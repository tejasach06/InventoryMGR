'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, User, UserRole } from '../api/client';
import { Alert, Badge, EmptyState, FieldError, PageHeader, PageTransition, Spinner, TableSkeleton, cardClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, selectClass, tableBodyClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass } from '../components/ui';

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

function buildUpdateUserMutation(
  userId: string,
  role: UserRole,
  isActive: boolean,
  password: string,
  setPassword: (value: string) => void,
  queryClient: ReturnType<typeof useQueryClient>,
  onSuccess?: () => void,
) {
  return {
    mutationFn: () => {
      const payload: Partial<{ role: UserRole; is_active: boolean; password: string }> = { role, is_active: isActive };
      if (password.length > 0) payload.password = password;
      return api.updateUser(userId, payload);
    },
    onSuccess: () => {
      setPassword('');
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  };
}

function UserCard({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState('');
  const update = useMutation(
    buildUpdateUserMutation(user.id, role, isActive, password, setPassword, queryClient, () => setEditing(false)),
  );

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold text-slate-950 dark:text-slate-100">{user.email}</span>
          <div className="mt-1 flex items-center gap-2">
            <Badge value={user.role} />
            <span className={`inline-flex h-2 w-2 rounded-full ${user.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} title={user.is_active ? 'Active' : 'Inactive'} />
          </div>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>
      </div>
      {editing ? (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div>
            <label className={labelClass} htmlFor={`card-role-${user.id}`}>Role</label>
            <select className={selectClass} id={`card-role-${user.id}`} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={`card-active-${user.id}`}>
            <input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:focus:ring-blue-400" id={`card-active-${user.id}`} type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
          </label>
          <div>
            <label className={labelClass} htmlFor={`card-pw-${user.id}`}>New password</label>
            <input className={inputClass} id={`card-pw-${user.id}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave unchanged" />
          </div>
          <button type="button" className={primaryButtonClass} onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? <><Spinner /> Saving…</> : 'Save'}
          </button>
          {update.isError ? <Alert>{detailMessage(update.error)}</Alert> : null}
        </div>
      ) : null}
    </div>
  );
}

function UserRow({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState('');
  const update = useMutation(buildUpdateUserMutation(user.id, role, isActive, password, setPassword, queryClient));

  return (
    <>
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
        <td className="whitespace-nowrap px-4 py-3">
          <button type="button" className={secondaryButtonClass} onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? <><Spinner /> Saving…</> : 'Save'}
          </button>
        </td>
      </tr>
      {update.isError ? (
        <tr><td colSpan={5} className="px-4 py-2"><Alert>{detailMessage(update.error)}</Alert></td></tr>
      ) : null}
    </>
  );
}

export function UsersPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewUserForm>(() => defaultNewUser());
  const [submitted, setSubmitted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers });
  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => {
      setForm(defaultNewUser());
      setSubmitted(false);
      setShowCreate(false);
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
    <>
      <div className="mb-6 flex items-center justify-end">
        <button type="button" className={showCreate ? secondaryButtonClass : primaryButtonClass} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : 'New user'}
        </button>
      </div>
      {showCreate ? (
        <form className={cardClass + ' mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end animate-fade-in'} onSubmit={submit} noValidate>
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
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300" htmlFor="new-active"><input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:focus:ring-blue-400" id="new-active" type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active</label>
          <button className={primaryButtonClass} type="submit" disabled={create.isPending}>
            {create.isPending ? <><Spinner /> Creating…</> : 'Create user'}
          </button>
        </form>
      ) : null}
      {create.isError ? <Alert>{detailMessage(create.error)}</Alert> : null}
      {users.isError ? <Alert>{detailMessage(users.error)}</Alert> : null}
      {users.isLoading ? <TableSkeleton rows={4} cols={5} /> : null}
      {users.data && users.data.length === 0 ? <EmptyState title="No users" body="Create the first managed user account." /> : null}
      {users.data && users.data.length > 0 ? (
        <>
          <div className="hidden lg:block">
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead className={tableHeadClass}>
                  <tr>
                    <th className="px-4 py-3" scope="col">Email</th>
                    <th className="px-4 py-3" scope="col">Role</th>
                    <th className="px-4 py-3" scope="col">Active</th>
                    <th className="px-4 py-3" scope="col">New password</th>
                    <th className="px-4 py-3" scope="col">Action</th>
                  </tr>
                </thead>
                <tbody className={tableBodyClass}>{users.data.map((user) => <UserRow key={user.id} user={user} />)}</tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-3 lg:hidden">
            {users.data.map((user) => <UserCard key={user.id} user={user} />)}
          </div>
        </>
      ) : null}
    </>
  );
}

export function UsersPage() {
  return (
    <PageTransition>
      <section>
        <PageHeader title="Users" eyebrow="Admin only" />
        <UsersPanel />
      </section>
    </PageTransition>
  );
}
