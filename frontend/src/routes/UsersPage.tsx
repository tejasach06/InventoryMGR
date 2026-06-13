import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, User, UserRole } from '../api/client';
import { Alert, EmptyState, FieldError, PageHeader } from '../components/ui';

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
    <tr>
      <th scope="row">{user.email}</th>
      <td>
        <label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.email}</label>
        <select id={`role-${user.id}`} value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </td>
      <td>
        <label className="checkbox-inline" htmlFor={`active-${user.id}`}>
          <input id={`active-${user.id}`} type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active
        </label>
      </td>
      <td>
        <label className="sr-only" htmlFor={`password-${user.id}`}>New password for {user.email}</label>
        <input id={`password-${user.id}`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave unchanged" />
      </td>
      <td><button type="button" className="secondary" onClick={() => update.mutate()} disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save'}</button></td>
      <td>{update.isError ? <span className="field-error" role="alert">{detailMessage(update.error)}</span> : null}</td>
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
      <form className="card user-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="new-email">Email</label>
          <input id="new-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} aria-describedby={emailError ? 'new-email-error' : undefined} />
          <FieldError id="new-email-error" message={emailError} />
        </div>
        <div className="field">
          <label htmlFor="new-password">Password</label>
          <input id="new-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} aria-describedby={passwordError ? 'new-password-error' : undefined} />
          <FieldError id="new-password-error" message={passwordError} />
        </div>
        <div className="field">
          <label htmlFor="new-role">Role</label>
          <select id="new-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select>
        </div>
        <label className="checkbox-inline" htmlFor="new-active"><input id="new-active" type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active</label>
        <button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create user'}</button>
      </form>
      {create.isError ? <Alert>{detailMessage(create.error)}</Alert> : null}
      {users.isError ? <Alert>{detailMessage(users.error)}</Alert> : null}
      {users.isLoading ? <div className="loading" role="status">Loading users…</div> : null}
      {users.data && users.data.length === 0 ? <EmptyState title="No users" body="Create the first managed user account." /> : null}
      {users.data && users.data.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Active</th>
                <th scope="col">New password</th>
                <th scope="col">Action</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>{users.data.map((user) => <UserRow key={user.id} user={user} />)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
