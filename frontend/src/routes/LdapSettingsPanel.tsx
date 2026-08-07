'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, type LdapConfig } from '../api/client';
import {
  Alert,
  inputClass,
  labelClass,
  monoClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
  Spinner,
} from '../components/ui';
import { cn } from '../lib/classNames';

type FormValues = Omit<LdapConfig, 'bind_password_set'>;

const emptyForm: FormValues = {
  enabled: false,
  server_uri: '',
  start_tls: false,
  verify_tls: true,
  bind_dn: null,
  user_base_dn: '',
  user_filter: '(uid={username})',
  email_attribute: 'mail',
  group_attribute: 'memberOf',
  admin_group_dn: null,
  editor_group_dn: null,
  viewer_group_dn: null,
  default_role: 'viewer',
};

export function LdapPanel() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['settings', 'ldap'], queryFn: api.getLdapConfig });
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [bindPassword, setBindPassword] = useState('');
  const [testUsername, setTestUsername] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const passwordTouched = useRef(false);

  useEffect(() => {
    if (configQuery.data) {
      const { bind_password_set: _ignored, ...config } = configQuery.data;
      setForm(config);
      if (!passwordTouched.current) setBindPassword('');
    }
  }, [configQuery.data]);

  const save = useMutation({
    mutationFn: () => api.updateLdapConfig({
      ...form,
      ...(passwordTouched.current ? { bind_password: bindPassword } : {}),
    }),
    onSuccess: () => {
      passwordTouched.current = false;
      setBindPassword('');
      queryClient.invalidateQueries({ queryKey: ['settings', 'ldap'] });
    },
  });
  const test = useMutation({
    mutationFn: () => api.testLdapConnection({
      ...(testUsername ? { username: testUsername } : {}),
      ...(testPassword ? { password: testPassword } : {}),
    }),
  });
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const input = (key: keyof FormValues, label: string, technical = false, help?: string) => (
    <div>
      <label className={labelClass} htmlFor={`ldap-${key}`}>{label}</label>
      <input
        id={`ldap-${key}`}
        className={cn(inputClass, technical && monoClass)}
        value={(form[key] as string | null) ?? ''}
        onChange={(event) => set(key, (event.target.value || null) as FormValues[typeof key])}
      />
      {help ? <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">{help}</p> : null}
    </div>
  );
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };

  return (
    <div role="tabpanel" id="panel-ldap" aria-labelledby="tab-ldap" className="animate-fade-in">
      <form className="grid gap-5" onSubmit={submit}>
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]" htmlFor="ldap-enabled">
          <input id="ldap-enabled" type="checkbox" checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
          Enable LDAP authentication
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          {input('server_uri', 'Server URI', true)}
          {input('bind_dn', 'Bind DN', true)}
          {input('user_base_dn', 'User base DN', true)}
          {input('user_filter', 'User search filter', true, '{username} and {email} are substituted.')}
          {input('email_attribute', 'Email attribute')}
          {input('group_attribute', 'Group attribute')}
          {input('admin_group_dn', 'Admin group DN', true)}
          {input('editor_group_dn', 'Editor group DN', true)}
          {input('viewer_group_dn', 'Viewer group DN', true)}
          <div>
            <label className={labelClass} htmlFor="ldap-default_role">Default role</label>
            <select id="ldap-default_role" className={selectClass} value={form.default_role} onChange={(event) => set('default_role', event.target.value as FormValues['default_role'])}>
              <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ldap-bind-password">Bind password</label>
            <input
              id="ldap-bind-password"
              type="password"
              className={inputClass}
              placeholder={configQuery.data?.bind_password_set ? '•••••••• (unchanged)' : ''}
              value={bindPassword}
              onChange={(event) => { passwordTouched.current = true; setBindPassword(event.target.value); }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-5 border-y border-[var(--color-border-subtle)] py-4">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><input type="checkbox" checked={form.start_tls} onChange={(event) => set('start_tls', event.target.checked)} /> Use StartTLS</label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><input type="checkbox" checked={form.verify_tls} onChange={(event) => set('verify_tls', event.target.checked)} /> Verify TLS certificate</label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className={primaryButtonClass} disabled={save.isPending}>{save.isPending ? <><Spinner /> Saving…</> : 'Save LDAP settings'}</button>
          {save.isError ? <Alert>{detailMessage(save.error)}</Alert> : null}
        </div>
      </form>

      <section className="mt-8 border-t border-[var(--color-border-subtle)] pt-6">
        <h2 className="font-semibold text-[var(--color-text-primary)]">Test connection</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div><label className={labelClass} htmlFor="ldap-test-username">Test username</label><input id="ldap-test-username" className={inputClass} value={testUsername} onChange={(event) => setTestUsername(event.target.value)} /></div>
          <div><label className={labelClass} htmlFor="ldap-test-password">Test password</label><input id="ldap-test-password" type="password" className={inputClass} value={testPassword} onChange={(event) => setTestPassword(event.target.value)} /></div>
        </div>
        <div className="mt-4 flex items-center gap-3"><button type="button" className={secondaryButtonClass} disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? <><Spinner /> Testing…</> : 'Test connection'}</button>{test.isError ? <Alert>{detailMessage(test.error)}</Alert> : null}</div>
        {test.data ? <div className="mt-4"><Alert tone={test.data.ok ? 'success' : 'error'}>{test.data.message}</Alert></div> : null}
      </section>
    </div>
  );
}
