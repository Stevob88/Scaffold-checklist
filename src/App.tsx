import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import Layout from './components/Layout';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Pending from './pages/Pending';
import NotConfigured from './pages/NotConfigured';
import Home from './pages/Home';
import Inspect from './pages/Inspect';
import Snags from './pages/Snags';
import History from './pages/History';
import AdminLayout from './pages/admin/AdminLayout';
import ChecklistAdmin from './pages/admin/ChecklistAdmin';
import ScaffoldsAdmin from './pages/admin/ScaffoldsAdmin';
import UsersAdmin from './pages/admin/UsersAdmin';
import SettingsAdmin from './pages/admin/SettingsAdmin';

const Report = lazy(() => import('./pages/Report'));
const ArchiveAdmin = lazy(() => import('./pages/admin/ArchiveAdmin'));

function Gate() {
  const { session, profile, loading, isAdmin, isScaffolder } = useAuth();

  if (loading) return <div className="splash">Loading...</div>;
  if (!session) {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (!profile || profile.role === 'pending') {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Pending />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<div className="splash">Loading...</div>}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        {isScaffolder ? (
          <Route element={<Layout />}>
            <Route index element={<Snags />} />
            <Route path="snags" element={<Snags />} />
            <Route path="inspections/:id" element={<Report />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        ) : (
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="inspect/:id" element={<Inspect />} />
            <Route path="inspections/:id" element={<Report />} />
            <Route path="snags" element={<Snags />} />
            <Route path="history" element={<History />} />
            {isAdmin && (
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="checklist" replace />} />
                <Route path="checklist" element={<ChecklistAdmin />} />
                <Route path="scaffolds" element={<ScaffoldsAdmin />} />
                <Route path="users" element={<UsersAdmin />} />
                <Route path="settings" element={<SettingsAdmin />} />
                <Route path="archive" element={<ArchiveAdmin />} />
              </Route>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  );
}
