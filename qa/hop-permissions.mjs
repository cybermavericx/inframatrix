/**
 * Per-hop read permission on the field tree and exports — run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/hop-permissions.mjs
 *
 * Logs in as admin, creates limited "QA Test ..." users, asserts that a relation into a resource the
 * user can't read is hidden and that requesting it gives 403, then deletes those users. Made-up data only.
 */
import ExcelJS from 'exceljs';

const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const TEST = 'QA Test';
const PASSWORD = 'QaTest@12345';

let pass = 0, fail = 0;
const fails = [];
const madeUsers = [];

async function req(token, method, path, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null;
  try { data = JSON.parse(buf.toString()); } catch { data = buf; }
  return { status: r.status, data };
}
const get = (t, p) => req(t, 'GET', p);

function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; fails.push(label); console.log(`  ❌ ${label}${extra !== undefined ? '  — ' + JSON.stringify(extra) : ''}`); }
}

async function login(email, password) {
  const r = await req(null, 'POST', '/auth/login', { email, password });
  if (!r.data?.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.data.accessToken;
}

async function mkUser(admin, slug, moduleKeys, groupKeys) {
  const email = `qa_test_hop_${slug}@example.com`;
  const r = await req(admin, 'POST', '/users', { name: `${TEST} Hop ${slug}`, email, password: PASSWORD, moduleKeys, groupKeys });
  if (r.status >= 300) throw new Error(`mkUser ${slug}: ${r.status} ${JSON.stringify(r.data)}`);
  madeUsers.push(r.data.id);
  return login(email, PASSWORD);
}

const relKeys = (r) => (r.data?.relations ?? []).map((x) => x.key);

async function sheet(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const headers = [];
  wb.getWorksheet('data').getRow(1).eachCell((c) => headers.push(String(c.value)));
  const ref = [];
  wb.getWorksheet('Reference').eachRow((row) => ref.push(String(row.getCell(1).value ?? '')));
  return { headers, ref };
}

async function run(admin) {
  const envOnly = await mkUser(admin, 'env', ['infra'], ['infra.environments.viewer']);
  const envServers = await mkUser(admin, 'envsrv', ['infra'], ['infra.environments.viewer', 'infra.servers.viewer']);
  const serverOnly = await mkUser(admin, 'srv', ['infra'], ['infra.servers.viewer']);
  const projectOnly = await mkUser(admin, 'prj', ['infra'], ['infra.projects.viewer']);

  console.log('\n=== A. Field tree: forbidden hops are hidden ===');
  const f = await get(envOnly, '/data/infra.environments/fields');
  check('A1 env viewer can read own field tree', f.status === 200 && f.data.own.some((x) => x.name === 'url'), { status: f.status });
  check('A2 server, project, git provider, submitter relations hidden', relKeys(f).length === 0, relKeys(f));
  const f2 = await get(envServers, '/data/infra.environments/fields');
  check('A3 granting servers shows only the server relation', relKeys(f2).join() === 'server', relKeys(f2));
  const fa = await get(admin, '/data/infra.environments/fields');
  check('A4 admin still sees every relation', ['project', 'server', 'gitProvider', 'checklistSubmittedBy'].every((k) => relKeys(fa).includes(k)), relKeys(fa));
  check('A5 to-many hop hidden (server → environments)', !relKeys(await get(serverOnly, '/data/infra.servers/fields')).includes('environments'));
  const fp = await get(projectOnly, '/data/infra.projects/fields');
  check('A6 hop to users hidden without core.users', !relKeys(fp).includes('poc') && !relKeys(fp).includes('developers'), relKeys(fp));

  console.log('\n=== B. Field tree: requesting a forbidden hop gives 403 ===');
  check('B1 to-one hop → 403', (await get(envOnly, '/data/infra.environments/fields?path=server')).status === 403);
  check('B2 to-many hop → 403', (await get(serverOnly, '/data/infra.servers/fields?path=environments')).status === 403);
  check('B3 hop to users → 403', (await get(projectOnly, '/data/infra.projects/fields?path=poc')).status === 403);
  check('B4 second hop forbidden → 403', (await get(envServers, '/data/infra.environments/fields?path=server.environments')).status === 200
    && (await get(envOnly, '/data/infra.environments/fields?path=server.environments')).status === 403);
  check('B5 allowed hop → 200', (await get(envServers, '/data/infra.environments/fields?path=server')).status === 200);
  check('B6 admin hop → 200', (await get(admin, '/data/infra.projects/fields?path=environments.server')).status === 200);
  check('B7 RBAC tables stay reachable for a core.users reader', (await get(admin, '/data/core.users/fields?path=groups')).status === 200);
  check('B8 unknown relation still 400', (await get(envOnly, '/data/infra.environments/fields?path=nosuchrelation')).status === 400);
  check('B9 forbidden root still 403', (await get(envOnly, '/data/infra.servers/fields')).status === 403);

  console.log('\n=== C. Custom export paths ===');
  const exp = (t, res, fields) => get(t, `/data/${res}/export?fields=${encodeURIComponent(fields)}`);
  check('C1 own field export → 200', (await exp(envOnly, 'infra.environments', 'url,type')).status === 200);
  check('C2 forbidden to-one path → 403', (await exp(envOnly, 'infra.environments', 'server.serverName')).status === 403);
  check('C3 one forbidden path among valid ones → 403, nothing partial', (await exp(envOnly, 'infra.environments', 'url,server.publicIp')).status === 403);
  check('C4 forbidden to-many path → 403', (await exp(serverOnly, 'infra.servers', 'environments.url')).status === 403);
  check('C5 forbidden hop to users → 403', (await exp(projectOnly, 'infra.projects', 'poc.email')).status === 403);
  check('C6 forbidden deep path → 403', (await exp(envServers, 'infra.environments', 'project.poc.email')).status === 403);
  check('C7 allowed path → 200', (await exp(envServers, 'infra.environments', 'url,server.serverName')).status === 200);
  check('C8 admin deep path → 200', (await exp(admin, 'infra.projects', 'name,environments.server.serverName')).status === 200);
  check('C9 password still never exportable', (await exp(admin, 'core.users', 'password')).status === 400);

  console.log('\n=== D. Default export + Reference sheet ===');
  const d = await get(envOnly, '/data/infra.environments/export');
  check('D1 limited default export → 200', d.status === 200, { status: d.status });
  const ds = await sheet(d.data);
  check('D2 forbidden name columns absent', !['server', 'project', 'gitProvider', 'checklistSubmittedBy'].some((h) => ds.headers.includes(h)), ds.headers);
  check('D3 raw foreign keys not shown instead', !['serverId', 'projectId', 'gitProviderId', 'checklistSubmittedById'].some((h) => ds.headers.includes(h)), ds.headers);
  check('D4 own columns kept', ds.headers.includes('url') && ds.headers.includes('type'), ds.headers);
  check('D5 Reference sheet lists no forbidden records', !ds.ref.some((l) => l.includes('use one of these names:')), ds.ref.filter((l) => l.includes('→')));
  const da = await sheet((await get(admin, '/data/infra.environments/export')).data);
  check('D6 admin default export keeps every name column', ['server', 'project', 'gitProvider', 'checklistSubmittedBy'].every((h) => da.headers.includes(h)), da.headers);
  check('D7 admin Reference sheet keeps relation lists', da.ref.some((l) => l.startsWith('server') && l.includes('use one of these names:')));
  const de = await sheet((await get(envServers, '/data/infra.environments/export')).data);
  check('D8 granted relation keeps its column, others stay hidden', de.headers.includes('server') && !de.headers.includes('project'), de.headers);

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
}

let exitCode = 0;
const admin = await login(ADMIN.email, ADMIN.password);
try { await run(admin); if (fail > 0) exitCode = 1; }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally { for (const id of madeUsers) await req(admin, 'DELETE', '/users/' + id); }
process.exit(exitCode);
