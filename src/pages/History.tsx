import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Inspection } from '../lib/types';
import { fmtDateTime } from '../lib/format';

type Row = Inspection & { snags: { status: string }[] };

export default function History() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('inspections')
        .select('*, snags(status)')
        .order('started_at', { ascending: false });
      setRows((data as Row[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) => !q || r.scaffold_name.toLowerCase().includes(q) || r.inspector_name.toLowerCase().includes(q),
  );

  return (
    <div>
      <div className="page-head">
        <h1>History</h1>
        <input className="search" type="search" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {loading ? (
        <div className="muted">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="empty">No inspections yet.</div>
      ) : (
        <div className="list card">
          {visible.map((r) => {
            const open = r.snags.filter((s) => s.status !== 'closed').length;
            return (
              <Link key={r.id} to={r.status === 'in_progress' ? `/inspect/${r.id}` : `/inspections/${r.id}`} className="list-row">
                <div>
                  <div className="strong">{r.scaffold_name}</div>
                  <div className="small muted">
                    {fmtDateTime(r.completed_at ?? r.started_at)} · {r.inspector_name}
                  </div>
                </div>
                <div className="row gap-sm">
                  {r.status === 'in_progress' && <span className="badge badge-amber">In progress</span>}
                  {r.status === 'completed' && !r.sent_at && <span className="badge badge-grey">Not sent</span>}
                  {r.snags.length > 0 && (
                    <span className={`badge ${open ? 'badge-red' : 'badge-green'}`}>
                      {open ? `${open}/${r.snags.length} open` : `${r.snags.length} closed`}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
