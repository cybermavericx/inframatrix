/**
 * Technology catalog (phase 3): fixed lists (off-list values saved and flagged), version fields, option status, version
 * operators, hasOutdatedTechnology — run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/catalog.mjs
 *
 * Creates a made-up "QA Test Cat ..." custom_fields type, servers, a project, environments and
 * integrations, checks the save rules, dual-write, the search operators (examples b, c, d, f),
 * validation and permissions, then deletes everything it created.
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const P = 'QA Test Cat';
const PASSWORD = 'QaTest@12345';
const QUOTE_KEY = `it's "q"; DROP TABLE x;--`;

let pass = 0, fail = 0;
const fails = [];
const made = { envs: [], projects: [], servers: [], types: [], users: [] };

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
  if (list) made[list].push(r.data.id);
  return r.data;
}

const field = (key, label, kind, possibleValues = []) => ({ key, label, kind, mode: 'possible', possibleValues, avoidableValues: [] });
const PHP = ['8.2.30', '8.3', '8.3.35', '8.3.36', '8.4.1', '8.4.9'];
const fieldsWith = (overrides = {}) => [
  field('php', 'PHP', 'version', overrides.php ?? PHP),
  field('wordpress', 'WordPress', 'version', ['6.4', '6.5']),
  field('nodejs', 'Node.js', 'version'),
  field('edition', 'Edition', 'text', overrides.edition ?? []),
  field(QUOTE_KEY, 'Quote key', 'text'),
];

async function run(A) {
  // ---- fixtures ----
  const T = await mk(A, 'types', '/infra/integration-types', { name: `${P} Tech`, behavior: 'custom_fields', isActive: true, fields: fieldsWith() });
  const cf = (key) => `cf:${T.id}:${key}`;
  const sX = await mk(A, 'servers', '/infra/servers', { serverName: `${P} X`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const sY = await mk(A, 'servers', '/infra/servers', { serverName: `${P} Y`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const pr = await mk(A, 'projects', '/infra/projects', { name: `${P} Project`, status: 'active' });
  const env = (serverId, type = 'live') => mk(A, 'envs', '/infra/environments', { projectId: pr.id, type, serverId });
  const tech = (environmentId, fieldValues) => mk(A, null, '/infra/integrations', { environmentId, integrationTypeId: T.id, fieldValues });
  const e1 = await env(sX.id); const i1 = await tech(e1.id, { php: '8.3.35', wordpress: '6.5', edition: 'Legacy', [QUOTE_KEY]: `it's "v"` });
  const e2 = await env(sX.id, 'staging'); const i2 = await tech(e2.id, { php: '8.3.36', wordpress: '6.4' });
  const e3 = await env(sY.id); await tech(e3.id, { php: '8.3.35' });
  const e4 = await env(sY.id, 'staging'); await tech(e4.id, { php: '8.4.1', wordpress: '6.4' }); // new PHP + old WP
  const e5 = await env(sX.id, 'uat'); await tech(e5.id, { php: '8.3', wordpress: '6.5' }); // line-level PHP
  const e6 = await env(sX.id, 'uat'); // no technology at all
  const e7 = await env(sY.id, 'uat'); await tech(e7.id, { php: '8.2.30', wordpress: '6.5' }); // old PHP + new WP
  const inEnvs = { path: 'project.name', operator: 'eq', value: pr.name };
  const envQ = async (rules, extra = {}) => search(A, 'infra.environments', { filter: { items: [inEnvs, ...rules] }, ...extra });

  console.log('\n=== A. Save rules (lists flag, version kind, change-only) ===');
  const opts = async () => (await req(A, 'GET', `/infra/integration-types/${T.id}/options`)).data ?? [];
  const optOf = (list, key, value) => list.find((o) => o.fieldKey === key && o.value === value);
  const flagTotal = async () => (await req(A, 'GET', '/dashboard/stats')).data?.integrationFlags?.total;
  const projFlag = async () => ((await req(A, 'GET', '/infra/projects')).data ?? []).find((p) => p.id === pr.id)?.hasIntegrationFlags;
  const flags0 = await flagTotal();
  check('A0 fixtures start unflagged', (await projFlag()) === false);
  const off = await req(A, 'PATCH', `/infra/integrations/${i2.id}`, { fieldValues: { ...i2.fieldValues, php: '9.9.9' } });
  check('A1 out-of-list value is saved (200), not refused', off.status === 200 && off.data?.fieldValues?.php === '9.9.9', off.data);
  check('A1b …and flagged: dashboard "Flagged" +1, project hasIntegrationFlags', (await flagTotal()) === flags0 + 1 && (await projFlag()) === true);
  check('A1c back in the list → 200 and the flag clears', (await req(A, 'PATCH', `/infra/integrations/${i2.id}`, { fieldValues: { ...i2.fieldValues, php: '8.3.36' } })).status === 200 && (await flagTotal()) === flags0 && (await projFlag()) === false);
  check('A3 version field without a list rejects a non-version', (await req(A, 'PATCH', `/infra/integrations/${i1.id}`, { fieldValues: { ...i1.fieldValues, nodejs: 'latest' } })).status === 400);
  check('A4 version field without a list accepts 20.11', (await req(A, 'PATCH', `/infra/integrations/${i1.id}`, { fieldValues: { ...i1.fieldValues, nodejs: '20.11' } })).status === 200);
  // give Edition a fixed list AFTER e1 stored "Legacy": the old value stays, a changed one is checked
  check('A5 adding a fixed list over existing data → 200', (await req(A, 'PATCH', `/infra/integration-types/${T.id}`, { fields: fieldsWith({ edition: ['Pro', 'Basic'] }) })).status === 200);
  const keepOld = await req(A, 'PATCH', `/infra/integrations/${i1.id}`, { fieldValues: { ...i1.fieldValues, nodejs: '20.11', php: '8.3.35' } });
  check('A6 unchanged out-of-list value still saves', keepOld.status === 200, keepOld.data);
  check('A6b …and is flagged', (await flagTotal()) === flags0 + 1 && (await projFlag()) === true);
  const other = await req(A, 'PATCH', `/infra/integrations/${i1.id}`, { fieldValues: { ...i1.fieldValues, nodejs: '20.11', edition: 'Other' } });
  check('A7 changing it to another out-of-list value → 200 (flagged, not refused)', other.status === 200 && other.data?.fieldValues?.edition === 'Other', other.data);
  check('A7b …restore "Legacy" → 200', (await req(A, 'PATCH', `/infra/integrations/${i1.id}`, { fieldValues: { ...i1.fieldValues, nodejs: '20.11', edition: 'Legacy' } })).status === 200);
  check('A2 list match is case-insensitive ("pro" for "Pro")', (await req(A, 'PATCH', `/infra/integrations/${i2.id}`, { fieldValues: { ...i2.fieldValues, edition: 'pro' } })).status === 200);
  const got = await req(A, 'GET', `/infra/integrations/${i1.id}`);
  check('A8 dual-write: JSON holds exactly what was saved', got.data?.fieldValues?.edition === 'Legacy' && got.data?.fieldValues?.nodejs === '20.11' && got.data?.fieldValues?.[QUOTE_KEY] === `it's "v"`, got.data?.fieldValues);
  let o = await opts();
  check('A9 options mirrored with usage counts (8.3.35 used by 2)', optOf(o, 'php', '8.3.35')?.usage === 2 && optOf(o, 'php', '8.4.9')?.usage === 0, o.filter((x) => x.fieldKey === 'php'));
  const inUse = await req(A, 'PATCH', `/infra/integration-types/${T.id}`, { fields: fieldsWith({ edition: ['Pro', 'Basic'], php: PHP.filter((v) => v !== '8.3.35') }) });
  check('A10 removing an option in use → 409', inUse.status === 409, inUse.data);
  check('A11 …and nothing changed', !!optOf(await opts(), 'php', '8.3.35') && (await req(A, 'GET', `/infra/integration-types/${T.id}`)).data?.fields?.[0]?.possibleValues?.includes('8.3.35'));
  check('A12 removing an unused option → 200', (await req(A, 'PATCH', `/infra/integration-types/${T.id}`, { fields: fieldsWith({ edition: ['Pro', 'Basic'], php: PHP.filter((v) => v !== '8.4.9') }) })).status === 200);
  check('A13 …and it is gone', !optOf(await opts(), 'php', '8.4.9'));
  check('A14 bad kind → 400', (await req(A, 'PATCH', `/infra/integration-types/${T.id}`, { fields: [{ ...field('php', 'PHP', 'semver'), possibleValues: PHP }] })).status === 400);
  o = await opts();
  const setStatus = (key, value, status) => req(A, 'PATCH', `/infra/integration-types/${T.id}/options/${optOf(o, key, value).id}`, { status });
  check('A15 invalid status → 400', (await setStatus('php', '8.3.35', 'old')).status === 400);
  check('A16 set statuses → 200', [(await setStatus('php', '8.2.30', 'eol')).status, (await setStatus('php', '8.3.35', 'outdated')).status, (await setStatus('wordpress', '6.4', 'outdated')).status].every((s) => s === 200));
  const list = (await req(A, 'GET', '/infra/integrations')).data ?? [];
  const row1 = list.find((r) => r.id === i1.id);
  check('A17 list rows carry fieldStatus (outdated, exact)', row1?.fieldStatus?.php?.status === 'outdated' && row1?.fieldStatus?.php?.level === 'exact', row1?.fieldStatus);
  const row5 = list.find((r) => r.environmentId === e5.id);
  check('A18 a bare 8.3 is stored as line level', row5?.fieldStatus?.php?.level === 'line', row5?.fieldStatus);

  console.log('\n=== B. Version operators (example b + line-level semantics) ===');
  const v = async (operator, value) => ids(await envQ([{ path: cf('php'), operator, value }]));
  check('B1 example b: PHP = 8.4.x', same(await v('v_line', '8.4.x'), [e4.id]), await v('v_line', '8.4.x'));
  check('B2 v_line 8.3 → the line and everything in it', same(await v('v_line', '8.3'), [e1.id, e2.id, e3.id, e5.id]));
  check('B3 v_eq 8.3 → only the bare line (8.3 ≠ 8.3.0)', same(await v('v_eq', '8.3'), [e5.id]));
  check('B4 v_eq 8.3.35', same(await v('v_eq', '8.3.35'), [e1.id, e3.id]));
  check('B5 v_lt 8.3.36 → older + line-level 8.3 ("might be older")', same(await v('v_lt', '8.3.36'), [e1.id, e3.id, e5.id, e7.id]), await v('v_lt', '8.3.36'));
  check('B6 v_gt 8.3.35 → newer + line-level 8.3', same(await v('v_gt', '8.3.35'), [e2.id, e4.id, e5.id]), await v('v_gt', '8.3.35'));
  check('B7 v_lt 8.3 (a line) → older than the whole line', same(await v('v_lt', '8.3'), [e7.id]));
  check('B8 v_gt 8.3 (a line) → newer than the whole line', same(await v('v_gt', '8.3'), [e4.id]));
  check('B9 v_lte 8.3 → older + the whole line', same(await v('v_lte', '8.3'), [e1.id, e2.id, e3.id, e5.id, e7.id]));
  check('B10 v_gte 8.4', same(await v('v_gte', '8.4'), [e4.id]));
  check('B11 eq on the text value', same(await v('eq', '8.3.36'), [e2.id]));
  check('B12 neq keeps environments without the field', same(await v('neq', '8.3.35'), [e2.id, e4.id, e5.id, e6.id, e7.id]));
  check('B13 isNull = no PHP value', same(await v('isNull'), [e6.id]));
  check('B14 status [eol]', same(await v('status', ['eol']), [e7.id]));
  check('B15 key with quotes/SQL characters matched literally', same(ids(await envQ([{ path: cf(QUOTE_KEY), operator: 'eq', value: `it's "v"` }])), [e1.id]));

  console.log('\n=== C. Examples c + d ===');
  const c = await envQ([{ path: 'server.serverName', operator: 'eq', value: sX.serverName }, { path: cf('php'), operator: 'v_eq', value: '8.3.35' }]);
  check('C1 example c selection: Server = X AND PHP = 8.3.35 (mass-set itself is phase 4)', same(ids(c), [e1.id]), ids(c));
  const d = await envQ([{ path: cf('php'), operator: 'v_lt', value: '8.3.36' }], { groupBy: ['server.serverName', cf('php')] });
  const g = Object.fromEntries((d.data?.groups ?? []).map((n) => [n.value, Object.fromEntries((n.children ?? []).map((ch) => [ch.value, ch.count]))]));
  check('C2 example d: PHP < 8.3.36 grouped Server → PHP', d.status === 200
    && JSON.stringify(g[sX.serverName]) === JSON.stringify({ '8.3': 1, '8.3.35': 1 }) && JSON.stringify(g[sY.serverName]) === JSON.stringify({ '8.2.30': 1, '8.3.35': 1 }), g);
  const sorted = await envQ([{ path: cf('php'), operator: 'notNull' }], { sort: [{ path: cf('php'), dir: 'asc' }] });
  check('C3 sort by version is numeric (8.2.30 < 8.3 < 8.3.35 < 8.3.36 < 8.4.1)', JSON.stringify((sorted.data?.rows ?? []).map((r) => r.id).filter((id) => id !== e3.id))
    === JSON.stringify([e7.id, e5.id, e1.id, e2.id, e4.id]), (sorted.data?.rows ?? []).map((r) => r.id));

  console.log('\n=== D. Example f — hasOutdatedTechnology, grouped by status ===');
  const out = async (value) => ids(await envQ([{ path: 'computed:hasOutdatedTechnology', operator: 'eq', value }]));
  check('D1 outdated = true', same(await out(true), [e1.id, e2.id, e3.id, e4.id, e7.id]), await out(true));
  check('D2 outdated = false', same(await out(false), [e5.id, e6.id]), await out(false));
  const f = await envQ([{ path: 'computed:hasOutdatedTechnology', operator: 'eq', value: true }], { groupBy: [`cfstatus:${T.id}:php`, `cfstatus:${T.id}:wordpress`] });
  const fg = Object.fromEntries((f.data?.groups ?? []).map((n) => [String(n.value), Object.fromEntries((n.children ?? []).map((ch) => [String(ch.value), ch.count]))]));
  check('D3 new-PHP + old-WP and old-PHP + new-WP both appear', fg.current?.outdated === 2 && fg.eol?.current === 1, fg);
  await setStatus('wordpress', '6.5', 'outdated');
  check('D4 marking an option outdated changes results with no site edited', same(await out(true), [e1.id, e2.id, e3.id, e4.id, e5.id, e7.id]));
  await setStatus('wordpress', '6.5', 'current');
  check('D5 …and back', same(await out(false), [e5.id, e6.id]));
  const pq = await search(A, 'infra.projects', { filter: { items: [{ path: 'name', operator: 'eq', value: pr.name }, { any: 'environments', items: [{ path: 'computed:hasOutdatedTechnology', operator: 'eq', value: true }, { path: 'type', operator: 'eq', value: 'uat' }] }] } });
  check('D6 projects: ANY environment (uat AND outdated) — same child', same(ids(pq), [pr.id]), pq.data);
  const flag = await envQ([{ path: 'computed:hasOutdatedTechnology', operator: 'eq', value: true }], { groupBy: ['computed:hasOutdatedTechnology'] });
  check('D7 group by the computed flag', flag.data?.groups?.length === 1 && flag.data.groups[0].count === 5, flag.data?.groups);

  console.log('\n=== E. Validation ===');
  const st = async (res, body) => (await search(A, res, body)).status;
  const rule = (path, operator, value) => ({ filter: { items: [{ path, operator, value }] } });
  check('E1 unknown custom field key → 400', await st('infra.environments', rule(cf('nope'), 'eq', 'x')) === 400);
  check('E2 key matched exactly (case) → 400', await st('infra.environments', rule(cf('PHP'), 'eq', 'x')) === 400);
  check('E3 unknown type → 400', await st('infra.environments', rule('cf:999999999:php', 'eq', 'x')) === 400);
  check('E4 custom field on a non-environment root → 400', await st('infra.servers', rule(cf('php'), 'eq', 'x')) === 400);
  check('E5 version operator on a text field → 400', await st('infra.environments', rule(cf('edition'), 'v_lt', '1')) === 400);
  check('E6 version operand that is not a version → 400', await st('infra.environments', rule(cf('php'), 'v_lt', 'abc')) === 400);
  check('E7 cfstatus in a rule → 400', await st('infra.environments', rule(`cfstatus:${T.id}:php`, 'eq', 'eol')) === 400);
  check('E8 unknown computed field → 400', await st('infra.environments', rule('computed:nope', 'eq', true)) === 400);
  check('E9 version operator on a plain column → 400', await st('infra.environments', rule('type', 'v_lt', '1')) === 400);
  check('E10 bad status value → 400', await st('infra.environments', rule(cf('php'), 'status', ['old'])) === 400);
  check('E11 malformed cf path → 400', await st('infra.environments', rule('cf:abc:php', 'eq', 'x')) === 400);

  console.log('\n=== F. Permissions ===');
  const ue = await mk(A, 'users', '/users', { name: `${P} EnvOnly`, email: 'qa_test_cat_env@example.com', password: PASSWORD, moduleKeys: ['infra'], groupKeys: ['infra.environments.viewer'] });
  const envOnly = await login(ue.email, PASSWORD);
  check('F1 without integrations read: custom field rule → 403', (await search(envOnly, 'infra.environments', rule(cf('php'), 'eq', 'x'))).status === 403);
  check('F2 …computed field → 403', (await search(envOnly, 'infra.environments', rule('computed:hasOutdatedTechnology', 'eq', true))).status === 403);
  check('F3 …group by custom field → 403', (await search(envOnly, 'infra.environments', { groupBy: [cf('php')] })).status === 403);
  check('F4 options endpoint needs integration-types read → 403', (await req(envOnly, 'GET', `/infra/integration-types/${T.id}/options`)).status === 403);
  check('F5 status change needs update → 403', (await req(envOnly, 'PATCH', `/infra/integration-types/${T.id}/options/${o[0].id}`, { status: 'eol' })).status === 403);

  console.log('\n=== G. Cleanup cascades ===');
  await req(A, 'DELETE', `/infra/environments/${e3.id}`);
  made.envs = made.envs.filter((id) => id !== e3.id);
  check('G1 deleting an environment removes its searchable values', same(await v('v_eq', '8.3.35'), [e1.id]));
  check('G2 usage count follows', optOf(await opts(), 'php', '8.3.35')?.usage === 1);
}

let exitCode = 0;
const A = await login(ADMIN.email, ADMIN.password);
try { await run(A); }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally {
  for (const id of made.envs) await req(A, 'DELETE', '/infra/environments/' + id); // cascades integrations + values
  for (const id of made.projects) await req(A, 'DELETE', '/infra/projects/' + id);
  for (const id of made.servers) await req(A, 'DELETE', '/infra/servers/' + id);
  for (const id of made.types) await req(A, 'DELETE', '/infra/integration-types/' + id); // cascades options
  for (const id of made.users) await req(A, 'DELETE', '/users/' + id);
}
console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(exitCode || (fail > 0 ? 1 : 0));
