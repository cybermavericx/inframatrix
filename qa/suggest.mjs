/**
 * Value suggestions for the Filter & group panel (GET /data/:resource/values) — run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/suggest.mjs
 *
 * Logs in as admin, creates "QA Test Sug …" records (made-up data only), checks matching, ordering,
 * custom-field values and the same per-hop read rules as search, then deletes everything it made.
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const P = 'QA Test Sug';
const PASSWORD = 'QaTest@12345';

let pass = 0, fail = 0;
const fails = [];
const made = { types: [], servers: [], projects: [], envs: [], users: [] };

async function req(token, method, path, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, data };
}
function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; fails.push(label); console.log(`  ❌ ${label}${extra !== undefined ? '  — ' + JSON.stringify(extra) : ''}`); }
}
async function login(email, password) {
  const r = await req(null, 'POST', '/auth/login', { email, password });
  if (!r.data?.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.data.accessToken;
}
async function mk(t, list, path, body) {
  const r = await req(t, 'POST', path, body);
  if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.data)}`);
  if (list) made[list].push(r.data.id);
  return r.data;
}
async function mkUser(admin, slug, groupKeys) {
  const email = `qa_test_sug_${slug}@example.com`;
  const r = await req(admin, 'POST', '/users', { name: `${P} ${slug}`, email, password: PASSWORD, moduleKeys: ['infra'], groupKeys });
  if (r.status >= 300) throw new Error(`mkUser ${slug}: ${r.status} ${JSON.stringify(r.data)}`);
  made.users.push(r.data.id);
  return login(email, PASSWORD);
}
const vals = (t, resource, path, q) =>
  req(t, 'GET', `/data/${resource}/values?path=${encodeURIComponent(path)}${q === undefined ? '' : `&q=${encodeURIComponent(q)}`}`);

async function run(A) {
  // ---- fixtures (made-up) ----
  const T = await mk(A, 'types', '/infra/integration-types', {
    name: `${P} Tech`, behavior: 'custom_fields', isActive: true,
    fields: [{ key: 'php', label: 'PHP', kind: 'version', mode: 'possible', possibleValues: [], avoidableValues: [] }],
  });
  const pr = await mk(A, 'projects', '/infra/projects', { name: `${P} Project`, status: 'active' });
  const branches = ['qasug-staging', 'qasug-stage-2', 'qasug-main', 'qasug-hotfix-staging', 'qasug_50%_off', 'staging-qasug'];
  const envs = [];
  for (const [i, b] of branches.entries()) envs.push(await mk(A, 'envs', '/infra/environments', { projectId: pr.id, type: i ? 'uat' : 'staging', repoBranch: b, url: `https://${i}.qa-sug.test` }));
  await mk(A, null, '/infra/integrations', { environmentId: envs[0].id, integrationTypeId: T.id, fieldValues: { php: '8.3.36' } });
  await mk(A, null, '/infra/integrations', { environmentId: envs[1].id, integrationTypeId: T.id, fieldValues: { php: '8.4.1' } });
  const projectsOnly = await mkUser(A, 'prj', ['infra.projects.viewer']);
  const projectsEnvs = await mkUser(A, 'prjenv', ['infra.projects.viewer', 'infra.environments.viewer']);

  console.log('\n=== A. Matching ===');
  const a1 = await vals(A, 'infra.projects', 'environments.repoBranch', 'qasug-sta');
  check('A1 typing "qasug-sta" suggests the matching branches', a1.status === 200 && ['qasug-staging', 'qasug-stage-2'].every((v) => a1.data.values.includes(v)), a1.data);
  const a2 = (await vals(A, 'infra.projects', 'environments.repoBranch', 'staging')).data?.values ?? [];
  const starts = a2.map((v) => v.toLowerCase().startsWith('staging'));
  check('A2 values that START with the text come first', a2.includes('staging-qasug') && a2.includes('qasug-staging')
    && starts.lastIndexOf(true) < starts.indexOf(false), a2);
  check('A3 contains-match (not only prefix)', (await vals(A, 'infra.projects', 'environments.repoBranch', 'hotfix')).data?.values?.includes('qasug-hotfix-staging'));
  const a4 = await vals(A, 'infra.projects', 'environments.repoBranch', 'QASUG-MAIN');
  check('A4 case-insensitive', a4.data?.values?.includes('qasug-main'), a4.data);
  const a5 = await vals(A, 'infra.projects', 'environments.repoBranch');
  check('A5 empty text → a first page of values (≤ 20)', a5.status === 200 && a5.data.values.length > 0 && a5.data.values.length <= 20, a5.data);
  check('A6 distinct (no duplicates)', new Set(a5.data?.values).size === a5.data?.values?.length);
  check('A7 root field (no relation hop)', (await vals(A, 'infra.environments', 'repoBranch', 'qasug-main')).data?.values?.[0] === 'qasug-main');
  check('A8 "%" and "_" are literal', JSON.stringify((await vals(A, 'infra.projects', 'environments.repoBranch', '_50%')).data?.values) === '["qasug_50%_off"]');
  const inj = await vals(A, 'infra.projects', 'environments.repoBranch', "' OR '1'='1");
  check('A9 injection-shaped text → 200, no match', inj.status === 200 && inj.data.values.length === 0, inj);
  check('A10 non-text field (number) → empty, not an error', JSON.stringify((await vals(A, 'infra.environments', 'serverId', '1')).data) === '{"values":[]}');

  console.log('\n=== B. Custom fields (Technology) ===');
  const b1 = await vals(A, 'infra.environments', `cf:${T.id}:php`, '8.3');
  check('B1 cf value on environments', b1.status === 200 && b1.data.values.includes('8.3.36') && !b1.data.values.includes('8.4.1'), b1.data);
  check('B2 cf through a relation (projects → environments)', (await vals(A, 'infra.projects', `environments.cf:${T.id}:php`, '8.4')).data?.values?.includes('8.4.1'));
  check('B3 cf on a non-environment resource → 400', (await vals(A, 'infra.projects', `cf:${T.id}:php`, '8')).status === 400);
  check('B4 unknown cf key → 400', (await vals(A, 'infra.environments', `cf:${T.id}:nosuchkey`, '8')).status === 400);

  console.log('\n=== C. Permissions + validation (same rules as search) ===');
  check('C1 hop into environments without read → 403', (await vals(projectsOnly, 'infra.projects', 'environments.repoBranch', 'qa')).status === 403);
  check('C2 the same with read on environments → 200', (await vals(projectsEnvs, 'infra.projects', 'environments.repoBranch', 'qasug')).status === 200);
  check('C3 cf without read on integrations → 403', (await vals(projectsEnvs, 'infra.projects', `environments.cf:${T.id}:php`, '8')).status === 403);
  check('C4 root without read → 403', (await vals(projectsOnly, 'infra.servers', 'serverName', 'a')).status === 403);
  check('C5 password column refused', (await vals(A, 'core.users', 'password', '')).status === 400);
  check('C6 JSON column refused', (await vals(A, 'infra.integrations', 'fieldValues', '')).status === 400);
  check('C7 a relation instead of a field → 400', (await vals(A, 'infra.projects', 'environments', 'a')).status === 400);
  check('C8 unknown relation → 400', (await vals(A, 'infra.projects', 'nosuch.name', 'a')).status === 400);
  check('C9 path too deep → 400', (await vals(A, 'infra.projects', 'environments.project.environments.project.name', 'a')).status === 400);
  check('C10 text over 100 characters → 400', (await vals(A, 'infra.projects', 'name', 'x'.repeat(101))).status === 400);
  check('C11 missing path → 400', (await req(A, 'GET', '/data/infra.projects/values?q=a')).status === 400);
  check('C12 repeated q (?q=a&q=b) → 400', (await req(A, 'GET', '/data/infra.projects/values?path=name&q=a&q=b')).status === 400);
}

let exitCode = 0;
const A = await login(ADMIN.email, ADMIN.password);
try { await run(A); }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally {
  for (const id of made.envs) await req(A, 'DELETE', '/infra/environments/' + id); // cascades integrations + values
  for (const id of made.projects) await req(A, 'DELETE', '/infra/projects/' + id);
  for (const id of made.types) await req(A, 'DELETE', '/infra/integration-types/' + id);
  for (const id of made.users) await req(A, 'DELETE', '/users/' + id);
}
console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(exitCode || (fail > 0 ? 1 : 0));
