import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import NotificationPrompt from './NotificationPrompt';
import FixQueueStatus from './FixQueueStatus';

export default function Layout() {
  const { profile, settings, isAdmin, isScaffolder, signOut } = useAuth();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="logo">SC</span>
          <div>
            <div className="app-name">Scaffold Checklist</div>
            <div className="site-name">{settings?.site_name}</div>
          </div>
        </div>
        <div className="topbar-user">
          <span className="muted small hide-mobile">{profile?.full_name || profile?.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        {!isScaffolder && (
          <NavLink to="/" end>
            <span className="tab-icon">▦</span>Scaffolds
          </NavLink>
        )}
        <NavLink to={isScaffolder ? '/' : '/snags'} end={isScaffolder}>
          <span className="tab-icon">⚠</span>Snags
        </NavLink>
        {!isScaffolder && (
          <NavLink to="/history">
            <span className="tab-icon">☰</span>History
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/admin">
            <span className="tab-icon">⚙</span>Admin
          </NavLink>
        )}
      </nav>

      <main className="content">
        <NotificationPrompt />
        <FixQueueStatus />
        <Outlet />
      </main>
    </div>
  );
}
