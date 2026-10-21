import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { AccessPicker } from '../components/AccessPicker';
import { useListView } from '../hooks/useListView';
import { useImportExport } from '../hooks/useImportExport';
import { ListToolbar } from '../components/ListToolbar';
import { ExportPicker } from '../components/ExportPicker';
import { ActivityHistoryModal } from '../components/ActivityLogView';
import type { FieldDef } from '../modules/resources';
import type { RbacModule } from '../auth/types';

// Field defs for the users list's shared control panel (search + custom filter).
const userFields: FieldDef[] = [
  { name: 'name', label: 'Name' },
  { name: 'email', label: 'Email', type: 'email' },
];

// Shape returned by GET /users (full records with relation objects), distinct from the
// JWT-derived AuthUser whose `modules` is a string[].
type UserRow = { id: number; name: string; email: string; modules?: { key: string }[]; groups?: { key: string }[]; mfaRequired?: boolean; mfaEnabled?: boolean; mfaRequiredBy?: string | null };

/** Small MFA status badge for the Users list — mirrors the enforcement logic in Shell.tsx. */
function MfaBadge({ u }: { u: UserRow }) {
  if (u.mfaEnabled) return <span className="badge badge-green">ON</span>;
  if (!u.mfaRequired) return <span className="muted" style={{ fontSize: 12.5 }}>—</span>;
  const daysLeft = u.mfaRequiredBy ? Math.ceil((new Date(u.mfaRequiredBy).getTime() - Date.now()) / 86400000) : null;
  if (daysLeft !== null && daysLeft <= 0) return <span className="badge badge-red">overdue</span>;
  return <span className="badge badge-amber">{daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>;
}
// Result of a "send password setup" request — emailed, or a copyable link when no SMTP is configured.
type SetupResult = { userId: number; email: string | null; name: string | null; url: string | null; emailSent: boolean; error?: string };

function apiErr(e: unknown) {
  const ax = e as { response?: { data?: { message?: string | string[] } } };
  const m = ax.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

export default function Users() {
  const { ability } = useAuth();
  const qc = useQueryClient();
  const canRead = ability.can('read', 'core.users');
  const canCreate = ability.can('create', 'core.users');
  const canUpdate = ability.can('update', 'core.users');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [moduleKeys, setModuleKeys] = useState<string[]>([]);
  const [groupKeys, setGroupKeys] = useState<string[]>([]);
  // Defaults checked on create — the goal is this becomes the norm for new users; an admin can
  // still uncheck it for an exception (e.g. a shared/service-style account).
  const [mfaRequired, setMfaRequired] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [historyUser, setHistoryUser] = useState<UserRow | null>(null);
  const [invite, setInvite] = useState<{ acceptUrl: string; emailSent: boolean } | null>(null);

  const { data: structure = [] } = useQuery({
    queryKey: ['rbac-structure'],
    queryFn: async () => (await api.get('/rbac/structure')).data as RbacModule[],
    enabled: canRead,
  });
  const { data: users = [] } = useQuery({
    queryKey: ['/users'],
    queryFn: async () => (await api.get('/users')).data as UserRow[],
    enabled: canRead,
  });

  // Same shared list control panel as the other screens — search + custom filter over the users list.
  const view = useListView({ rows: users as unknown as Record<string, unknown>[], columns: ['name', 'email'], fields: userFields });
  const visibleUsers = view.rows as unknown as UserRow[];

  // Onboarding: select users → email each a "set your password" link (or copy it when no SMTP).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [setupResults, setSetupResults] = useState<SetupResult[] | null>(null);
  const toggleUser = (id: number) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visibleIds = visibleUsers.map((u) => u.id);
  const allSel = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(visibleIds));

  const sendSetup = useMutation({
    mutationFn: (userIds: number[]) => api.post('/invites/password-setup', { userIds }),
    onSuccess: (r) => { setSetupResults(r.data.results as SetupResult[]); setSelected(new Set()); setMsg(''); setErr(''); },
    onError: (e) => setErr(apiErr(e)),
  });

  const reset = () => { setEditingId(null); setName(''); setEmail(''); setPassword(''); setModuleKeys([]); setGroupKeys([]); setMfaRequired(true); };

  // Create a new user, or update the one being edited.
  const upsert = useMutation({
    mutationFn: () => {
      const body = { name, email, password: password || undefined, moduleKeys, groupKeys, mfaRequired };
      return editingId ? api.patch(`/users/${editingId}`, body) : api.post('/users', body);
    },
    onSuccess: (r) => {
      const gp = r.data?.generatedPassword;
      setMsg(editingId ? 'User updated.' : (gp ? `User created. Generated password: ${gp}` : 'User created.'));
      setErr(''); setInvite(null); reset();
      qc.invalidateQueries({ queryKey: ['/users'] });
    },
    onError: (e) => { setErr(apiErr(e)); setMsg(''); },
  });

  const sendInvite = useMutation({
    mutationFn: () => api.post('/invites', { email, moduleKeys, groupKeys }),
    onSuccess: (r) => { setInvite({ acceptUrl: r.data.acceptUrl, emailSent: r.data.emailSent }); setMsg(''); setErr(''); },
    onError: (e) => { setErr(apiErr(e)); setInvite(null); },
  });

  // Excel export/import via the shared hook (same generic /data engine as the other screens). Export
  // omits the password (it is select:false); import matches by email and UPDATES existing users — new
  // users are skipped (a password is required and isn't in the sheet).
  const { fileRef, importXlsx } = useImportExport({
    resource: 'core.users',
    invalidate: [['/users']],
    onSuccess: (m) => { setMsg(m); setErr(''); },
    onError: setErr,
  });
  const [exporting, setExporting] = useState(false);

  if (!canRead) return <div className="card"><div className="card-body">You do not have access to user management.</div></div>;

  const onInvite = () => {
    if (!email) { setErr('Enter an email address to send an invite.'); return; }
    setMsg(''); setInvite(null);
    sendInvite.mutate();
  };

  const startEdit = (u: UserRow) => {
    setEditingId(u.id);
    setName(u.name ?? '');
    setEmail(u.email ?? '');
    setPassword('');
    setModuleKeys((u.modules ?? []).map((m) => m.key));
    setGroupKeys((u.groups ?? []).map((g) => g.key));
    setMfaRequired(!!u.mfaRequired);
    setMsg(''); setErr(''); setInvite(null);
  };

  // Admin remediation: "lost my authenticator device" — clears MFA for the selected user(s) and
  // (if they're under the required-by-policy) gives them a fresh 15-day window instead of leaving
  // them immediately re-blocked the moment they next log in.
  const resetMfa = useMutation({
    mutationFn: (userIds: number[]) => api.post('/users/mfa-reset', { userIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/users'] }); setSelected(new Set()); setMsg('MFA reset for the selected user(s).'); setErr(''); },
    onError: (e) => setErr(apiErr(e)),
  });
  // Bulk-lift the requirement (per-user toggle already lives on the Edit form — this is the "for
  // several people at once" version, reusing the same PATCH endpoint per user).
  const removeMfaRequirement = useMutation({
    mutationFn: async (userIds: number[]) => {
      for (const id of userIds) await api.patch(`/users/${id}`, { mfaRequired: false });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/users'] }); setSelected(new Set()); setMsg('MFA requirement removed for the selected user(s).'); setErr(''); },
    onError: (e) => setErr(apiErr(e)),
  });

  return (
    <div>
      <div className="page-head">
        <h1>Users</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setExporting(true)}>Export</button>
          {canCreate && <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import</button>}
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={importXlsx} />
        </div>
      </div>

      {exporting && (
        <ExportPicker resource="core.users" title="Users" defaultFields={['name', 'email', 'status']} onClose={() => setExporting(false)} />
      )}

      <div className="grid-2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(320px, 400px) minmax(0, 1fr)' }}>
        <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); upsert.mutate(); }}>
          <div className="card-body">
            <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit user' : 'Create or invite a user'}</h3>
            <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="field"><label>Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div className="field">
              <label>Password <span className="muted">{editingId ? '(blank = keep current)' : '(Create only — blank = auto-generate)'}</span></label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            <AccessPicker structure={structure} moduleKeys={moduleKeys} groupKeys={groupKeys} onModules={setModuleKeys} onGroups={setGroupKeys} />

            <div className="field" style={{ marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'normal' }}>
                <input type="checkbox" checked={mfaRequired} onChange={(e) => setMfaRequired(e.target.checked)} />
                Require two-factor authentication (must be enabled within 15 days)
              </label>
            </div>

            {msg && <div className="success-text">{msg}</div>}
            {invite && (
              <div className="success-text" style={{ whiteSpace: 'pre-line' }}>
                Invite created{invite.emailSent ? ' and emailed.' : ' (no SMTP configured — share this link):'}
                {!invite.emailSent && <><br /><a href={invite.acceptUrl} style={{ color: 'var(--primary-2)' }}>{invite.acceptUrl}</a></>}
              </div>
            )}
            {err && <div className="error-text">{err}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" type="submit" disabled={upsert.isPending}>
                {upsert.isPending ? 'Saving…' : editingId ? 'Update user' : 'Create user'}
              </button>
              {!editingId && <button className="btn btn-ghost" type="button" onClick={onInvite} disabled={sendInvite.isPending}>{sendInvite.isPending ? 'Sending…' : 'Send invite'}</button>}
              {editingId && <button className="btn btn-ghost" type="button" onClick={() => { reset(); setMsg(''); setErr(''); }}>Cancel</button>}
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 10 }}>
              <b>Create</b> sets their password now · <b>Invite</b> emails a link so they set their own · <b>Edit</b> a user (right) to change their modules/permissions — both grant the modules/permissions above.
            </p>
          </div>
        </form>

        <div className="card">
          <div className="card-body" style={{ paddingBottom: 4 }}><h3 style={{ margin: 0 }}>Users ({users.length})</h3></div>
          <div style={{ padding: '0 16px' }}>
            <ListToolbar view={view} placeholder="Search users… (name, email)" />
          </div>
          {canUpdate && selected.size > 0 && (
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', flexWrap: 'wrap' }}>
              <strong>{selected.size} selected</strong>
              <button className="btn btn-primary btn-sm" disabled={sendSetup.isPending} onClick={() => sendSetup.mutate([...selected])}>
                {sendSetup.isPending ? 'Sending…' : 'Send password setup'}
              </button>
              <button className="btn btn-ghost btn-sm" title="Clears MFA so a locked-out user (e.g. lost their phone) can log in and re-enroll" disabled={resetMfa.isPending} onClick={() => { if (confirm('Reset MFA for the selected user(s)? They will need to re-enroll.')) resetMfa.mutate([...selected]); }}>
                {resetMfa.isPending ? 'Resetting…' : 'Reset MFA'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={removeMfaRequirement.isPending} onClick={() => { if (confirm('Remove the MFA requirement for the selected user(s)?')) removeMfaRequirement.mutate([...selected]); }}>
                {removeMfaRequirement.isPending ? 'Updating…' : 'Remove MFA requirement'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
          {/* the list card clips overflow, so wrap the table: narrow screens scroll instead of hiding the action buttons */}
          <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr>
              {canUpdate && <th style={{ width: 32 }}><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>}
              <th onClick={() => view.onSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Name{view.sort?.col === 'name' ? (view.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
              <th onClick={() => view.onSort('email')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">Email{view.sort?.col === 'email' ? (view.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
              <th>Modules</th><th>MFA</th><th style={{ width: 230 }}></th>
            </tr></thead>
            <tbody>
              {users.length === 0 && <tr><td colSpan={6} className="empty">No users.</td></tr>}
              {users.length > 0 && visibleUsers.length === 0 && <tr><td colSpan={6} className="empty">No users match this filter.</td></tr>}
              {visibleUsers.map((u) => (
                <tr key={u.id}>
                  {canUpdate && <td><input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleUser(u.id)} /></td>}
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    {(u.modules ?? []).map((m) => (
                      <span key={m.key} className="badge badge-gray" style={{ marginRight: 4 }}>{m.key}</span>
                    ))}
                  </td>
                  <td><MfaBadge u={u} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {(canUpdate || canCreate) && <button className="btn btn-ghost btn-sm" onClick={() => startEdit(u)}>Edit</button>}
                    {canUpdate && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} title="Email this user a set-password link" disabled={sendSetup.isPending} onClick={() => sendSetup.mutate([u.id])}>Send setup</button>}
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} title="Who changed what on this account, and when" onClick={() => setHistoryUser(u)}>History</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {historyUser && (
        <ActivityHistoryModal title={historyUser.name} entityType="user" entityId={historyUser.id} onClose={() => setHistoryUser(null)} />
      )}

      {setupResults && (
        <div className="modal-backdrop" onClick={() => setSetupResults(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-body">
              <h3 style={{ marginTop: 0 }}>Password-setup links</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Each link lets that user set their own password (valid 7 days). Emailed where mail is configured; otherwise copy the link below and share it.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflow: 'auto' }}>
                {setupResults.map((r) => (
                  <div key={r.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px' }}>
                    <span style={{ minWidth: 160, fontWeight: 600 }}>{r.name ?? `#${r.userId}`}</span>
                    {r.error ? <span className="error-text" style={{ fontSize: 12.5 }}>{r.error}</span>
                      : r.emailSent ? <span className="badge badge-green">emailed → {r.email}</span>
                      : <>
                          <input className="input" style={{ flex: 1, fontSize: 12 }} readOnly value={r.url ?? ''} onFocus={(e) => e.currentTarget.select()} />
                          <button className="btn btn-ghost btn-sm" onClick={() => { if (r.url) navigator.clipboard?.writeText(r.url); }}>Copy</button>
                        </>}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-primary" onClick={() => setSetupResults(null)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
