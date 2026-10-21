import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// Public "set your password" page — the link emailed (or copied) to imported users and password
// resets. Reuses the invite token store; here you only set a password (the account already exists).
export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['reset-token', token],
    queryFn: async () => (await api.get(`/public/invites/${token}`)).data as { valid: boolean; email?: string },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api.post(`/public/invites/${token}/set-password`, { password });
      setDone(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch {
      setErr('Could not set your password — this link may have expired or already been used.');
    } finally {
      setBusy(false);
    }
  };

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="login-wrap"><div className="login-card">
      <div className="brand"><span className="brand-mark">I</span> InfraMatrix</div>
      {children}
    </div></div>
  );

  if (isLoading) return <Card><p className="muted" style={{ textAlign: 'center' }}>Checking link…</p></Card>;
  if (!data?.valid) return <Card><p className="error-text" style={{ textAlign: 'center' }}>This link is invalid or has expired.</p></Card>;
  if (done) return <Card><p className="success-text" style={{ textAlign: 'center' }}>Password set! Redirecting to sign in…</p></Card>;

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand"><span className="brand-mark">I</span> InfraMatrix</div>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0, marginBottom: 20 }}>
          Set your password{data.email ? ` — ${data.email}` : ''}
        </p>
        <div className="field"><label>New password</label><input className="input" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <div className="field"><label>Confirm password</label><input className="input" type="password" minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
        {err && <div className="error-text">{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
      </form>
    </div>
  );
}
