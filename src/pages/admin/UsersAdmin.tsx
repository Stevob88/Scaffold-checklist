import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import type { Profile, Role } from '../../lib/types';
import { fmtDate } from '../../lib/format';

const ROLES: { value: Role; label: string }[] = [
  { value: 'pending', label: 'Pending (no access)' },
  { value: 'viewer', label: 'Viewer (read only)' },
  { value: 'scaffolder', label: 'Scaffolder (close snags only)' },
  { value: 'inspector', label: 'Inspector' },
  { value: 'admin', label: 'Admin' },
];

export default function UsersAdmin() {
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase.from('profiles').select('*').order('created_at');
      if (err) setError(err.message);
      setUsers((data as Profile[]) ?? []);
    })();
  }, []);

  async function setRole(u: Profile, role: Role) {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)));
    const { error: err } = await supabase.from('profiles').update({ role }).eq('id', u.id);
    if (err) setError(err.message);
  }

  const pending = users.filter((u) => u.role === 'pending').length;

  return (
    <div>
      <p className="small muted">
        Anyone on site can create an account from the sign-in page. New accounts are Pending until you give them a role.
        Give the scaffold foreman and scaffold boss the Scaffolder role: they get notified of new snags and can only see
        and close snags.
      </p>
      {pending > 0 && <div className="alert alert-warn">{pending} account(s) waiting for approval.</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <div className="card list">
        {users.map((u) => (
          <div key={u.id} className="list-row">
            <div>
              <div className="strong">{u.full_name || '(no name)'}</div>
              <div className="small muted">
                {u.email} · joined {fmtDate(u.created_at)}
              </div>
            </div>
            <select value={u.role} onChange={(e) => void setRole(u, e.target.value as Role)} disabled={u.id === me?.id}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
