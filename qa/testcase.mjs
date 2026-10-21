/**
 * InfraMatrix QA test suite — run after every change.
 *   node qa/testcase.mjs
 *
 * It logs in as admin, creates clearly-named "QA Test ..." records, asserts the
 * publish-readiness rules and Excel export/import behaviour, then DELETES
 * everything it created (teardown by name prefix — runs even if asserts fail).
 *
 * Persistent "QA Sample ..." records (created by qa/seed-samples.mjs) are left
 * untouched. Requires the dev server running (npm run dev) and exceljs (installed).
 */
import ExcelJS from 'exceljs';

const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const TEST = 'QA Test'; // prefix for everything this suite creates/deletes

let TOKEN = '';
let pass = 0, fail = 0;
const fails = [];
const made = { integrations: [] }; // tracked ids that must be deleted before their env

const H = (extra = {}) => ({ Authorization: `Bearer ${TOKEN}`, ...extra });
async function jreq(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { status: r.status, data: d };
}
const get = (p) => jreq('GET', p);
const post = (p, b) => jreq('POST', p, b);
const del = (p) => jreq('DELETE', p);

function check(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; fails.push(label); console.log(`  ❌ ${label}${extra !== undefined ? '  — ' + JSON.stringify(extra) : ''}`); }
}

async function login() {
  const r = await post('/auth/login', ADMIN);
  TOKEN = r.data?.accessToken;
  if (!TOKEN) throw new Error('login failed: ' + JSON.stringify(r));
  return r.data.user;
}

// ---- builders (all names start with the TEST prefix) ----
async function mkServer() {
  const r = await post('/infra/servers', { serverName: `${TEST} Server`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  if (r.status >= 300) throw new Error('mkServer: ' + JSON.stringify(r)); return r.data.id;
}
async function mkGit() {
  const r = await post('/infra/git-providers', { name: `${TEST} Git Provider` });
  if (r.status >= 300) throw new Error('mkGit: ' + JSON.stringify(r)); return r.data.id;
}
async function mkIntType(behavior, suffix) {
  const r = await post('/infra/integration-types', { name: `${TEST} Integration Type ${suffix}`, behavior });
  if (r.status >= 300) throw new Error('mkIntType: ' + JSON.stringify(r)); return r.data.id;
}
async function mkProject(num, label, over = {}) {
  const r = await post('/infra/projects', { name: `${TEST} Project ${String(num).padStart(2, '0')} — ${label}`, status: 'active', ...over });
  if (r.status >= 300) throw new Error('mkProject: ' + JSON.stringify(r)); return r.data;
}
async function mkEnv(projectId, over = {}) {
  const r = await post('/infra/environments', { projectId, type: 'staging', ...over });
  if (r.status >= 300) throw new Error('mkEnv: ' + JSON.stringify(r)); return r.data;
}
async function mkIntegration(environmentId, over = {}) {
  const r = await post('/infra/integrations', { environmentId, ...over });
  if (r.status >= 300) throw new Error('mkIntegration: ' + JSON.stringify(r)); made.integrations.push(r.data.id); return r.data;
}
async function expectPublish(projectId, shouldSucceed, label) {
  const r = await post(`/infra/projects/${projectId}/publish`, {});
  const ok = r.status < 300;
  if (shouldSucceed) check(`${label} → PUBLISH ACCEPTED`, ok, ok ? undefined : r.data);
  // a rejection must be a 400 AND carry a non-empty reasons[] (not just any error)
  else check(`${label} → PUBLISH REJECTED`, !ok && r.status === 400 && Array.isArray(r.data?.reasons) && r.data.reasons.length > 0, r.data);
}
function headers(ws) { const h = {}; ws.getRow(1).eachCell((c, i) => { h[String(c.value).trim()] = i; }); return h; }
async function exportXlsx(p) {
  const r = await fetch(BASE + p, { headers: H() });
  if (r.status >= 300) throw new Error(`export ${p} -> ${r.status}`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return wb;
}
async function importXlsx(p, wb) {
  const fd = new FormData(); fd.append('file', new Blob([Buffer.from(await wb.xlsx.writeBuffer())]), 'u.xlsx');
  const r = await fetch(BASE + p, { method: 'POST', headers: H(), body: fd });
  return { status: r.status, data: await r.json() };
}

// Generic CRUD smoke: create → get → list → update → export+reimport(idempotent) → delete.
async function crudSmoke({ ep, data, create, patch, tag }) {
  const t = tag || ep;
  const c = await post(ep, create);
  check(`${t}: create`, c.status < 300 && c.data?.id, { status: c.status, data: c.data });
  if (c.status >= 300 || !c.data?.id) return;
  const id = c.data.id;
  const g = await get(`${ep}/${id}`);
  check(`${t}: get by id`, g.status < 300 && g.data?.id === id);
  const l = await get(ep);
  check(`${t}: list includes it`, Array.isArray(l.data) && l.data.some((r) => r.id === id));
  if (patch) {
    const k = Object.keys(patch)[0];
    const u = await jreq('PATCH', `${ep}/${id}`, patch);
    check(`${t}: update`, u.status < 300 && String(u.data?.[k]) === String(patch[k]), { got: u.data?.[k], want: patch[k] });
  }
  if (data) {
    const wb = await exportXlsx(`/data/${data}/export`);
    const before = (await get(ep)).data.length;
    const imp = await importXlsx(`/data/${data}/import`, wb);
    const after = (await get(ep)).data.length;
    check(`${t}: export+reimport idempotent`, imp.status < 300 && after === before, { before, after, created: imp.data?.created });
  }
  const d = await del(`${ep}/${id}`);
  check(`${t}: delete`, d.status < 300);
  check(`${t}: gone after delete`, ((await get(`${ep}/${id}`)).data ?? null) === null);
}

async function teardown() {
  console.log('\n--- teardown (deleting QA Test records) ---');
  for (const id of made.integrations) await del('/infra/integrations/' + id);
  const projects = await get('/infra/projects');
  for (const p of (projects.data || []).filter((x) => String(x.name).startsWith(TEST))) await del('/infra/projects/' + p.id);
  const its = await get('/infra/integration-types');
  for (const it of (its.data || []).filter((x) => String(x.name).startsWith(TEST))) await del('/infra/integration-types/' + it.id);
  // sweep every resource for leftover "QA Test ..." rows (by whatever name-ish field they have)
  const nameFields = ['name', 'serverName', 'vendorName', 'serviceName', 'accountName', 'title', 'content'];
  for (const ep of ['/jobbag/vendor-services', '/jobbag/clients', '/jobbag/vendors', '/jobbag/jobs', '/jobbag/reminders', '/infra/accounts', '/users']) {
    for (const r of ((await get(ep)).data || [])) {
      if (nameFields.some((f) => String(r[f] ?? '').startsWith(TEST))) await del(`${ep}/${r.id}`);
    }
  }
  for (const iv of ((await get('/invites')).data || [])) if (String(iv.email ?? '').startsWith('qa_test_invite')) await del('/invites/' + iv.id);
  const gits = await get('/infra/git-providers');
  for (const g of (gits.data || []).filter((x) => String(x.name).startsWith(TEST))) await del('/infra/git-providers/' + g.id);
  const servers = await get('/infra/servers');
  for (const s of (servers.data || []).filter((x) => String(x.serverName).startsWith(TEST))) await del('/infra/servers/' + s.id);
  // orphan envs (project already gone)
  const live = new Set((await get('/infra/projects')).data.map((p) => p.id));
  for (const e of (await get('/infra/environments')).data) if (!live.has(e.projectId) && e.projectId) await del('/infra/environments/' + e.id);
  console.log('--- teardown done ---');
}

async function run() {
  const admin = await login();
  await teardown(); // pre-clean any leftovers from a previously-interrupted run
  const POC = admin.id;        // admin is always present
  const SRV = await mkServer();
  const GIT = await mkGit();
  const FULL = (over = {}) => ({ type: 'staging', url: 'https://qa.test', serverId: SRV, gitProviderId: GIT, repoUrl: 'https://git/qa', repoBranch: 'main', cicdConfigured: true, ...over });

  console.log('\n=== A. Project-only / no-POC (publish must reject) ===');
  await expectPublish((await mkProject(1, 'no POC, no env', { pocUserId: null })).id, false, 'A1 no POC, no env');
  await expectPublish((await mkProject(2, 'POC, no env', { pocUserId: POC })).id, false, 'A2 POC, no env');

  console.log('\n=== B. Required env fields + CI/CD ===');
  const b1 = await mkProject(3, 'env missing fields', { pocUserId: POC }); await mkEnv(b1.id, { type: 'staging' });
  await expectPublish(b1.id, false, 'B1 env missing required fields');
  const b2 = await mkProject(4, 'full env CI/CD on', { pocUserId: POC }); await mkEnv(b2.id, FULL());
  await expectPublish(b2.id, true, 'B2 full env, CI/CD on');
  const b3 = await mkProject(5, 'CI/CD off no reason', { pocUserId: POC }); await mkEnv(b3.id, FULL({ cicdConfigured: false }));
  await expectPublish(b3.id, false, 'B3 CI/CD off, no reason');
  const b4 = await mkProject(6, 'CI/CD off with reason', { pocUserId: POC }); await mkEnv(b4.id, FULL({ cicdConfigured: false, cicdNotConfiguredReason: 'pipeline pending' }));
  await expectPublish(b4.id, true, 'B4 CI/CD off, with reason');
  const b5 = await mkProject(7, 'one complete + one incomplete env', { pocUserId: POC });
  await mkEnv(b5.id, FULL()); await mkEnv(b5.id, { type: 'uat' }); // 2nd env incomplete
  await expectPublish(b5.id, false, 'B5 multi-env: one incomplete env blocks publish');

  console.log('\n=== C. Live env go-live checklist ===');
  const c1 = await mkProject(7, 'live checklist done missing docs', { pocUserId: POC }); await mkEnv(c1.id, FULL({ type: 'live', checklistCompleted: true }));
  await expectPublish(c1.id, false, 'C1 live, completed, missing docs');
  const c2 = await mkProject(8, 'live checklist done all docs', { pocUserId: POC }); await mkEnv(c2.id, FULL({ type: 'live', checklistCompleted: true, checklistAttachment: '/uploads/x.pdf', checklistSubmittedById: POC, checklistSubmittedDate: '2026-05-01', checklistSubmittedVersion: 'v1' }));
  await expectPublish(c2.id, true, 'C2 live, completed, all docs');
  const c3 = await mkProject(9, 'live checklist not done no reason', { pocUserId: POC }); await mkEnv(c3.id, FULL({ type: 'live', checklistCompleted: false }));
  await expectPublish(c3.id, false, 'C3 live, not completed, no reason');
  const c4 = await mkProject(10, 'live checklist not done with reason', { pocUserId: POC }); await mkEnv(c4.id, FULL({ type: 'live', checklistCompleted: false, checklistNotCompletedReason: 'go-live later' }));
  await expectPublish(c4.id, true, 'C4 live, not completed, with reason');

  console.log('\n=== CA. AMC active requires from/to dates ===');
  const ca1 = await mkProject(20, 'AMC active no dates', { pocUserId: POC, amcStatus: 'active' }); await mkEnv(ca1.id, FULL());
  await expectPublish(ca1.id, false, 'CA1 AMC active, no from/to');
  const ca2 = await mkProject(21, 'AMC active with dates', { pocUserId: POC, amcStatus: 'active', amcFrom: '2026-01-01', amcTo: '2026-12-31' }); await mkEnv(ca2.id, FULL());
  await expectPublish(ca2.id, true, 'CA2 AMC active, with from/to');

  console.log('\n=== DR. Date ranges — API rejects "to" earlier than "from" ===');
  const drP1 = await post('/infra/projects', { name: `${TEST} Project 30 — AMC inverted`, status: 'active', pocUserId: POC, amcStatus: 'active', amcFrom: '2026-12-31', amcTo: '2026-01-01' });
  check('DR1 project create, amcTo < amcFrom → rejected', drP1.status === 400, { status: drP1.status });
  const drP2 = await post('/infra/projects', { name: `${TEST} Project 31 — AMC valid`, status: 'active', pocUserId: POC, amcStatus: 'active', amcFrom: '2026-01-01', amcTo: '2026-12-31' });
  check('DR2 project create, valid AMC dates → accepted', drP2.status < 300, { status: drP2.status });
  if (drP2.data?.id) {
    const upd = await jreq('PATCH', `/infra/projects/${drP2.data.id}`, { amcTo: '2025-01-01' });
    check('DR3 project PATCH amcTo earlier than stored amcFrom → rejected (merge check)', upd.status === 400, { status: upd.status });
  }
  const drV1 = await post('/jobbag/vendor-services', { vendorName: `${TEST} Vendor`, serviceName: `${TEST} Service inverted`, startDate: '2026-12-31', expiryDate: '2026-01-01' });
  check('DR4 vendor-service create, expiryDate < startDate → rejected', drV1.status === 400, { status: drV1.status });
  const drV2 = await post('/jobbag/vendor-services', { vendorName: `${TEST} Vendor`, serviceName: `${TEST} Service valid`, startDate: '2026-01-01', expiryDate: '2026-12-31' });
  check('DR5 vendor-service create, valid dates → accepted', drV2.status < 300, { status: drV2.status });

  console.log('\n=== CB. Checklist completed on NON-live env still needs all details ===');
  const cb1 = await mkProject(23, 'staging checklist done missing submitter/date', { pocUserId: POC });
  await mkEnv(cb1.id, FULL({ type: 'staging', checklistCompleted: true, checklistAttachment: '/uploads/x.pdf' }));
  await expectPublish(cb1.id, false, 'CB1 staging checklist completed, no submitter/date/version');
  const cb2 = await mkProject(24, 'staging checklist done all details', { pocUserId: POC });
  await mkEnv(cb2.id, FULL({ type: 'staging', checklistCompleted: true, checklistAttachment: '/uploads/x.pdf', checklistSubmittedById: POC, checklistSubmittedDate: '2026-05-01', checklistSubmittedVersion: 'v1' }));
  await expectPublish(cb2.id, true, 'CB2 staging checklist completed, all details');

  console.log('\n=== D. Integration behavior (generic_value needs a value; account type does not) ===');
  const itGeneric = await mkIntType('generic_value', 'A');
  const d1 = await mkProject(11, 'generic integration no value', { pocUserId: POC }); const d1e = await mkEnv(d1.id, FULL()); await mkIntegration(d1e.id, { integrationTypeId: itGeneric, value: null });
  await expectPublish(d1.id, false, 'D1 generic_value, no value');
  const d2 = await mkProject(12, 'generic integration with value', { pocUserId: POC }); const d2e = await mkEnv(d2.id, FULL()); await mkIntegration(d2e.id, { integrationTypeId: itGeneric, value: 'ACC-123' });
  await expectPublish(d2.id, true, 'D2 generic_value, with value');
  const itAccount = await mkIntType('account_select_optional', 'C');
  const d3 = await mkProject(14, 'account_select_optional no value', { pocUserId: POC }); const d3e = await mkEnv(d3.id, FULL()); await mkIntegration(d3e.id, { integrationTypeId: itAccount, value: null });
  await expectPublish(d3.id, true, 'D3 account_select_optional, no value → value NOT required');
  const itKV = await mkIntType('key_value', 'KV');
  const d4 = await mkProject(15, 'key_value missing key', { pocUserId: POC }); const d4e = await mkEnv(d4.id, FULL()); await mkIntegration(d4e.id, { integrationTypeId: itKV, keyName: null, value: 'v' });
  await expectPublish(d4.id, false, 'D4 key_value, missing key name');
  const d5 = await mkProject(16, 'key_value missing value', { pocUserId: POC }); const d5e = await mkEnv(d5.id, FULL()); await mkIntegration(d5e.id, { integrationTypeId: itKV, keyName: 'server location', value: null });
  await expectPublish(d5.id, false, 'D5 key_value, missing value');
  const d6 = await mkProject(17, 'key_value complete', { pocUserId: POC }); const d6e = await mkEnv(d6.id, FULL()); await mkIntegration(d6e.id, { integrationTypeId: itKV, keyName: 'server location', value: 'DXB' });
  await expectPublish(d6.id, true, 'D6 key_value, key + value → accepted');

  console.log('\n=== E. Publish then revert ===');
  const e = await mkProject(13, 'publish-revert flow', { pocUserId: POC }); await mkEnv(e.id, FULL());
  await expectPublish(e.id, true, 'E publish ready project');
  check('E isPublished=true', (await get(`/infra/projects/${e.id}`)).data.isPublished === true);
  check('E list publishState=published', (await get('/infra/projects')).data.find((p) => p.id === e.id)?.publishState === 'published');
  await post(`/infra/projects/${e.id}/revert`, {});
  check('E isPublished=false after revert', (await get(`/infra/projects/${e.id}`)).data.isPublished === false);
  check('E list publishState=ready after revert', (await get('/infra/projects')).data.find((p) => p.id === e.id)?.publishState === 'ready');

  console.log('\n=== F. Bundle export structure (read-only) ===');
  const wb = await exportXlsx('/data/bundle/projects/export');
  const ph = headers(wb.getWorksheet('Projects')); const eh = headers(wb.getWorksheet('Environments'));
  check('F has Projects/Environments/Reference sheets', !!wb.getWorksheet('Projects') && !!wb.getWorksheet('Environments') && !!wb.getWorksheet('Reference'));
  check('F Projects has pocEmail, hides id/pocUserId, keeps importUid', 'pocEmail' in ph && !('id' in ph) && !('pocUserId' in ph) && 'importUid' in ph, Object.keys(ph));
  check('F Environments has projectName, hides projectId', 'projectName' in eh && !('projectId' in eh), Object.keys(eh));

  console.log('\n=== G. Import idempotency (generic engine, scoped to QA Test integration-types) ===');
  await mkIntType('generic_value', 'B'); // an existing row with an importUid
  const itWb = await exportXlsx('/data/infra.integration-types/export');
  const sheet = itWb.getWorksheet('data') || itWb.worksheets[0]; const sh = headers(sheet);
  const newName = `${TEST} Integration Type Imported`;
  const row = sheet.addRow([]); row.getCell(sh['name']).value = newName; row.getCell(sh['behavior']).value = 'generic_value';
  const imp1 = await importXlsx('/data/infra.integration-types/import', itWb);
  check('G1 first import created the new row', imp1.data?.created >= 1, imp1.data);
  const createdIt = (await get('/infra/integration-types')).data.find((x) => x.name === newName);
  check('G1 import-created row got an importUid', !!createdIt?.importUid, { importUid: createdIt?.importUid });
  const itWb2 = await exportXlsx('/data/infra.integration-types/export');
  const imp2 = await importXlsx('/data/infra.integration-types/import', itWb2);
  const dupes = (await get('/infra/integration-types')).data.filter((x) => x.name === newName).length;
  check('G2 re-import does NOT duplicate the imported row', dupes === 1, { count: dupes, created: imp2.data?.created });

  console.log('\n=== H. CRUD + Export/Import for every resource (New/Save/Edit/Export/Import/Delete buttons) ===');
  const CRUD = [
    { ep: '/infra/servers', data: 'infra.servers', create: { serverName: `${TEST} Srv CRUD`, provider: 'AWS', panel: 'Plesk', status: 'active' }, patch: { location: 'QA-DC' } },
    { ep: '/infra/git-providers', data: 'infra.git-providers', create: { name: `${TEST} Git CRUD` }, patch: { baseUrl: 'https://qa.git' } },
    { ep: '/infra/integration-types', data: 'infra.integration-types', create: { name: `${TEST} IT CRUD`, behavior: 'generic_value' }, patch: { isActive: false } },
    { ep: '/infra/accounts', data: 'infra.accounts', create: { accountName: `${TEST} Acct CRUD` }, patch: { notes: 'qa' } },
    { ep: '/jobbag/clients', data: 'jobbag.clients', create: { name: `${TEST} Client` }, patch: { phone: '12345' } },
    { ep: '/jobbag/vendors', data: 'jobbag.vendors', create: { vendorName: `${TEST} Vendor CRUD` }, patch: { pocName: 'qa poc' } },
    { ep: '/jobbag/vendor-services', data: 'jobbag.vendor-services', create: { vendorName: `${TEST} Vendor`, serviceName: `${TEST} Svc CRUD` }, patch: { cost: 99 } },
    { ep: '/jobbag/reminders', data: 'jobbag.reminders', create: { type: 'COMMON', userType: 'MYSELF', content: `${TEST} reminder` }, patch: { content: `${TEST} reminder 2` } },
  ];
  for (const cfg of CRUD) await crudSmoke({ ...cfg, tag: cfg.ep });

  // Environments + Integrations CRUD (nested resources, need a parent project)
  const host = await mkProject(40, 'CRUD host', { pocUserId: POC });
  await crudSmoke({ ep: '/infra/environments', data: 'infra.environments', create: { projectId: host.id, type: 'staging', url: 'https://crud.test' }, patch: { repoBranch: 'dev' }, tag: '/infra/environments' });
  const hostEnv = await mkEnv(host.id, FULL());
  const itc = await mkIntType('generic_value', 'CRUD');
  await crudSmoke({ ep: '/infra/integrations', data: 'infra.integrations', create: { environmentId: hostEnv.id, integrationTypeId: itc, value: 'X1' }, patch: { value: 'X2' }, tag: '/infra/integrations' });

  console.log('\n=== I. Special actions (auto-ID, notifications run/purge, user create) ===');
  const job = await post('/jobbag/jobs', { title: `${TEST} Job` });
  check('I jobs: auto QUT#### id assigned', /^QUT\d{4}$/.test(String(job.data?.uniqueId)), { uniqueId: job.data?.uniqueId });
  if (job.data?.id) await del('/jobbag/jobs/' + job.data.id);
  const run = await post('/jobbag/notifications/run', {});
  check('I notifications: Run reminders now → 2xx', run.status < 300, { status: run.status });
  const purge = await post('/jobbag/notifications/purge', { days: 90 });
  check('I notifications: Purge old → 2xx', purge.status < 300, { status: purge.status });
  const usr = await post('/users', { name: `${TEST} User`, email: `qa_test_user_qa@example.com` });
  check('I users: create (admin) → 2xx with id', usr.status < 300 && !!usr.data?.id, { status: usr.status, data: usr.data });
  const dup = await post('/users', { name: `${TEST} User Dup`, email: `qa_test_user_qa@example.com` });
  check('I users: duplicate email → 409 (not 500)', dup.status === 409, { status: dup.status });
  if (usr.data?.id) check('I users: delete', (await del('/users/' + usr.data.id)).status < 300);
  const reuse = await post('/users', { name: `${TEST} User`, email: `qa_test_user_qa@example.com` });
  check('I users: email reusable after delete (restore) → 2xx', reuse.status < 300 && !!reuse.data?.id, { status: reuse.status });
  if (reuse.data?.id) await del('/users/' + reuse.data.id);

  const itAcct = await mkIntType('generic_value', 'ACCT');
  const acc = await post('/infra/accounts', { accountName: `${TEST} Acct Ref`, integrationTypeId: itAcct });
  check('I accounts: integrationTypeId ref persists', acc.data?.integrationTypeId === itAcct, { got: acc.data?.integrationTypeId });
  if (acc.data?.id) await del('/infra/accounts/' + acc.data.id);

  // logout must revoke the refresh token server-side
  const lg = await post('/auth/login', ADMIN);
  await post('/auth/logout', { refreshToken: lg.data.refreshToken });
  const refreshAfter = await post('/auth/refresh', { refreshToken: lg.data.refreshToken });
  check('I logout revokes refresh token (refresh after logout → 401)', refreshAfter.status === 401, { status: refreshAfter.status });

  // user edit: change modules/groups via PATCH (the Users-page Edit button)
  const ue = await post('/users', { name: `${TEST} Edit`, email: 'qa_test_edit_qa@example.com', moduleKeys: ['jobbag'] });
  if (ue.data?.id) {
    const upd = await jreq('PATCH', `/users/${ue.data.id}`, { moduleKeys: ['infra', 'jobbag'] });
    const mods = (upd.data?.modules ?? []).map((m) => m.key).sort();
    check('I users: edit modules via PATCH', upd.status < 300 && mods.includes('infra') && mods.includes('jobbag'), { mods });
    await del('/users/' + ue.data.id);
  }

  // list publishState is computed correctly per-project in the batched list (no cross-project mixup)
  const lpReady = await mkProject(60, 'list ready', { pocUserId: POC }); await mkEnv(lpReady.id, FULL());
  const lpDraft = await mkProject(61, 'list draft no env', { pocUserId: POC });
  const listed = (await get('/infra/projects')).data;
  const aReady = listed.find((p) => p.id === lpReady.id)?.publishState;
  const aDraft = listed.find((p) => p.id === lpDraft.id)?.publishState;
  check('I list batch: ready project shows ready, draft shows draft (no mixup)', aReady === 'ready' && aDraft === 'draft', { aReady, aDraft });

  // user update to a duplicate email → clean 409, not 500
  const uA = await post('/users', { name: `${TEST} UA`, email: 'qa_test_ua_qa@example.com' });
  const uB = await post('/users', { name: `${TEST} UB`, email: 'qa_test_ub_qa@example.com' });
  const patchDup = uB.data?.id ? await jreq('PATCH', `/users/${uB.data.id}`, { email: 'qa_test_ua_qa@example.com' }) : { status: 0 };
  check('I users: update to duplicate email → 409 (not 500)', patchDup.status === 409, { status: patchDup.status });
  if (uA.data?.id) await del('/users/' + uA.data.id);
  if (uB.data?.id) await del('/users/' + uB.data.id);

  const s1 = await post('/infra/servers', { serverName: `${TEST} Dup Srv`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  const s2 = await post('/infra/servers', { serverName: `${TEST} Dup Srv`, provider: 'AWS', panel: 'Plesk', status: 'active' });
  check('I unique constraint → 409 not 500 (duplicate server name)', s2.status === 409, { status: s2.status });
  if (s1.data?.id) await del('/infra/servers/' + s1.data.id);

  const inv = await post('/invites', { email: 'qa_test_invite_qa@example.com', moduleKeys: ['infra'] });
  check('I invites: create returns acceptUrl + token', inv.status < 300 && !!inv.data?.acceptUrl, { status: inv.status, data: inv.data });
  const token = String(inv.data?.acceptUrl ?? '').split('/accept/')[1];
  if (token) check('I invites: public lookup by token works', (await get(`/public/invites/${token}`)).status < 300);
  if (inv.data?.id) await del('/invites/' + inv.data.id);

  // Integration identifier suggestions are derived from existing values of the same type
  const sp = await mkProject(41, 'suggestion source', { pocUserId: POC }); const spe = await mkEnv(sp.id, FULL());
  const itS = await mkIntType('generic_value', 'SUG');
  await mkIntegration(spe.id, { integrationTypeId: itS, value: 'servertag' });
  const sugg = [...new Set(((await get('/infra/integrations')).data || []).filter((r) => r.integrationTypeId === itS && r.value).map((r) => String(r.value)))];
  check('I integration identifier suggestions queryable for a type', sugg.includes('servertag'), { sugg });
  const kvKeys = [...new Set(((await get('/infra/integrations')).data || []).filter((r) => r.keyName).map((r) => String(r.keyName)))];
  check('I key_value key-name suggestions queryable', kvKeys.includes('server location'), { kvKeys });

  console.log('\n=== J. Dashboard + create robustness ===');
  const ds = await get('/dashboard/stats');
  check('J dashboard /stats → 2xx with full shape', ds.status < 300 && !!ds.data?.servers && !!ds.data?.projects && !!ds.data?.environments && Array.isArray(ds.data?.byPoc) && !!ds.data?.jobbag, { status: ds.status, keys: ds.data && Object.keys(ds.data) });
  check('J dashboard projects.unpublished = total - published', !!ds.data && ds.data.projects.unpublished === ds.data.projects.total - ds.data.projects.published, ds.data?.projects);
  const sv = await post('/infra/servers', { serverName: `${TEST} Srv Optional`, subscriptionName: 'x', provider: null, panel: null, status: null });
  check('J server create with empty provider/panel/status → 201 (status defaults to active)', sv.status < 300 && sv.data?.status === 'active', { status: sv.status, st: sv.data?.status });
  if (sv.data?.id) await del('/infra/servers/' + sv.data.id);
  const badReq = await post('/infra/servers', { serverName: null, provider: 'AWS', panel: 'None' });
  check('J missing required field (serverName) → 400 (not 500)', badReq.status === 400, { status: badReq.status });

  console.log('\n=== NL. Generic export/import links FK relations by NAME ===');
  const lv = await post('/jobbag/vendors', { vendorName: `${TEST} LinkVendor`, status: 'active' });
  const nlWb = await exportXlsx('/data/jobbag.vendor-services/export');
  const nlSheet = nlWb.getWorksheet('data') || nlWb.worksheets[0];
  const nlh = headers(nlSheet);
  check('NL export shows "vendor" name column and hides "vendorId"', 'vendor' in nlh && !('vendorId' in nlh), Object.keys(nlh));
  const nlRow = nlSheet.addRow([]);
  nlRow.getCell(nlh['vendor']).value = `${TEST} LinkVendor`;
  nlRow.getCell(nlh['serviceName']).value = `${TEST} LinkedSvc`;
  const nimp = await importXlsx('/data/jobbag.vendor-services/import', nlWb);
  const svc = ((await get('/jobbag/vendor-services')).data || []).find((s) => s.serviceName === `${TEST} LinkedSvc`);
  check('NL import resolves vendor name → vendorId (linked)', !!svc && svc.vendorId === lv.data?.id, { vendorId: svc?.vendorId, want: lv.data?.id, imp: nimp.data });
  if (svc) await del('/jobbag/vendor-services/' + svc.id);
  if (lv.data?.id) await del('/jobbag/vendors/' + lv.data.id);

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
}

let exitCode = 0;
try { await run(); if (fail > 0) exitCode = 1; }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally { try { await teardown(); } catch (e) { console.error('teardown error', e); } }
process.exit(exitCode);
