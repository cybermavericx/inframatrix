import { useAuth } from '../auth/AuthContext';
import { ActivityLogView } from '../components/ActivityLogView';

/** System-wide change history — who changed what, and when, across every record. Administrator view
 *  (the API requires read access to Users); a single record's history is on its own detail screen. */
export default function ActivityLogPage() {
  const { ability } = useAuth();
  if (!ability.can('read', 'core.users')) {
    return <div className="card"><div className="card-body">You do not have access to the Activity Log.</div></div>;
  }
  return (
    <div>
      <div className="page-head"><h1>Activity Log</h1></div>
      <p className="muted" style={{ marginTop: -10 }}>
        Every create, edit and delete across the system — who did it, when, and what changed (old → new). History starts from when logging was enabled.
      </p>
      <div className="card"><div className="card-body"><ActivityLogView /></div></div>
    </div>
  );
}
