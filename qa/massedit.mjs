/**
 * Phase 4: the list pages' Filter & group (search output "ids", /fields metadata) and Mass edit —
 * run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/massedit.mjs
 *
 * Creates made-up "QA Test Mass ..." servers, a project, environments, a custom_fields type with
 * integrations and two users, checks example c end to end (filter → mass-set a version), the refusals
 * (read-only / computed / JSON / unique / bad value), all-or-nothing (a failing record rolls back the
 * whole batch), permissions (no partial write), the Activity entry per record, injection strings
 * stored literally, then deletes everything it created.
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const P = 'QA Test Mass';
const PASSWORD = 'QaTest@12345';
const EVIL = `x'); DROP TABLE infra_environments;-- "%_`;

let pass = 0, fail = 0;
const fails = [];
const made = { envs: [], projects: [], servers: [], types: [], users: [] };

async function req(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { status: r.status, data };
}
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; fails.push(label); console.log(`  ❌ ${label}${extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 400) : ''}`); }
}
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

async function run(A) {
  const T = await mk(A, 'types', '/infra/integration-types', { name: `${P} Tech`, behavior: 'custom_fields', isActive: true,
    fields: [field('php', 'PHP', 'version', ['8.3.35', '8.3.36', '8.4.9']), field('note', 'Note', 'text')] });
  const sX = await mk(A, 'servers', '/infra/servers', { serverName: `${P} X`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const sY = await mk(A, 'servers', '/infra/servers', { serverName: `${P} Y`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const pr = await mk(A, 'projects', '/infra/projects', { name: `${P} Project`, status: 'active', amcFrom: '2026-01-01', amcTo: '2026-12-31' });
  const pr2 = await mk(A, 'projects', '/infra/projects', { name: `${P} Project 2`, status: 'active', amcFrom: '2026-06-01', amcTo: '2026-12-31' });
  const env = (serverId, type, cicdStatus = 'manual') => mk(A, 'envs', '/infra/environments', { projectId: pr.id, type, serverId, cicdStatus });
  const tech = (environmentId, fieldValues) => mk(A, null, '/infra/integrations', { environmentId, integrationTypeId: T.id, fieldValues });
  const e1 = await env(sX.id, 'live'); const i1 = await tech(e1.id, { php: '8.3.35', note: 'keep me' });
  const e2 = await env(sX.id, 'staging'); const i2 = await tech(e2.id, { php: '8.3.35' });
  const e3 = await env(sY.id, 'live'); await tech(e3.id, { php: '8.3.35' });           // other server
  const e4 = await env(sX.id, 'uat'); await tech(e4.id, { php: '8.4.9' });             // other PHP
  const e5 = await env(sX.id, 'uat');                                                 // no technology
  const cf = `cf:${T.id}:php`;
  const inProj = { path: 'project.name', operator: 'eq', value: pr.name };
  const ids = async (body) => (await req(A, 'POST', '/data/infra.environments/search', { output: 'ids', ...body })).data;
  const mass = (t, resource, body) => req(t, 'POST', `/data/${resource}/mass-edit`, body);
  const envRow = async (id) => (await req(A, 'GET', `/infra/environments/${id}`)).data;
  const intRow = async (id) => (await req(A, 'GET', `/infra/integrations/${id}`)).data;

  console.log('\n=== A. List search output "ids" + /fields metadata ===');
  const all = await ids({ filter: { items: [inProj] } });
  check('A1 ids output lists exactly the matching records', same(all.ids, [e1.id, e2.id, e3.id, e4.id, e5.id]) && all.total === 5 && all.capped === false, all);
  const grouped = await ids({ filter: { items: [inProj] }, groupBy: ['server.serverName', cf] });
  const keyOf = (id) => grouped.keys[grouped.ids.indexOf(id)];
  check('A2 each id carries its group keys (Server › PHP)', JSON.stringify(keyOf(e1.id)) === JSON.stringify([sX.serverName, '8.3.35']) && JSON.stringify(keyOf(e5.id)) === JSON.stringify([sX.serverName, null]), grouped);
  check('A3 output other than "ids" → 400', (await req(A, 'POST', '/data/infra.environments/search', { output: 'rows' })).status === 400);
  const meta = (await req(A, 'GET', '/data/infra.environments/fields')).data;
  const own = (n) => meta.own.find((f) => f.name === n);
  check('A4 /fields gives each field its kind and dropdown values', own('cicdStatus')?.kind === 'string' && own('cicdStatus')?.options?.includes('manual') && own('checklistCompleted')?.kind === 'boolean');
  check('A5 /fields offers the technology fields on environments', meta.special.some((s) => s.path === cf && s.kind === 'version' && s.options?.includes('8.3.36')) && meta.special.some((s) => s.path === 'computed:hasOutdatedTechnology'));
  check('A6 /fields says mass edit is available (admin)', meta.massEdit === true);
  check('A7 export picker shape unchanged (name + label still there)', meta.own.every((f) => typeof f.name === 'string' && typeof f.label === 'string') && Array.isArray(meta.relations));
  check('A8 a list without mass edit says so (notes)', (await req(A, 'GET', '/data/jobbag.notes/fields')).data?.massEdit === false);

  console.log('\n=== B. Example c: Server = X AND PHP = 8.3.35 → select all → mass-set 8.3.36 ===');
  const sel = await ids({ filter: { items: [inProj, { path: 'server.serverName', operator: 'eq', value: sX.serverName }, { path: cf, operator: 'v_eq', value: '8.3.35' }] } });
  check('B1 the filter selects exactly e1 and e2', same(sel.ids, [e1.id, e2.id]), sel);
  const dry = await mass(A, 'infra.environments', { ids: sel.ids, path: cf, value: '8.3.36', dryRun: true });
  check('B2 preview: 2 will change, nothing written', dry.status === 200 && dry.data.changing === 2 && dry.data.invalid.length === 0 && (await intRow(i1.id)).fieldValues.php === '8.3.35', dry.data);
  const real = await mass(A, 'infra.environments', { ids: sel.ids, path: cf, value: '8.3.36' });
  check('B3 apply → 200, 2 updated', real.status === 200 && real.data.updated === 2, real.data);
  const j1 = (await intRow(i1.id)).fieldValues;
  check('B4 the JSON holds the new value and keeps the other fields', j1.php === '8.3.36' && j1.note === 'keep me' && (await intRow(i2.id)).fieldValues.php === '8.3.36', j1);
  check('B5 the searchable rows follow (PHP = 8.3.36 → e1, e2)', same((await ids({ filter: { items: [inProj, { path: cf, operator: 'v_eq', value: '8.3.36' }] } })).ids, [e1.id, e2.id]));
  check('B6 nothing else changed (e3 and e4 keep their PHP)', same((await ids({ filter: { items: [inProj, { path: cf, operator: 'v_eq', value: '8.3.35' }] } })).ids, [e3.id]));
  const again = await mass(A, 'infra.environments', { ids: sel.ids, path: cf, value: '8.3.36', dryRun: true });
  check('B7 running it again: 0 change, 2 already have it', again.data.changing === 0 && again.data.unchanged === 2, again.data);
  const noTech = await mass(A, 'infra.environments', { ids: [e1.id, e5.id], path: cf, value: '8.3.35' });
  check('B8 an environment without that integration → 400, and e1 was not changed either', noTech.status === 400 && noTech.data.invalid?.some((x) => x.id === e5.id) && (await intRow(i1.id)).fieldValues.php === '8.3.36', noTech.data);
  const badVer = await mass(A, 'infra.environments', { ids: [e1.id], path: cf, value: 'latest', dryRun: true });
  check('B9 a non-version for a version field is reported, not written', badVer.status === 200 && badVer.data.invalid.length === 1, badVer.data);
  const offList = await mass(A, 'infra.environments', { ids: [e1.id], path: cf, value: '9.9.9', dryRun: true });
  check('B10 an off-list version is allowed (saved and flagged, like the form)', offList.data.changing === 1 && offList.data.invalid.length === 0, offList.data);

  console.log('\n=== C. Plain fields, Activity, injection ===');
  const cic = await mass(A, 'infra.environments', { ids: [e1.id, e2.id, e3.id], path: 'cicdStatus', value: 'auto' });
  check('C1 mass-set CI/CD → 200, 3 updated', cic.status === 200 && cic.data.updated === 3, cic.data);
  check('C2 the records hold it', (await Promise.all([e1, e2, e3].map((e) => envRow(e.id)))).every((r) => r.cicdStatus === 'auto'));
  const hist = (await req(A, 'GET', `/audit?entityType=environment&entityId=${e2.id}`)).data ?? [];
  check('C3 an Activity entry per record (CI/CD manual → auto)', hist.some((h) => h.field === 'cicdStatus' && /manual/i.test(h.oldValue ?? '') && /auto/i.test(h.newValue ?? '')), hist.slice(0, 3));
  const srv = await mass(A, 'infra.environments', { ids: [e4.id], path: 'serverId', value: sY.id });
  check('C4 a linked record (server) can be mass-set', srv.status === 200 && (await envRow(e4.id)).serverId === sY.id, srv.data);
  const ev = await mass(A, 'infra.environments', { ids: [e5.id], path: 'url', value: EVIL });
  check('C5 an injection string is stored literally', ev.status === 200 && (await envRow(e5.id)).url === EVIL.trim(), ev.data);
  check('C6 …and the table is still there', (await req(A, 'GET', '/infra/environments/' + e1.id)).status === 200);
  const clr = await mass(A, 'infra.environments', { ids: [e5.id], path: 'url', value: null });
  check('C7 null clears an optional field', clr.status === 200 && (await envRow(e5.id)).url == null, clr.data);

  console.log('\n=== D. Refusals (nothing written) ===');
  const refuse = async (label, resource, body, code = 400) => {
    const r = await mass(A, resource, { dryRun: true, ...body });
    check(label, r.status === code, { status: r.status, msg: r.data?.message });
  };
  await refuse('D1 id is read-only', 'infra.environments', { ids: [e1.id], path: 'id', value: 5 });
  await refuse('D2 createdAt is read-only', 'infra.environments', { ids: [e1.id], path: 'createdAt', value: '2026-01-01' });
  await refuse('D3 a computed field can\'t be mass-edited', 'infra.environments', { ids: [e1.id], path: 'computed:hasOutdatedTechnology', value: true });
  await refuse('D4 a JSON column can\'t be mass-edited', 'infra.integrations', { ids: [i1.id], path: 'fieldValues', value: '{}' });
  await refuse('D5 a related record\'s field can\'t (only the record\'s own)', 'infra.environments', { ids: [e1.id], path: 'server.serverName', value: 'x' });
  await refuse('D6 a value outside the dropdown list', 'infra.environments', { ids: [e1.id], path: 'cicdStatus', value: 'sometimes' });
  await refuse('D7 clearing a required field', 'infra.environments', { ids: [e1.id], path: 'type', value: '' });
  await refuse('D8 a linked record that doesn\'t exist', 'infra.environments', { ids: [e1.id], path: 'serverId', value: 999999999 });
  await refuse('D9 a unique field across several records', 'infra.servers', { ids: [sX.id, sY.id], path: 'serverName', value: `${P} Same` });
  await refuse('D10 users: email is not mass-editable', 'core.users', { ids: [1], path: 'email', value: 'a@example.com' });
  await refuse('D11 users: password is not mass-editable', 'core.users', { ids: [1], path: 'password', value: 'Xx123456!' });
  await refuse('D12 a list without mass edit (notes)', 'jobbag.notes', { ids: [1], path: 'body', value: 'x' });
  await refuse('D13 more than 500 records', 'infra.environments', { ids: Array.from({ length: 501 }, (_, i) => i + 1), path: 'cicdStatus', value: 'auto' });
  await refuse('D14 unknown key in the request', 'infra.environments', { ids: [e1.id], path: 'cicdStatus', value: 'auto', extra: 1 });
  await refuse('D15 a cf path on another resource', 'infra.projects', { ids: [pr.id], path: cf, value: '8.3.36' });
  const miss = await mass(A, 'infra.environments', { ids: [e1.id, 999999999], path: 'cicdStatus', value: 'disabled' });
  check('D16 a missing record → 400 and the other record is untouched', miss.status === 400 && miss.data.missing?.includes(999999999) && (await envRow(e1.id)).cicdStatus === 'auto', miss.data);

  console.log('\n=== E. All or nothing: a record failing its own update rules rolls the batch back ===');
  // AMC to before AMC from is refused by the project's update rules — only for pr2 (from 2026-06-01).
  const roll = await mass(A, 'infra.projects', { ids: [pr.id, pr2.id], path: 'amcTo', value: '2026-03-31' });
  check('E1 the batch is refused (400, names the record)', roll.status === 400 && String(roll.data?.message).includes(`#${pr2.id}`), roll.data);
  check('E2 …and the record that passed was rolled back', (await req(A, 'GET', `/infra/projects/${pr.id}`)).data?.amcTo === '2026-12-31');
  const ok = await mass(A, 'infra.projects', { ids: [pr.id, pr2.id], path: 'status', value: 'on_hold' });
  check('E3 a valid project batch goes through', ok.status === 200 && ok.data.updated === 2, ok.data);

  console.log('\n=== F. Permissions: no partial write ===');
  const uv = await mk(A, 'users', '/users', { name: `${P} Viewer`, email: 'qa_test_mass_viewer@example.com', password: PASSWORD, moduleKeys: ['infra'], groupKeys: ['infra.environments.viewer', 'infra.projects.viewer', 'infra.servers.viewer', 'infra.integrations.viewer', 'infra.integration-types.viewer'] });
  const ue = await mk(A, 'users', '/users', { name: `${P} EnvEditor`, email: 'qa_test_mass_enved@example.com', password: PASSWORD, moduleKeys: ['infra'], groupKeys: ['infra.environments.editor', 'infra.projects.viewer', 'infra.servers.viewer', 'infra.integrations.viewer', 'infra.integration-types.viewer'] });
  const V = await login('qa_test_mass_viewer@example.com', PASSWORD);
  const E = await login('qa_test_mass_enved@example.com', PASSWORD);
  check('F1 a viewer gets 403', (await mass(V, 'infra.environments', { ids: [e1.id], path: 'cicdStatus', value: 'disabled' })).status === 403);
  check('F2 /fields tells a viewer mass edit is off', (await req(V, 'GET', '/data/infra.environments/fields')).data?.massEdit === false);
  check('F3 an environment editor can mass-set an environment field', (await mass(E, 'infra.environments', { ids: [e1.id], path: 'cicdStatus', value: 'disabled' })).status === 200);
  const cfNo = await mass(E, 'infra.environments', { ids: [e1.id, e2.id], path: cf, value: '8.4.9' });
  check('F4 …but not a technology value without update on integrations (403)', cfNo.status === 403, cfNo.data);
  check('F5 …and nothing was written', (await intRow(i1.id)).fieldValues.php === '8.3.36' && (await intRow(i2.id)).fieldValues.php === '8.3.36');
  check('F6 without read on the resource → 403', (await mass(E, 'jobbag.clients', { ids: [1], path: 'status', value: 'active', dryRun: true })).status === 403);

  console.log('\n=== G. Users (status / two-factor required only) ===');
  const us = await mass(A, 'core.users', { ids: [uv.id, ue.id], path: 'status', value: 'N' });
  check('G1 mass-deactivate two users → 200', us.status === 200 && us.data.updated === 2, us.data);
  const list = (await req(A, 'GET', '/users')).data ?? [];
  check('G2 both are inactive', [uv.id, ue.id].every((id) => list.find((u) => u.id === id)?.status === 'N'));
  check('G3 a bad status value is refused', (await mass(A, 'core.users', { ids: [uv.id], path: 'status', value: 'maybe', dryRun: true })).status === 400);
  const uh = (await req(A, 'GET', `/audit?entityType=user&entityId=${uv.id}`)).data ?? [];
  check('G4 an Activity entry per user', uh.some((h) => h.field === 'status'), uh.slice(0, 3));
}

let exitCode = 0;
const A = await login(ADMIN.email, ADMIN.password);
try { await run(A); }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally {
  for (const id of made.envs) await req(A, 'DELETE', '/infra/environments/' + id); // cascades integrations + values
  for (const id of made.projects) await req(A, 'DELETE', '/infra/projects/' + id);
  for (const id of made.servers) await req(A, 'DELETE', '/infra/servers/' + id);
  for (const id of made.types) await req(A, 'DELETE', '/infra/integration-types/' + id);
  for (const id of made.users) await req(A, 'DELETE', '/users/' + id);
}
console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(exitCode || (fail > 0 ? 1 : 0));
