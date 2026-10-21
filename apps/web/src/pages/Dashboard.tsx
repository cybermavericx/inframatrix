import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

type Stats = {
  servers: { total: number; byStatus: Record<string, number>; byProvider: Record<string, number>; amc: number };
  serversUsage: { id: number; serverName: string; provider: string | null; capacity: number | null; used: number; free: number | null }[];
  projects: { total: number; published: number; unpublished: number; ready: number; draft: number; withoutPoc: number };
  environments: { total: number; staging: number; uat: number; live: number; liveMissingChecklist: number; items: { projectId: number | null; projectName: string; envId: number | null; type: string; url: string | null; checklistCompleted: boolean }[] };
  integrations: { total: number; items: { projectId: number | null; projectName: string; envId: number | null; envType: string; integrationTypeName: string; detail: string }[] };
  integrationFlags: { total: number; items: { projectId: number | null; projectName: string; envId: number | null; envType: string; integrationTypeName: string; flags: string[] }[] };
  byPoc: { pocUserId: number | null; name: string; email: string; total: number; published: number; unpublished: number; missingChecklist: number }[];
  jobbag: { clients: number; vendors: number; vendorServices: number; expiringSoon: number; jobs: number; reminders: number };
  generatedAt: string;
};

type Pay = {
  id: number; direction: string; amount: number | null; currency: string | null;
  dueDate: string | null; status: string; forWhat?: string | null;
  vendor?: { vendorName?: string } | null;
  client?: { name?: string } | null;
  vendorService?: { serviceName?: string } | null;
};

type Accent = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'violet';
const ACCENT: Record<Accent, string> = {
  blue: '#3b82f6', green: '#22c55e', amber: '#f59e0b', red: '#ef4444', gray: '#94a3b8', violet: '#8b5cf6',
};

const HIDDEN_KEY = 'dashboard.hiddenCards.v1';
const loadHidden = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch { return new Set(); } };

function StatCard({ label, value, sub, accent = 'gray', onClick }: { label: string; value: number | string; sub?: string; accent?: Accent; onClick?: () => void }) {
  return (
    <div className="card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', borderLeft: `3px solid ${ACCENT[accent]}` }}>
      <div className="card-body" style={{ padding: '14px 16px' }}>
        <div className="muted" style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, marginTop: 4, color: ACCENT[accent] }}>{value}</div>
        {sub && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

/** Big module entry tile shown on the dashboard overview — click to open that module's dashboard. */
function SectionCard({ title, sub, accent, onClick }: { title: string; sub: string; accent: Accent; onClick: () => void }) {
  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer', borderLeft: `4px solid ${ACCENT[accent]}` }}>
      <div className="card-body" style={{ padding: '30px 26px' }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: ACCENT[accent], lineHeight: 1.1 }}>{title}</div>
        <div className="muted" style={{ marginTop: 8, fontSize: 13.5 }}>{sub}</div>
        <div style={{ marginTop: 16, color: 'var(--primary-2)', fontWeight: 600, fontSize: 13.5 }}>Open {title} dashboard →</div>
      </div>
    </div>
  );
}

function UpcomingPaymentsCard({ payments, direction, title, accent, nav }: {
  payments: Pay[]; direction: string; title: string; accent: Accent; nav: (to: string) => void;
}) {
  const [period, setPeriod] = useState<'7' | '30' | 'all'>('all');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = period === 'all' ? null : new Date(today.getTime() + Number(period) * 864e5).toISOString().slice(0, 10);

  const items = payments
    .filter((p) => p.direction === direction && p.status !== 'paid' && p.dueDate)
    .filter((p) => !horizon || (p.dueDate as string) <= horizon)
    .sort((a, b) => ((a.dueDate as string) < (b.dueDate as string) ? -1 : 1));

  const sumByCcy = (arr: Pay[]) => {
    const m = new Map<string, number>();
    for (const p of arr) { const c = p.currency || '—'; m.set(c, (m.get(c) || 0) + (Number(p.amount) || 0)); }
    return [...m.entries()].map(([c, v]) => `${v.toLocaleString()} ${c}`).join('  ·  ') || '—';
  };
  const partyOf = (p: Pay) => (direction === 'outgoing' ? p.vendor?.vendorName : p.client?.name) || '—';

  // group by YYYY-MM of dueDate (already sorted ascending)
  const groups: { key: string; label: string; rows: Pay[] }[] = [];
  for (const p of items) {
    const key = (p.dueDate as string).slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const [y, m] = key.split('-').map(Number);
      g = { key, label: new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }), rows: [] };
      groups.push(g);
    }
    g.rows.push(p);
  }

  return (
    <div className="card" style={{ borderLeft: `3px solid ${ACCENT[accent]}` }}>
      <div className="card-body" style={{ paddingBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>{title}</strong>
          <span className="muted" style={{ fontSize: 12.5 }}>{items.length} due · {sumByCcy(items)}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {(['7', '30', 'all'] as const).map((p) => (
              <button key={p} className={'btn btn-sm ' + (period === p ? 'btn-primary' : 'btn-ghost')} onClick={() => setPeriod(p)}>
                {p === '7' ? 'Next 7d' : p === '30' ? 'Next 30d' : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <table className="table">
        <tbody>
          {items.length === 0 && <tr><td className="empty">No upcoming {direction === 'outgoing' ? 'vendor' : 'client'} payments {period === 'all' ? '' : `in the next ${period} days`}.</td></tr>}
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr>
                <td colSpan={4} style={{ background: 'var(--bg-2)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)' }}>
                  {g.label} — {g.rows.length} · {sumByCcy(g.rows)}
                </td>
              </tr>
              {g.rows.map((p) => {
                const overdue = (p.dueDate as string) < todayStr;
                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/jobbag/payments?view=${p.id}`)}>
                    <td style={{ width: 96 }}>
                      <span className={'badge ' + (overdue ? 'badge-red' : 'badge-blue')}>{p.dueDate}</span>
                    </td>
                    <td style={{ color: 'var(--primary-2)', fontWeight: 600 }}>{partyOf(p)}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{p.vendorService?.serviceName ?? p.forWhat ?? ''}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.amount != null ? `${Number(p.amount).toLocaleString()} ${p.currency ?? ''}` : '—'}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const { user, ability } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canInfra = ability.can('read', 'infra.projects') || ability.can('read', 'infra.servers');
  const canJobbag = (user?.modules ?? []).includes('jobbag');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['/dashboard/stats'],
    queryFn: async () => (await api.get('/dashboard/stats')).data as Stats,
  });

  // Upcoming payments (in/out) for the dashboard money cards
  const { data: payments = [] } = useQuery({
    queryKey: ['/jobbag/payments'],
    queryFn: async () => (await api.get('/jobbag/payments')).data as Pay[],
    enabled: canJobbag,
  });

  const [customize, setCustomize] = useState(false);
  // Drill-down for stats with no dedicated list page (environments/integrations live nested inside
  // each project) — clicking the card opens a modal table instead of navigating away.
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggleExpanded = (id: string) => setExpanded((v) => (v === id ? null : id));
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const persist = (next: Set<string>) => { setHidden(new Set(next)); localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); };
  const toggle = (id: string) => { const n = new Set(hidden); if (n.has(id)) n.delete(id); else n.add(id); persist(n); };

  // card catalog — each entry is toggleable; gated by module access
  const cards = useMemo(() => {
    if (!data) return [] as { id: string; group: string; el: React.ReactNode }[];
    const list: { id: string; group: string; el: React.ReactNode }[] = [];
    if (canInfra) {
      const s = data.servers, p = data.projects, e = data.environments;
      list.push({ id: 'servers', group: 'Infra', el: <StatCard label="Hosting / Servers" value={s.total} sub={`AMC: ${s.amc} · active: ${s.byStatus.active ?? 0}`} accent="violet" onClick={() => nav('/infra/servers')} /> });
      list.push({ id: 'projects', group: 'Infra', el: <StatCard label="Projects" value={p.total} sub="all projects" accent="blue" onClick={() => nav('/infra/projects')} /> });
      list.push({ id: 'published', group: 'Infra', el: <StatCard label="Published" value={p.published} accent="green" onClick={() => nav('/infra/projects?publishState=published')} /> });
      list.push({ id: 'unpublished', group: 'Infra', el: <StatCard label="Unpublished" value={p.unpublished} sub={`${p.ready} ready · ${p.draft} draft`} accent="amber" onClick={() => nav('/infra/projects?isPublished=false')} /> });
      list.push({ id: 'ready', group: 'Infra', el: <StatCard label="Ready to publish" value={p.ready} sub="all checks pass" accent="blue" onClick={() => nav('/infra/projects?publishState=ready')} /> });
      list.push({ id: 'draft', group: 'Infra', el: <StatCard label="Draft / incomplete" value={p.draft} sub="missing required info" accent="gray" onClick={() => nav('/infra/projects?publishState=draft')} /> });
      list.push({ id: 'no-poc', group: 'Infra', el: <StatCard label="Projects without POC" value={p.withoutPoc} accent="red" onClick={() => nav('/infra/projects?pocUserId=')} /> });
      list.push({ id: 'environments', group: 'Infra', el: <StatCard label="Environments" value={e.total} sub={`staging ${e.staging} · uat ${e.uat} · live ${e.live} — click to list`} accent="violet" onClick={() => toggleExpanded('environments')} /> });
      list.push({ id: 'live-no-checklist', group: 'Infra', el: <StatCard label="Live envs missing checklist" value={e.liveMissingChecklist} accent="red" onClick={() => nav('/infra/projects?envLiveMissingChecklist=true')} /> });
      list.push({ id: 'integrations', group: 'Infra', el: <StatCard label="Integrations" value={data.integrations.total} sub="click to list" accent="gray" onClick={() => toggleExpanded('integrations')} /> });
      list.push({ id: 'integration-flags', group: 'Infra', el: <StatCard label="CMS/Integration flags" value={data.integrationFlags.total} sub="generic URL or non-suggested value — click to list" accent="red" onClick={() => toggleExpanded('integration-flags')} /> });
      list.push({ id: 'servers-breakdown', group: 'Infra', el: <BreakdownCard title="Servers by provider" data={s.byProvider} onItem={(p) => nav(`/infra/servers?provider=${encodeURIComponent(p)}`)} /> });
      list.push({ id: 'server-usage', group: 'Infra', el: <ServerUsageCard rows={data.serversUsage} onServer={(name) => nav(`/infra/servers?serverName=${encodeURIComponent(name)}`)} /> });
      list.push({ id: 'by-poc', group: 'Infra', el: <PocCard rows={data.byPoc} onPoc={(id) => nav(`/infra/projects?pocUserId=${id ?? ''}`)} /> });
    }
    if (canJobbag) {
      const j = data.jobbag;
      list.push({ id: 'jb-pay-out', group: 'JobBag', el: <UpcomingPaymentsCard payments={payments} direction="outgoing" title="Vendor payments — going OUT" accent="red" nav={nav} /> });
      list.push({ id: 'jb-pay-in', group: 'JobBag', el: <UpcomingPaymentsCard payments={payments} direction="incoming" title="Client payments — coming IN" accent="green" nav={nav} /> });
      list.push({ id: 'jb-clients', group: 'JobBag', el: <StatCard label="Clients" value={j.clients} accent="blue" onClick={() => nav('/jobbag/clients')} /> });
      list.push({ id: 'jb-vendors', group: 'JobBag', el: <StatCard label="Vendors" value={j.vendors} accent="blue" onClick={() => nav('/jobbag/vendors')} /> });
      list.push({ id: 'jb-services', group: 'JobBag', el: <StatCard label="Vendor Services" value={j.vendorServices} accent="violet" onClick={() => nav('/jobbag/vendor-services')} /> });
      list.push({ id: 'jb-expiring', group: 'JobBag', el: <StatCard label="Expiring ≤ 30 days" value={j.expiringSoon} accent="amber" onClick={() => nav('/jobbag/vendor-services')} /> });
      list.push({ id: 'jb-jobs', group: 'JobBag', el: <StatCard label="Jobs" value={j.jobs} accent="green" onClick={() => nav('/jobbag/jobs')} /> });
      list.push({ id: 'jb-reminders', group: 'JobBag', el: <StatCard label="Reminders" value={j.reminders} accent="gray" onClick={() => nav('/jobbag/reminders')} /> });
    }
    return list;
  }, [data, canInfra, canJobbag, nav, payments]);

  const wide = new Set(['by-poc', 'servers-breakdown', 'server-usage', 'jb-pay-out', 'jb-pay-in']);
  const visible = cards.filter((c) => !hidden.has(c.id));

  if (!canInfra && !canJobbag) {
    return <div className="card"><div className="card-body">No access yet. Please contact an administrator.</div></div>;
  }

  // Module view: overview (two entry cards) → drill into Infra or JobBag. If the user has only one
  // module, skip the chooser and show it directly.
  const param = searchParams.get('module');
  const view: 'infra' | 'jobbag' | null =
    param === 'infra' || param === 'jobbag' ? param : (canInfra && canJobbag ? null : canInfra ? 'infra' : 'jobbag');
  const groupName = view === 'infra' ? 'Infra' : view === 'jobbag' ? 'JobBag' : null;
  const shown = groupName ? visible.filter((c) => c.group === groupName) : [];
  const go = (m: 'infra' | 'jobbag') => setSearchParams({ module: m });
  const j = data?.jobbag;

  return (
    <div>
      <div className="page-head">
        {view && (canInfra && canJobbag) ? (
          <button className="btn btn-ghost btn-sm" style={{ marginRight: 10 }} onClick={() => setSearchParams({})}>← Dashboard</button>
        ) : null}
        <h1>{groupName ?? 'Dashboard'}</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {data && <span className="muted" style={{ fontSize: 12 }}>updated {new Date(data.generatedAt).toLocaleTimeString()}</span>}
          {view && <button className="btn btn-ghost btn-sm" onClick={() => setCustomize((v) => !v)}>{customize ? 'Done' : 'Customize'}</button>}
        </div>
      </div>

      {isLoading && <div className="card"><div className="card-body muted">Loading dashboard…</div></div>}
      {isError && <div className="card"><div className="card-body error-text">Could not load dashboard stats.</div></div>}

      {/* ── Overview: two big module entry cards ── */}
      {!view && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
          {canInfra && (
            <SectionCard title="Infra" accent="violet" onClick={() => go('infra')}
              sub={`${data.servers.total} servers · ${data.projects.total} projects · ${data.environments.total} environments`} />
          )}
          {canJobbag && j && (
            <SectionCard title="JobBag" accent="blue" onClick={() => go('jobbag')}
              sub={`${j.vendors} vendors · ${j.clients} clients · ${j.vendorServices} services`} />
          )}
        </div>
      )}

      {/* ── Module dashboard (Infra or JobBag) ── */}
      {view && (
        <>
          {customize && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-body">
                <strong>Customize {groupName} cards</strong>
                <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>Tick the cards to show. Your choice is saved on this device.</p>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {cards.filter((c) => c.group === groupName).map((c) => (
                    <label key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                      <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggle(c.id)} />
                      {c.id}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          {data && shown.length === 0 && <div className="card"><div className="card-body muted">No cards selected. Click <b>Customize</b> to add some.</div></div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, alignItems: 'start' }}>
            {shown.map((c) => (
              <div key={c.id} style={wide.has(c.id) ? { gridColumn: '1 / -1' } : undefined}>{c.el}</div>
            ))}
          </div>
          {data && expanded === 'environments' && (
            <DrillPanel title="Environments" onClose={() => setExpanded(null)}
              columns={['Project', 'Type', 'URL', 'Checklist']}
              rows={data.environments.items}
              renderRow={(r) => [r.projectName, r.type, r.url ?? '—', r.checklistCompleted ? 'done' : 'missing']}
              onRowClick={(r) => r.projectId != null && nav(`/infra/projects?view=${r.projectId}`)} />
          )}
          {data && expanded === 'integrations' && (
            <DrillPanel title="Integrations" onClose={() => setExpanded(null)}
              columns={['Project', 'Environment', 'Type', 'Detail']}
              rows={data.integrations.items}
              renderRow={(r) => [r.projectName, r.envType, r.integrationTypeName, r.detail || '—']}
              onRowClick={(r) => r.projectId != null && nav(`/infra/projects?view=${r.projectId}`)} />
          )}
          {data && expanded === 'integration-flags' && (
            <DrillPanel title="CMS/Integration flags" onClose={() => setExpanded(null)}
              columns={['Project', 'Environment', 'Type', 'Flags']}
              rows={data.integrationFlags.items}
              renderRow={(r) => [r.projectName, r.envType, r.integrationTypeName, r.flags.join(' ')]}
              onRowClick={(r) => r.projectId != null && nav(`/infra/projects?view=${r.projectId}`)} />
          )}
        </>
      )}
    </div>
  );
}

function BreakdownCard({ title, data, onItem }: { title: string; data: Record<string, number>; onItem?: (key: string) => void }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="card">
      <div className="card-body">
        <strong>{title}</strong>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.length === 0 && <span className="muted">No data.</span>}
          {entries.map(([k, v]) => {
            const clickable = !!onItem && k !== '(none)';
            return (
              <div key={k} onClick={clickable ? () => onItem!(k) : undefined}
                title={clickable ? `View ${v} ${k} server(s)` : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: clickable ? 'pointer' : 'default' }}>
                <span style={{ width: 110, color: clickable ? 'var(--primary-2)' : undefined }}>{k}</span>
                <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 8 }}>
                  <div style={{ width: `${(v / max) * 100}%`, background: ACCENT.violet, height: 8, borderRadius: 4 }} />
                </div>
                <span style={{ width: 28, textAlign: 'right' }}>{v}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ServerUsageCard({ rows, onServer }: { rows: Stats['serversUsage']; onServer?: (serverName: string) => void }) {
  return (
    <div className="card">
      <div className="card-body" style={{ paddingBottom: 4 }}>
        <strong>Server capacity &amp; free space</strong>
        <span className="muted" style={{ fontSize: 12.5 }}> — hostings (environments) per server</span>
      </div>
      <table className="table">
        <thead><tr><th>Server</th><th>Provider</th><th>Capacity</th><th>Used</th><th>Free</th><th style={{ width: 160 }}>Usage</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="empty">No servers yet.</td></tr>}
          {rows.map((r) => {
            const pct = r.capacity && r.capacity > 0 ? Math.min(100, Math.round((r.used / r.capacity) * 100)) : null;
            const over = r.free != null && r.free < 0;
            const tight = r.free != null && r.free >= 0 && r.free <= 2;
            const barColor = over ? ACCENT.red : tight ? ACCENT.amber : ACCENT.green;
            return (
              <tr key={r.id} onClick={onServer ? () => onServer(r.serverName) : undefined} style={onServer ? { cursor: 'pointer' } : undefined}>
                <td style={onServer ? { color: 'var(--primary-2)', fontWeight: 600 } : undefined}>{r.serverName}</td>
                <td>{r.provider ?? '—'}</td>
                <td>{r.capacity ?? <span className="muted">not set</span>}</td>
                <td>{r.used}</td>
                <td>{r.free == null ? <span className="muted">—</span> : <span className={'badge ' + (over ? 'badge-red' : tight ? 'badge-amber' : 'badge-green')}>{r.free}</span>}</td>
                <td>
                  {pct == null ? <span className="muted">set a capacity</span> : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 8 }}>
                        <div style={{ width: `${pct}%`, background: barColor, height: 8, borderRadius: 4 }} />
                      </div>
                      <span style={{ width: 34, textAlign: 'right', fontSize: 12 }}>{pct}%</span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PocCard({ rows, onPoc }: { rows: Stats['byPoc']; onPoc?: (pocUserId: number | null) => void }) {
  return (
    <div className="card">
      <div className="card-body" style={{ paddingBottom: 4 }}><strong>By Point of Contact</strong></div>
      <table className="table">
        <thead><tr><th>POC</th><th>Total</th><th>Published</th><th>Unpublished</th><th>Missing checklist</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="empty">No projects yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.pocUserId ?? 'none'} onClick={onPoc ? () => onPoc(r.pocUserId) : undefined} style={onPoc ? { cursor: 'pointer' } : undefined}>
              <td style={onPoc ? { color: 'var(--primary-2)', fontWeight: 600 } : undefined}>{r.name}{r.email ? <span className="muted"> · {r.email}</span> : null}</td>
              <td>{r.total}</td>
              <td><span className="badge badge-green">{r.published}</span></td>
              <td>{r.unpublished > 0 ? <span className="badge badge-amber">{r.unpublished}</span> : 0}</td>
              <td>{r.missingChecklist > 0 ? <span className="badge badge-red">{r.missingChecklist}</span> : 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generic drill-down table for a dashboard stat that has no dedicated list page (environments and
 *  integrations live nested inside each project, not as a flat browsable resource). Opens as the same
 *  modal-backdrop/.modal used everywhere else (Project/Server "View", etc.) rather than inline in the
 *  page flow — no scrolling needed to see it, and it matches the rest of the app. Row click jumps
 *  straight into that project's editor via ?view=<id> (ProjectsPage opens it on Environments). */
function DrillPanel<T extends { projectId: number | null }>({
  title, columns, rows, renderRow, onRowClick, onClose,
}: {
  title: string; columns: string[]; rows: T[]; renderRow: (r: T) => (string | number)[];
  onRowClick?: (r: T) => void; onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="card-body" style={{ paddingBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>{title}</strong>
        <span className="muted" style={{ fontSize: 12.5 }}>· {rows.length}{rows.length >= 50 ? '+ (showing first 50)' : ''}</span>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
      </div>
      <table className="table">
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="empty">Nothing to show.</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
              {renderRow(r).map((v, j) => (
                <td key={j} style={j === 0 && onRowClick ? { color: 'var(--primary-2)', fontWeight: 600 } : undefined}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
