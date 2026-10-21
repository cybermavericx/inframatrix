import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { resourcesForModule } from '../modules/resources';
import Security from '../pages/Security';
import Footer from './Footer';

const LABELS: Record<string, string> = { infra: 'Infra', jobbag: 'JobBag' };

type MfaPolicy = { mfaEnabled: boolean; mfaRequired: boolean; mfaRequiredBy: string | null };

export default function Shell() {
  const { user, ability, logout } = useAuth();
  const loc = useLocation();
  const modules = user?.modules ?? [];
  const seg = loc.pathname.split('/')[1] || modules[0] || '';
  const isAdmin = seg === 'admin';
  const activeModule = isAdmin ? '' : seg;
  const canUsers = ability.can('read', 'core.users');
  const sideResources = activeModule
    ? resourcesForModule(activeModule).filter((r) => ability.can('read', r.resource))
    : [];
  const initial = (user?.email?.[0] ?? '?').toUpperCase();

  // Enforcement policy — deliberately a live poll of /auth/mfa/status, not the JWT (which is cached
  // client-side for its whole TTL and would show a stale day-count/status). Loading/undefined never
  // blocks or warns — only an actual "required and not enabled" response does.
  const { data: mfaPolicy } = useQuery({
    queryKey: ['/auth/mfa/status'],
    queryFn: async () => (await api.get('/auth/mfa/status')).data as MfaPolicy,
    staleTime: 60_000,
  });
  const daysLeft = mfaPolicy?.mfaRequiredBy
    ? Math.ceil((new Date(mfaPolicy.mfaRequiredBy).getTime() - Date.now()) / 86400000)
    : null;
  const mfaPending = !!mfaPolicy?.mfaRequired && !mfaPolicy.mfaEnabled;
  const mfaBlocked = mfaPending && daysLeft !== null && daysLeft <= 0;
  const mfaWarn = mfaPending && !mfaBlocked;

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" style={{ textDecoration: 'none' }}><span className="brand-mark">I</span> InfraMatrix</NavLink>
        {!mfaBlocked && (
          <nav className="tabs">
            <NavLink to="/" end className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>Dashboard</NavLink>
            {modules.map((m) => (
              <NavLink key={m} to={`/${m}`} className={'tab' + (activeModule === m ? ' active' : '')}>
                {LABELS[m] ?? m}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="spacer" />
        {!mfaBlocked && canUsers && <NavLink to="/admin/users" className={'tab' + (isAdmin ? ' active' : '')}>Users</NavLink>}
        {!mfaBlocked && <NavLink to="/security" className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>Security</NavLink>}
        <div className="user-chip"><span className="avatar">{initial}</span></div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-title">{mfaBlocked ? 'Security' : isAdmin ? 'Administration' : (LABELS[activeModule] ?? activeModule)}</div>
          {!mfaBlocked && (isAdmin ? (
            <>
              <NavLink to="/admin/users" className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>Users</NavLink>
              <NavLink to="/admin/activity" className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>Activity Log</NavLink>
            </>
          ) : (
            sideResources.map((r) => (
              <NavLink key={r.key} to={`/${r.module}/${r.key}`} className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
                {r.title}
              </NavLink>
            ))
          ))}
        </aside>
        <main className="content">
          {mfaWarn && (
            <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid #f59e0b' }}>
              <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong>Two-factor authentication is required for your account</strong>
                <span className="muted">— enable it within {daysLeft} day{daysLeft === 1 ? '' : 's'}.</span>
                <NavLink to="/security" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>Go to Security</NavLink>
              </div>
            </div>
          )}
          {mfaBlocked ? (
            <>
              <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid #ef4444' }}>
                <div className="card-body">
                  <strong className="error-text">Two-factor authentication is now required on your account</strong>
                  <p className="muted" style={{ margin: '6px 0 0' }}>The grace period has ended — enable it below to continue using InfraMatrix.</p>
                </div>
              </div>
              <Security />
            </>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      <Footer />
    </div>
  );
}
