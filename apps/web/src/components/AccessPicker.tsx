import type { RbacApp, RbacModule } from '../auth/types';

const short = (l: string) => l.split(': ').pop();

/** Reusable module + per-app permission picker (used by Create user and Invite). */
export function AccessPicker({
  structure, moduleKeys, groupKeys, onModules, onGroups,
}: {
  structure: RbacModule[];
  moduleKeys: string[];
  groupKeys: string[];
  onModules: (m: string[]) => void;
  onGroups: (g: string[]) => void;
}) {
  const toggleModule = (k: string) =>
    onModules(moduleKeys.includes(k) ? moduleKeys.filter((x) => x !== k) : [...moduleKeys, k]);

  const levelKeysOf = (app: RbacApp) => app.groups.filter((g) => g.kind === 'level').map((g) => g.key);
  const curLevel = (app: RbacApp) => levelKeysOf(app).find((k) => groupKeys.includes(k)) ?? '';
  const setLevel = (app: RbacApp, key: string) => {
    const next = groupKeys.filter((k) => !levelKeysOf(app).includes(k));
    if (key) next.push(key);
    onGroups(next);
  };
  const toggleStd = (key: string) =>
    onGroups(groupKeys.includes(key) ? groupKeys.filter((k) => k !== key) : [...groupKeys, key]);

  return (
    <>
      <h3>Modules (tabs)</h3>
      <div style={{ display: 'flex', gap: 18, marginBottom: 6, flexWrap: 'wrap' }}>
        {structure.map((m) => (
          <label key={m.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={moduleKeys.includes(m.key)} onChange={() => toggleModule(m.key)} />
            {m.label}
          </label>
        ))}
      </div>

      {structure.filter((m) => moduleKeys.includes(m.key)).map((m) => (
        <div key={m.key} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 8 }}>
          <div className="sidebar-title" style={{ padding: '0 0 6px' }}>{m.label} permissions</div>
          {m.apps.map((app) => {
            const levels = app.groups.filter((g) => g.kind === 'level').sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
            const stand = app.groups.filter((g) => g.kind === 'standalone');
            return (
              <div key={app.id} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0', flexWrap: 'wrap' }}>
                <span style={{ width: 130, fontSize: 13 }}>{app.label}</span>
                {levels.length > 0 && (
                  <select className="input" style={{ width: 150 }} value={curLevel(app)} onChange={(e) => setLevel(app, e.target.value)}>
                    <option value="">None</option>
                    {levels.map((g) => <option key={g.key} value={g.key}>{short(g.label)}</option>)}
                  </select>
                )}
                {stand.map((g) => (
                  <label key={g.key} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                    <input type="checkbox" checked={groupKeys.includes(g.key)} onChange={() => toggleStd(g.key)} />
                    {short(g.label)}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
