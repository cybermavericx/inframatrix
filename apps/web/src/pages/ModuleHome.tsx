import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { resourcesForModule } from '../modules/resources';

const LABELS: Record<string, string> = { infra: 'Infra', jobbag: 'JobBag' };

export default function ModuleHome({ moduleKey }: { moduleKey: string }) {
  const { ability } = useAuth();
  const resources = resourcesForModule(moduleKey).filter((r) => ability.can('read', r.resource));

  return (
    <div>
      <div className="page-head"><h1>{LABELS[moduleKey] ?? moduleKey}</h1></div>
      {resources.length === 0 ? (
        <div className="card"><div className="card-body muted">You have no accessible sections in this module.</div></div>
      ) : (
        <div className="cards-grid">
          {resources.map((r) => (
            <Link key={r.key} to={`/${r.module}/${r.key}`} className="tile">
              {r.title}
              <span className="tile-sub">Manage {r.title.toLowerCase()} →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
