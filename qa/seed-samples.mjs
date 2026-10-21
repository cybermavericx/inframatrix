/**
 * Seed persistent "QA Sample ..." demo records (kept in the DB; NOT touched by
 * qa/testcase.mjs teardown). Re-running replaces the previous samples.
 *   node qa/seed-samples.mjs
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const SAMPLE = 'QA Sample';
let TOKEN = '';
const H = (b) => ({ Authorization: `Bearer ${TOKEN}`, ...(b ? { 'Content-Type': 'application/json' } : {}) });
const get = async (p) => (await fetch(BASE + p, { headers: H() })).json();
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: H(b), body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
const del = (p) => fetch(BASE + p, { method: 'DELETE', headers: H() });

async function login() { const r = await post('/auth/login', { email: 'admin@infra-v2.local', password: 'Admin@123' }); TOKEN = r.data.accessToken; return r.data.user; }

async function wipeSamples() {
  for (const p of (await get('/infra/projects')).filter((x) => String(x.name).startsWith(SAMPLE))) await del('/infra/projects/' + p.id);
  for (const s of (await get('/infra/servers')).filter((x) => String(x.serverName).startsWith(SAMPLE))) await del('/infra/servers/' + s.id);
}

const admin = await login();
await wipeSamples();

// reference data: a sample server + an existing git provider (or a sample one)
const srv = (await post('/infra/servers', { serverName: `${SAMPLE} Server 01`, subscriptionName: 'QA Demo Subscription', provider: 'AWS', panel: 'Plesk', osName: 'Ubuntu', status: 'active', publicIp: '203.0.113.10', privateIp: '10.0.0.10' })).data;
let gits = await get('/infra/git-providers');
const git = gits[0] || (await post('/infra/git-providers', { name: `${SAMPLE} Git Provider 01`, baseUrl: 'https://github.com' })).data;

// 1) a publishable (ready) sample: POC + 1 fully-filled staging env, CI/CD on
const ready = (await post('/infra/projects', { name: `${SAMPLE} Project 01 (Publishable)`, status: 'active', pocUserId: admin.id, notes: 'Fully configured — should show READY and allow Publish.' })).data;
await post('/infra/environments', { projectId: ready.id, type: 'staging', url: 'https://staging.qa-sample.test', serverId: srv.id, gitProviderId: git.id, repoUrl: 'https://github.com/qa/sample', repoBranch: 'main', cicdConfigured: true });

// 2) a draft sample: POC but no environment (blocked) so the gating is visible
const draft = (await post('/infra/projects', { name: `${SAMPLE} Project 02 (Draft - needs env)`, status: 'on_hold', pocUserId: admin.id, notes: 'Has a POC but no environment — should stay DRAFT, Publish disabled.' })).data;

console.log('Seeded:');
for (const id of [ready.id, draft.id]) {
  const reasons = await get(`/infra/projects/${id}/readiness`);
  const p = (await get('/infra/projects')).find((x) => x.id === id);
  console.log(`  #${id} "${p.name}" → state=${p.publishState}, blockers=${reasons.length ? reasons.join('; ') : 'none (ready)'}`);
}
console.log(`  server #${srv.id} "${srv.serverName}", git provider "${git.name}"`);
