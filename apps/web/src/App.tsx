import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, type ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import Login from './pages/Login';
import AcceptInvite from './pages/AcceptInvite';
import ResetPassword from './pages/ResetPassword';
import Shell from './components/Shell';
// Pages load on first visit (Shell shows "Loading…" meanwhile); Login and Shell stay in the main chunk.
const ModuleHome = lazy(() => import('./pages/ModuleHome'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Users = lazy(() => import('./pages/Users'));
const Security = lazy(() => import('./pages/Security'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ActivityLogPage = lazy(() => import('./pages/ActivityLogPage'));
const CrudPage = lazy(() => import('./components/CrudPage'));
import { RESOURCES } from './modules/resources';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/accept/:token" element={<AcceptInvite />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="infra" element={<ModuleHome moduleKey="infra" />} />
        <Route path="jobbag" element={<ModuleHome moduleKey="jobbag" />} />
        <Route path="admin/users" element={<Users />} />
        <Route path="admin/activity" element={<ActivityLogPage />} />
        <Route path="security" element={<Security />} />
        <Route path="infra/projects" element={<ProjectsPage />} />
        <Route path="infra/environments" element={<EnvironmentsRedirect />} />
        <Route path="jobbag/notifications" element={<NotificationsPage />} />
        {/* key per resource: each list gets its own CrudPage, so search / Quick filter / group-by /
            selection don't carry over when you switch menu items */}
        {RESOURCES
          .filter((r) => !(r.module === 'infra' && (r.key === 'projects' || r.key === 'environments')) && !(r.module === 'jobbag' && r.key === 'notifications'))
          .map((r) => (
            <Route key={r.endpoint} path={`${r.module}/${r.key}`} element={<CrudPage key={r.endpoint} config={r} />} />
          ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Old /infra/environments links and bookmarks → Projects › By hosting, keeping their filter (?sf=, ?view=). */
function EnvironmentsRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('by', 'hosting');
  return <Navigate to={`/infra/projects?${params.toString()}`} replace />;
}
