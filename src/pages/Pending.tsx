import { useAuth } from '../lib/auth';

export default function Pending() {
  const { profile, refreshProfile, signOut } = useAuth();
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="auth-logo">SC</div>
        <h1>Waiting for approval</h1>
        <p className="muted">
          Your account ({profile?.email}) has been created. The site admin needs to approve it before you can use
          Scaffold Checklist.
        </p>
        <button className="btn btn-primary btn-block" onClick={() => void refreshProfile()}>
          Check again
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
