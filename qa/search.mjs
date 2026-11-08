/**
 * Server-side search (POST /data/:resource/search) — run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/search.mjs
 *
 * Creates made-up "QA Test Srch ..." servers/projects/environments, checks filters (incl. same-child
 * `any`), sort, group counts, paging, validation, injection handling and per-hop permissions, then
 * deletes everything it created.
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const P = 'QA Test Srch';
const PASSWORD = 'QaTest@12345';

let pass = 0, fail = 0;
const fails = [];
const made = { envs: [], projects: [], servers: [], users: [] };

async function req(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { status: r.status, data };
}
const search = (t, res, body) => req(t, 'POST', `/data/${res}/search`, body);
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; fails.push(label); console.log(`  ❌ ${label}${extra !== undefined ? '  — ' + JSON.stringify(extra) : ''}`); }
}
const ids = (r) => (r.data?.rows ?? []).map((x) => x.id).sort((a, b) => a - b);
const same = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));
async function login(email, password) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const d = await r.json(); if (!d.accessToken) throw new Error('login failed ' + email); return d.accessToken;
}
async function mk(t, list, path, body) {
  const r = await req(t, 'POST', path, body);
  if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.data)}`);
  made[list].push(r.data.id); return r.data;
}

async function run(A) {
  // ---- fixtures ----
  const s1 = await mk(A, 'servers', '/infra/servers', { serverName: `${P} Alpha`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const s2 = await mk(A, 'servers', '/infra/servers', { serverName: `${P} Beta`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const s3 = await mk(A, 'servers', '/infra/servers', { serverName: `${P} 100%_x`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const sQ = await mk(A, 'servers', '/infra/servers', { serverName: `${P} ' OR '1'='1`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const p1 = await mk(A, 'projects', '/infra/projects', { name: `${P} P1`, status: 'active' });
  const p2 = await mk(A, 'projects', '/infra/projects', { name: `${P} P2`, status: 'active' });
  const p3 = await mk(A, 'projects', '/infra/projects', { name: `${P} P3`, status: 'active' });
  const p4 = await mk(A, 'projects', '/infra/projects', { name: `${P} P4`, status: 'active' });
  const env = (projectId, type, serverId, cicdStatus) => mk(A, 'envs', '/infra/environments', { projectId, type, serverId, ...(cicdStatus ? { cicdStatus } : {}) });
  const e1 = await env(p1.id, 'live', s1.id, 'manual');
  const e2 = await env(p1.id, 'staging', s2.id, 'auto');
  const e3 = await env(p2.id, 'live', s1.id, 'auto');
  const e4 = await env(p2.id, 'staging', s2.id, 'manual');
  const e5 = await env(p4.id, 'live', s3.id, 'disabled');
  const e6 = await env(p4.id, 'staging', s1.id, null);
  const inEnvs = { path: 'project.name', operator: 'starts', value: P };
  const inProjects = { path: 'name', operator: 'starts', value: P };

  console.log('\n=== A. Example a — Environments: CI/CD any of [auto, manual] ===');
  const a = await search(A, 'infra.environments', { filter: { items: [inEnvs, { path: 'cicdStatus', operator: 'in', value: ['auto', 'manual'] }] } });
  check('A1 returns exactly the auto/manual environments', a.status === 200 && same(ids(a), [e1.id, e2.id, e3.id, e4.id]), { status: a.status, ids: ids(a) });
  check('A2 total matches', a.data?.total === 4, a.data?.total);

  console.log('\n=== B. Example e — Project has ANY environment where (live AND manual), same child ===');
  const anyQ = await search(A, 'infra.projects', { filter: { items: [inProjects, { any: 'environments', items: [{ path: 'type', operator: 'eq', value: 'live' }, { path: 'cicdStatus', operator: 'eq', value: 'manual' }] }] } });
  check('B1 only P1 (its live env is manual)', anyQ.status === 200 && same(ids(anyQ), [p1.id]), { status: anyQ.status, ids: ids(anyQ), data: anyQ.status !== 200 ? anyQ.data : undefined });
  const split = await search(A, 'infra.projects', { filter: { items: [inProjects, { path: 'environments.type', operator: 'eq', value: 'live' }, { path: 'environments.cicdStatus', operator: 'eq', value: 'manual' }] } });
  check('B2 separate rules may match different environments (P1 and P2)', same(ids(split), [p1.id, p2.id]), ids(split));

  console.log('\n=== C. AND/OR nesting, null handling ===');
  const orQ = await search(A, 'infra.projects', { filter: { items: [inProjects, { op: 'or', items: [{ path: 'name', operator: 'eq', value: `${P} P3` }, { path: 'environments.cicdStatus', operator: 'eq', value: 'disabled' }] }] } });
  check('C1 OR group: P3 by name or P4 by disabled CI/CD', same(ids(orQ), [p3.id, p4.id]), ids(orQ));
  const neq = await search(A, 'infra.environments', { filter: { items: [inEnvs, { path: 'cicdStatus', operator: 'neq', value: 'auto' }] } });
  check('C2 "not auto" keeps empty CI/CD too', same(ids(neq), [e1.id, e4.id, e5.id, e6.id]), ids(neq));
  const isn = await search(A, 'infra.environments', { filter: { items: [inEnvs, { path: 'cicdStatus', operator: 'isNull' }] } });
  check('C3 isNull', same(ids(isn), [e6.id]), ids(isn));
  const noEnv = await search(A, 'infra.projects', { filter: { op: 'and', items: [inProjects, { path: 'environments.id', operator: 'notNull' }] } });
  check('C4 to-many hop: projects that have any environment', same(ids(noEnv), [p1.id, p2.id, p4.id]), ids(noEnv));

  console.log('\n=== D. Sort, group counts, paging ===');
  const sorted = await search(A, 'infra.environments', { filter: { items: [inEnvs] }, sort: [{ path: 'server.serverName', dir: 'desc' }, { path: 'type' }], pageSize: 50 });
  const names = { [s1.id]: s1.serverName, [s2.id]: s2.serverName, [s3.id]: s3.serverName };
  const got = (sorted.data?.rows ?? []).map((r) => names[r.serverId]);
  check('D1 sort by a related field (server name desc)', sorted.status === 200 && JSON.stringify(got) === JSON.stringify([...got].sort().reverse()), got);
  const grp = await search(A, 'infra.environments', { filter: { items: [inEnvs] }, groupBy: ['server.serverName', 'type'] });
  const g = Object.fromEntries((grp.data?.groups ?? []).map((n) => [n.value, n]));
  check('D2 group counts per server', grp.status === 200 && g[s1.serverName]?.count === 3 && g[s2.serverName]?.count === 2 && g[s3.serverName]?.count === 1, grp.data?.groups?.map((n) => [n.value, n.count]));
  const sub = Object.fromEntries((g[s1.serverName]?.children ?? []).map((n) => [n.value, n.count]));
  check('D3 second level counts (Alpha: live 2, staging 1)', sub.live === 2 && sub.staging === 1, sub);
  check('D4 children add up to the parent', (grp.data?.groups ?? []).every((n) => n.children.reduce((s, c) => s + c.count, 0) === n.count));
  const pg = await search(A, 'infra.environments', { filter: { items: [inEnvs] }, sort: [{ path: 'id' }], page: 2, pageSize: 4 });
  check('D5 paging: page 2 of 4-per-page holds the last 2', pg.data?.total === 6 && same(ids(pg), [e5.id, e6.id]), { total: pg.data?.total, ids: ids(pg) });
  const m2m = await search(A, 'core.users', { filter: { items: [{ path: 'groups.key', operator: 'eq', value: 'core.admin' }] } });
  check('D6 many-to-many hop (users in a group)', m2m.status === 200 && (m2m.data?.rows ?? []).some((u) => u.email === ADMIN.email), m2m.status);
  check('D7 never returns a password or MFA secret', (m2m.data?.rows ?? []).every((u) => !('password' in u) && !('mfaSecretEncrypted' in u)));

  console.log('\n=== E. Injection strings are matched literally ===');
  const pct = await search(A, 'infra.servers', { filter: { items: [{ path: 'serverName', operator: 'starts', value: P }, { path: 'serverName', operator: 'contains', value: '%' }] } });
  check('E1 "%" matches only a name that contains %', same(ids(pct), [s3.id]), ids(pct));
  const und = await search(A, 'infra.servers', { filter: { items: [{ path: 'serverName', operator: 'starts', value: P }, { path: 'serverName', operator: 'contains', value: '_' }] } });
  check('E2 "_" is not a wildcard', same(ids(und), [s3.id]), ids(und));
  const quote = await search(A, 'infra.servers', { filter: { items: [{ path: 'serverName', operator: 'eq', value: `${P} ' OR '1'='1` }] } });
  check('E3 quote/OR string matches exactly one record', same(ids(quote), [sQ.id]), ids(quote));
  const tautology = await search(A, 'infra.servers', { filter: { items: [{ path: 'serverName', operator: 'eq', value: "' OR '1'='1" }] } });
  check('E4 bare tautology string matches nothing', tautology.status === 200 && tautology.data.total === 0, tautology.data?.total);
  check('E5 SQL in a path → 400', (await search(A, 'infra.servers', { filter: { items: [{ path: 'serverName;DROP TABLE users', operator: 'eq', value: 'x' }] } })).status === 400);
  check('E6 backtick in a path → 400', (await search(A, 'infra.servers', { filter: { items: [{ path: 'server`Name', operator: 'eq', value: 'x' }] } })).status === 400);

  console.log('\n=== F. Validation → 400 ===');
  const st = async (res, body) => (await search(A, res, body)).status;
  check('F1 unknown field', await st('infra.environments', { filter: { items: [{ path: 'nope', operator: 'eq', value: 1 }] } }) === 400);
  check('F2 unknown relation', await st('infra.environments', { filter: { items: [{ path: 'nope.name', operator: 'eq', value: 1 }] } }) === 400);
  check('F3 unknown operator', await st('infra.environments', { filter: { items: [{ path: 'type', operator: 'like', value: 'x' }] } }) === 400);
  check('F4 operator not valid for the type (gt on a flag)', await st('infra.environments', { filter: { items: [{ path: 'checklistCompleted', operator: 'gt', value: 1 }] } }) === 400);
  check('F5 contains on a number', await st('infra.environments', { filter: { items: [{ path: 'id', operator: 'contains', value: '1' }] } }) === 400);
  check('F6 path deeper than 4', await st('infra.environments', { filter: { items: [{ path: 'project.environments.server.environments.type', operator: 'eq', value: 'live' }] } }) === 400);
  check('F7 any + inner path deeper than 4', await st('infra.projects', { filter: { items: [{ any: 'environments.server.environments', items: [{ path: 'project.name', operator: 'eq', value: 'x' }] }] } }) === 400);
  check('F8 password field', await st('core.users', { filter: { items: [{ path: 'password', operator: 'eq', value: 'x' }] } }) === 400);
  check('F9 MFA secret field', await st('core.users', { filter: { items: [{ path: 'mfaSecretEncrypted', operator: 'isNull' }] } }) === 400);
  check('F10 JSON field', await st('infra.integrations', { filter: { items: [{ path: 'fieldValues', operator: 'isNull' }] } }) === 400);
  check('F11 related user exposes only id/name/email', await st('infra.projects', { filter: { items: [{ path: 'poc.status', operator: 'eq', value: 'Y' }] } }) === 400);
  check('F12 related user is a leaf (no hop past it)', await st('infra.projects', { filter: { items: [{ path: 'poc.groups.key', operator: 'eq', value: 'x' }] } }) === 400);
  check('F13 sort by a to-many path', await st('infra.projects', { sort: [{ path: 'environments.type' }] }) === 400);
  check('F14 unknown request property', await st('infra.projects', { filtr: {} }) === 400);
  check('F15 pageSize over the cap', await st('infra.projects', { pageSize: 500 }) === 400);
  check('F16 paging past the offset cap', await st('infra.projects', { page: 300, pageSize: 50 }) === 400);
  check('F17 too many rules', await st('infra.projects', { filter: { items: Array.from({ length: 41 }, () => ({ path: 'id', operator: 'gt', value: 0 })) } }) === 400);
  check('F18 bad value type (text for a number)', await st('infra.projects', { filter: { items: [{ path: 'id', operator: 'eq', value: 'abc' }] } }) === 400);
  check('F19 empty group', await st('infra.projects', { filter: { items: [] } }) === 400);
  check('F20 unknown resource → 403/404, never 200', [403, 404].includes(await st('infra.nothing', {})));
  check('F21 naming a relation instead of a field', await st('infra.environments', { filter: { items: [{ path: 'server', operator: 'isNull' }] } }) === 400);

  console.log('\n=== G. Per-hop permissions ===');
  const ue = await mk(A, 'users', '/users', { name: `${P} EnvOnly`, email: 'qa_test_srch_env@example.com', password: PASSWORD, moduleKeys: ['infra'], groupKeys: ['infra.environments.viewer'] });
  const envOnly = await login(ue.email, PASSWORD);
  check('G1 own fields → 200', (await search(envOnly, 'infra.environments', { filter: { items: [{ path: 'type', operator: 'eq', value: 'live' }] } })).status === 200);
  check('G2 filter through a forbidden hop → 403', (await search(envOnly, 'infra.environments', { filter: { items: [{ path: 'server.serverName', operator: 'eq', value: 'x' }] } })).status === 403);
  check('G3 sort through a forbidden hop → 403', (await search(envOnly, 'infra.environments', { sort: [{ path: 'project.name' }] })).status === 403);
  check('G4 group through a forbidden hop → 403', (await search(envOnly, 'infra.environments', { groupBy: ['server.serverName'] })).status === 403);
  check('G5 any over a forbidden hop → 403', (await search(envOnly, 'infra.environments', { filter: { items: [{ any: 'server', items: [{ path: 'serverName', operator: 'eq', value: 'x' }] }] } })).status === 403);
  check('G6 forbidden root resource → 403', (await search(envOnly, 'infra.servers', {})).status === 403);
  check('G7 users root without core.users → 403', (await search(envOnly, 'core.users', {})).status === 403);
}

let exitCode = 0;
const A = await login(ADMIN.email, ADMIN.password);
try { await run(A); }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally {
  for (const id of made.envs) await req(A, 'DELETE', '/infra/environments/' + id);
  for (const id of made.projects) await req(A, 'DELETE', '/infra/projects/' + id);
  for (const id of made.servers) await req(A, 'DELETE', '/infra/servers/' + id);
  for (const id of made.users) await req(A, 'DELETE', '/users/' + id);
}
console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(exitCode || (fail > 0 ? 1 : 0));
