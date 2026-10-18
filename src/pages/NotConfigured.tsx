export default function NotConfigured() {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>Supabase not connected</h1>
        <p className="muted">
          Create a <code>.env.local</code> file (copy <code>.env.example</code>) with your Supabase URL and anon key,
          then restart the app. See <code>README.md</code> for the full setup steps.
        </p>
      </div>
    </div>
  );
}
