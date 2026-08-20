'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth as authApi } from '../api/auth';
import { detailMessage } from '../api/core';
import type { User, UserRole } from '../api/types';
import { Alert, Badge, ConfirmDialog, EmptyState, FieldError, PageHeader, PageTransition, Spinner, TableSkeleton, cardClass, helpTextClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, dangerButtonClass, selectClass, tableBodyClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass, monoClass } from '../components/ui';
import { useCurrentUser } from '../components/AuthContext';
import { cn } from '../lib/classNames';

const roles: UserRole[] = ['viewer', 'editor', 'admin'];
const roleDescriptions: Record<UserRole, string> = {
  viewer: 'Read-only access to all inventory.',
  editor: 'Can create and edit VM, cluster, and storage records.',
  admin: 'Editor access plus user management and settings.',
};

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
      return authApi.updateUser(userId, payload);
    },
    onSuccess: () => {
      setPassword('');
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  };
}

function buildDeleteUserMutation(userId: string, queryClient: ReturnType<typeof useQueryClient>) {
  return {
    mutationFn: () => authApi.deleteUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  };
}

function UserCard({ user, isSelf }: { user: User; isSelf: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [success, setSuccess] = useState<string>();
  const update = useMutation(
    buildUpdateUserMutation(user.id, role, isActive, password, setPassword, queryClient, () => { setEditing(false); setSuccess(`Updated access for ${user.email}.`); }),
  );
  const remove = useMutation(buildDeleteUserMutation(user.id, queryClient));

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <div>
          <span className={cn('font-semibold text-[var(--color-text-primary)]', monoClass)}>{user.email}</span>
          <div className="mt-1 flex items-center gap-2">
            <Badge value={user.role} tone={{ type: 'neutral' }} />
            <Badge value={user.is_active ? 'Active' : 'Inactive'} tone={{ type: 'status', value: user.is_active ? 'running' : 'powered_off' }} />
          </div>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>
      </div>
      {editing ? (
        <div className="mt-4 grid gap-3 border-t border-[var(--color-border-subtle)] pt-4">
          <div>
            <label className={labelClass} htmlFor={`card-role-${user.id}`}>Role</label>
            <select className={selectClass} id={`card-role-${user.id}`} value={role} disabled={isSelf}
              title={isSelf ? "You can't change your own role." : undefined}
              onChange={(e) => setRole(e.target.value as UserRole)}>{roles.map((r) => <option key={r} value={r} title={roleDescriptions[r]}>{r}</option>)}</select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]" htmlFor={`card-active-${user.id}`}>
            <input className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/12" id={`card-active-${user.id}`} type="checkbox" checked={isActive} disabled={isSelf}
              title={isSelf ? "You can't deactivate your own account." : undefined}
              onChange={(e) => setIsActive(e.target.checked)} /> Active
          </label>
          {isSelf && <p className="text-xs text-[var(--color-text-tertiary)]">You can't change your own role or active status.</p>}
          <div>
            <label className={labelClass} htmlFor={`card-pw-${user.id}`}>New password</label>
            <input className={inputClass} id={`card-pw-${user.id}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave unchanged" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primaryButtonClass} onClick={() => (role !== user.role || isActive !== user.is_active) ? setReviewing(true) : update.mutate()} disabled={update.isPending}>
              {update.isPending ? <><Spinner /> Saving…</> : role !== user.role || isActive !== user.is_active ? 'Review access change' : 'Save'}
            </button>
            <button type="button" className={dangerButtonClass} onClick={() => setConfirmingDelete(true)}
              disabled={isSelf || remove.isPending}
              title={isSelf ? "You can't delete your own account." : undefined}>
              {remove.isPending ? <><Spinner /> Deleting…</> : 'Delete'}
            </button>
          </div>
          <ConfirmDialog
            open={reviewing}
            title="Review access change"
            body={`${user.email}: role: ${user.role} → ${role}; status: ${user.is_active ? 'active' : 'inactive'} → ${isActive ? 'active' : 'inactive'}`}
            confirmLabel="Save"
            tone={!isActive || roles.indexOf(role) < roles.indexOf(user.role) ? 'danger' : 'primary'}
            pending={update.isPending}
            onConfirm={() => { setReviewing(false); update.mutate(); }}
            onCancel={() => setReviewing(false)}
          />
          <ConfirmDialog
            open={confirmingDelete}
            title="Delete user"
            body={`Permanently delete ${user.email}? This cannot be undone.`}
            confirmLabel="Delete"
            tone="danger"
            pending={remove.isPending}
            onConfirm={() => { setConfirmingDelete(false); remove.mutate(); }}
            onCancel={() => setConfirmingDelete(false)}
          />
          {success ? <Alert tone="success">{success}</Alert> : null}
          {update.isError ? <Alert>{detailMessage(update.error)}</Alert> : null}
          {remove.isError ? <Alert>{detailMessage(remove.error)}</Alert> : null}
        </div>
      ) : null}
    </div>
  );
}

function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [password, setPassword] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [success, setSuccess] = useState<string>();
  const update = useMutation(buildUpdateUserMutation(user.id, role, isActive, password, setPassword, queryClient, () => setSuccess(`Updated access for ${user.email}.`)));
  const remove = useMutation(buildDeleteUserMutation(user.id, queryClient));

  return (
    <>
      <tr className={tableRowClass}>
        <th className={cn('whitespace-nowrap px-4 py-3 text-left font-semibold text-[var(--color-text-primary)]', monoClass)} scope="row">{user.email}</th>
        <td className="whitespace-nowrap px-4 py-3">
          <label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.email}</label>
          <select className={selectClass} id={`role-${user.id}`} value={role} disabled={isSelf}
            title={isSelf ? "You can't change your own role." : undefined}
            onChange={(event) => setRole(event.target.value as UserRole)}>{roles.map((item) => <option key={item} value={item} title={roleDescriptions[item]}>{item}</option>)}</select>
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]" htmlFor={`active-${user.id}`}>
            <input className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/12" id={`active-${user.id}`} type="checkbox" checked={isActive} disabled={isSelf}
              title={isSelf ? "You can't deactivate your own account." : undefined}
              onChange={(event) => setIsActive(event.target.checked)} /> Active
          </label>
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <label className="sr-only" htmlFor={`password-${user.id}`}>New password for {user.email}</label>
          <input className={inputClass} id={`password-${user.id}`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave unchanged" />
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <div className="flex items-center gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => (role !== user.role || isActive !== user.is_active) ? setReviewing(true) : update.mutate()} disabled={update.isPending}>
              {update.isPending ? <><Spinner /> Saving…</> : role !== user.role || isActive !== user.is_active ? 'Review access change' : 'Save'}
            </button>
            <button type="button" className={dangerButtonClass} onClick={() => setConfirmingDelete(true)}
              disabled={isSelf || remove.isPending}
              title={isSelf ? "You can't delete your own account." : undefined}>
              {remove.isPending ? <><Spinner /> Deleting…</> : 'Delete'}
            </button>
          </div>
        </td>
      </tr>
      <ConfirmDialog
        open={reviewing}
        title="Review access change"
        body={`${user.email}: role: ${user.role} → ${role}; status: ${user.is_active ? 'active' : 'inactive'} → ${isActive ? 'active' : 'inactive'}`}
        confirmLabel="Save"
        tone={!isActive || roles.indexOf(role) < roles.indexOf(user.role) ? 'danger' : 'primary'}
        pending={update.isPending}
        onConfirm={() => { setReviewing(false); update.mutate(); }}
        onCancel={() => setReviewing(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete user"
        body={`Permanently delete ${user.email}? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => { setConfirmingDelete(false); remove.mutate(); }}
        onCancel={() => setConfirmingDelete(false)}
      />
      {success ? <tr><td colSpan={5} className="px-4 py-2"><Alert tone="success">{success}</Alert></td></tr> : null}
      {update.isError ? (
        <tr><td colSpan={5} className="px-4 py-2"><Alert>{detailMessage(update.error)}</Alert></td></tr>
      ) : null}
      {remove.isError ? <tr><td colSpan={5} className="px-4 py-2"><Alert>{detailMessage(remove.error)}</Alert></td></tr> : null}
    </>
  );
}

export function UsersPanel() {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewUserForm>(() => defaultNewUser());
  const [submitted, setSubmitted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: authApi.listUsers });
  const create = useMutation({
    mutationFn: () => authApi.createUser(form),
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
        <form className={cardClass + ' mb-6 space-y-4 animate-fade-in'} onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <select className={selectClass} id="new-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>{roles.map((role) => <option key={role} value={role} title={roleDescriptions[role]}>{role}</option>)}</select>
              <p className={helpTextClass}>{roleDescriptions[form.role]}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-4">
            <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)]" htmlFor="new-active"><input className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/12" id="new-active" type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active</label>
            <button className={primaryButtonClass} type="submit" disabled={create.isPending}>
              {create.isPending ? <><Spinner /> Creating…</> : 'Create user'}
            </button>
          </div>
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
                <tbody className={tableBodyClass}>{users.data.map((user) => <UserRow key={user.id} user={user} isSelf={user.id === currentUser.id} />)}</tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-3 lg:hidden">
            {users.data.map((user) => <UserCard key={user.id} user={user} isSelf={user.id === currentUser.id} />)}
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
        <PageHeader title="Users" context="Administration" description="Manage local accounts, roles, and access state." />
        <UsersPanel />
      </section>
    </PageTransition>
  );
}
