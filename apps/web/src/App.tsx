import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import Login from './pages/Login';
import AcceptInvite from './pages/AcceptInvite';
import ResetPassword from './pages/ResetPassword';
import Shell from './components/Shell';
import ModuleHome from './pages/ModuleHome';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Security from './pages/Security';
import ProjectsPage from './pages/ProjectsPage';
import NotificationsPage from './pages/NotificationsPage';
import ActivityLogPage from './pages/ActivityLogPage';
import CrudPage from './components/CrudPage';
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
        <Route path="jobbag/notifications" element={<NotificationsPage />} />
        {RESOURCES
          .filter((r) => !(r.module === 'infra' && r.key === 'projects') && !(r.module === 'jobbag' && r.key === 'notifications'))
          .map((r) => (
            <Route key={r.endpoint} path={`${r.module}/${r.key}`} element={<CrudPage config={r} />} />
          ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
