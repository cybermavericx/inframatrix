import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

type Row = Record<string, unknown>;
const fmt = (v: unknown) => (v == null ? '' : String(v));

export default function NotificationsPage() {
  const { ability } = useAuth();
  const qc = useQueryClient();
  const canRead = ability.can('read', 'jobbag.notifications');
  const canRun = ability.can('update', 'jobbag.notifications');
  const canPurge = ability.can('delete', 'jobbag.notifications');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['/jobbag/notifications'],
    queryFn: async () => (await api.get('/jobbag/notifications')).data as Row[],
    enabled: canRead,
  });
  const run = useMutation({
    mutationFn: () => api.post('/jobbag/notifications/run', {}),
    onSuccess: (r) => { alert(`Ran: ${r.data.reminders} reminder(s) fired, ${r.data.vendorExpiry} expiry notice(s), ${r.data.paymentsDue ?? 0} payment-due notice(s)`); qc.invalidateQueries({ queryKey: ['/jobbag/notifications'] }); },
  });
  const purge = useMutation({
    mutationFn: () => api.post('/jobbag/notifications/purge', {}),
    onSuccess: (r) => { alert(`Purged ${r.data.deleted} old notification(s)`); qc.invalidateQueries({ queryKey: ['/jobbag/notifications'] }); },
  });

  if (!canRead) return <div className="card"><div className="card-body">You do not have access to Notifications.</div></div>;

  return (
    <div>
      <div className="page-head">
        <h1>Notifications</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canRun && <button className="btn btn-primary" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Running…' : 'Run reminders now'}</button>}
          {canPurge && <button className="btn btn-ghost" onClick={() => { if (confirm('Purge notifications older than 90 days?')) purge.mutate(); }}>Purge old (90d)</button>}
        </div>
      </div>
      <p className="muted" style={{ marginTop: -10 }}>
        Triggered reminders &amp; expiry alerts. The scheduler fires reminders hourly and rotates recurring ones (e.g. monthly). Entries older than 90 days auto-purge to keep the database small.
      </p>

      <div className="card">
        <table className="table">
          <thead><tr><th>source</th><th>subject</th><th>recipient</th><th>status</th><th>sent at</th></tr></thead>
          <tbody>
            {isLoading && rows.length === 0 && [0, 1, 2].map((i) => <tr key={i}><td colSpan={5}><div className="skel" /></td></tr>)}
            {!isLoading && rows.length === 0 && <tr><td colSpan={5} className="empty">No notifications yet. Click "Run reminders now" to fire any due reminders.</td></tr>}
            {rows.map((n) => (
              <tr key={String(n.id)}>
                <td><span className="badge badge-blue">{fmt(n.source)}</span></td>
                <td>{fmt(n.subject)}</td>
                <td>{fmt(n.recipient)}</td>
                <td><span className={'badge ' + (n.status === 'SENT' ? 'badge-green' : 'badge-red')}>{fmt(n.status)}</span></td>
                <td>{fmt(n.sentAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
