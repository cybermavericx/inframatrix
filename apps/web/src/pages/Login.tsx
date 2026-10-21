import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Footer from '../components/Footer';

export default function Login() {
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await login(email, password);
      if (r.mfaRequired) {
        setMfaToken(r.mfaToken);
      } else {
        navigate('/');
      }
    } catch {
      setError('These credentials do not match our records.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyMfa(mfaToken as string, code);
      navigate('/');
    } catch {
      setError('That code is not valid — check your authenticator app and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (mfaToken) {
    return (
      <div className="login-wrap">
        <form className="login-card" onSubmit={submitCode}>
          <div className="brand"><span className="brand-mark">I</span> InfraMatrix</div>
          <p className="muted" style={{ textAlign: 'center', marginTop: 0, marginBottom: 22 }}>Enter the code from your authenticator app</p>
          <div className="field">
            <label>6-digit code</label>
            <input className="input" inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" required />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }}
            onClick={() => { setMfaToken(null); setCode(''); setError(''); }}>← Back</button>
        </form>
        <Footer fixed />
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand"><span className="brand-mark">I</span> InfraMatrix</div>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0, marginBottom: 22 }}>Sign in to continue</p>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="username" required />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      <Footer fixed />
    </div>
  );
}
