import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';

function apiErr(e: unknown) {
  const ax = e as { response?: { data?: { message?: string | string[] } } };
  const m = ax.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

/** Self-service "change my own password/email" — separate from the admin's ability to set either
 *  directly on the Users screen; this path requires proving the CURRENT password even though the
 *  session is already authenticated, so a stolen/left-open session alone can't take over the account. */
function ChangePassword() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword(''); setNewPassword(''); setConfirm(''); setErr('');
      toast.notify('Password changed.');
    },
    onError: (e) => setErr(apiErr(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (newPassword !== confirm) { setErr('New password and confirmation do not match.'); return; }
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 320 }}>
      <div className="field"><label>Current password</label><input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></div>
      <div className="field"><label>New password</label><input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} required /></div>
      <div className="field"><label>Confirm new password</label><input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={6} required /></div>
      {err && <div className="error-text">{err}</div>}
      <button className="btn btn-primary btn-sm" disabled={mutation.isPending}>{mutation.isPending ? 'Changing…' : 'Change password'}</button>
    </form>
  );
}

function ChangeEmail() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/auth/change-email', { newEmail, currentPassword }),
    onSuccess: () => {
      toast.notify('Email changed — please log in again with your new email.');
      setTimeout(logout, 1200);
    },
    onError: (e) => setErr(apiErr(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 320 }}>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Current: {user?.email}</p>
      <div className="field"><label>New email</label><input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required /></div>
      <div className="field"><label>Current password</label><input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></div>
      {err && <div className="error-text">{err}</div>}
      <button className="btn btn-primary btn-sm" disabled={mutation.isPending}>{mutation.isPending ? 'Changing…' : 'Change email'}</button>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>You'll be signed out to log back in with the new address.</p>
    </form>
  );
}

/** Self-service two-factor auth setup for the CURRENT user — no special permission required, unlike
 *  /admin/users which manages other people's accounts. */
export default function Security() {
  const qc = useQueryClient();
  const toast = useToast();
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['/auth/mfa/status'],
    queryFn: async () => (await api.get('/auth/mfa/status')).data as { mfaEnabled: boolean },
  });

  const startSetup = async () => {
    setErr('');
    try {
      const r = await api.post('/auth/mfa/setup');
      setSetupData(r.data);
    } catch {
      toast.error('Could not start setup — try again.');
    }
  };

  const confirmEnable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/mfa/enable', { code });
      setSetupData(null);
      setCode('');
      qc.invalidateQueries({ queryKey: ['/auth/mfa/status'] });
      toast.notify('Two-factor authentication is on.');
    } catch {
      setErr('That code is not valid — check your authenticator app and try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/mfa/disable', { code: disableCode });
      setDisableCode('');
      qc.invalidateQueries({ queryKey: ['/auth/mfa/status'] });
      toast.notify('Two-factor authentication is off.');
    } catch {
      setErr('That code is not valid.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head"><h1>Security</h1></div>

      <div className="card">
        <div className="card-body">
          <strong>Two-factor authentication</strong>
          {isLoading ? (
            <p className="muted">Loading…</p>
          ) : data?.mfaEnabled ? (
            <>
              <p className="muted" style={{ marginTop: 6 }}>
                <span className="badge badge-green">ON</span> — a code from your authenticator app is required at every login.
              </p>
              <form onSubmit={confirmDisable} style={{ maxWidth: 320, marginTop: 12 }}>
                <div className="field">
                  <label>Enter your current code to turn it off</label>
                  <input className="input" inputMode="numeric" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="123456" required />
                </div>
                {err && <div className="error-text">{err}</div>}
                <button className="btn btn-danger btn-sm" disabled={busy}>{busy ? 'Disabling…' : 'Disable two-factor authentication'}</button>
              </form>
            </>
          ) : setupData ? (
            <div style={{ marginTop: 10 }}>
              <p className="muted">Scan this with Google Authenticator, Authy, Microsoft Authenticator, or any TOTP app:</p>
              <img src={setupData.qrCodeDataUrl} alt="Two-factor setup QR code" width={200} height={200} style={{ borderRadius: 8 }} />
              <p className="muted" style={{ fontSize: 12.5 }}>
                Can't scan? Enter this code manually: <code style={{ userSelect: 'all' }}>{setupData.secret}</code>
              </p>
              <form onSubmit={confirmEnable} style={{ maxWidth: 320, marginTop: 10 }}>
                <div className="field">
                  <label>Enter the 6-digit code it shows</label>
                  <input className="input" inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required />
                </div>
                {err && <div className="error-text">{err}</div>}
                <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Confirming…' : 'Confirm & turn on'}</button>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => { setSetupData(null); setCode(''); setErr(''); }}>Cancel</button>
              </form>
            </div>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 6 }}>
                <span className="badge badge-gray">OFF</span> — add a second factor so a leaked password alone isn't enough to sign in.
              </p>
              <button className="btn btn-primary btn-sm" onClick={startSetup}>Enable two-factor authentication</button>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-body">
          <strong>Change password</strong>
          <div style={{ marginTop: 10 }}><ChangePassword /></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-body">
          <strong>Change email</strong>
          <div style={{ marginTop: 10 }}><ChangeEmail /></div>
        </div>
      </div>
    </div>
  );
}
