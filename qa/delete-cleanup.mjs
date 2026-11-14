/**
 * Deleting a record removes its notes and WAITING reminders (and those of the children the database
 * deletes with it), and the removed note text stays in the change-log. Run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/delete-cleanup.mjs
 *
 * Logs in as admin, creates "QA Test Cleanup …" records with notes and reminders (made-up data
 * only), deletes them through the API and checks what is left; then deletes anything it made.
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const P = 'QA Test Cleanup';
const LATER = new Date(Date.now() + 30 * 86400000).toISOString(); // far enough out that no reminder fires mid-run

let pass = 0, fail = 0;
const fails = [];
const made = { projects: [], envs: [], notes: [], reminders: [] };

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
  made[list].push(r.data.id);
  return r.data;
}
const note = (t, parentType, parentId, body) => mk(t, 'notes', '/jobbag/notes', { parentType, parentId, body });
const reminder = (t, parentType, parentId, title, status = 'WAITING') =>
  mk(t, 'reminders', '/jobbag/reminders', { parentType, parentId, title: `${P} ${title}`, status, scheduledDateTime: LATER, emailTo: 'qa@example.com' });
const exists = async (t, path) => (await req(t, 'GET', path)).data?.id != null;
const audit = async (t, type, id) => (await req(t, 'GET', `/audit?entityType=${type}&entityId=${id}`)).data ?? [];
const deletedNotes = (rows) => rows.filter((x) => x.fieldLabel === 'Note deleted').map((x) => x.oldValue);

async function run(A) {
  // ---- fixtures (made-up) ----
  const pr = await mk(A, 'projects', '/infra/projects', { name: `${P} Project`, status: 'active' });
  const keep = await mk(A, 'projects', '/infra/projects', { name: `${P} Keep`, status: 'active' });
  const live = await mk(A, 'envs', '/infra/environments', { projectId: pr.id, type: 'live', url: 'https://live.qa-cleanup.test' });
  const stg = await mk(A, 'envs', '/infra/environments', { projectId: pr.id, type: 'staging', url: 'https://staging.qa-cleanup.test' });
  const keepEnv = await mk(A, 'envs', '/infra/environments', { projectId: keep.id, type: 'live', url: 'https://keep.qa-cleanup.test' });

  const nProject = await note(A, 'project', pr.id, 'Client wants the renewal invoice in March');
  const nLive = await note(A, 'environment', live.id, 'Live DB password rotated by the client');
  const nStg = await note(A, 'environment', stg.id, 'Staging is shared with the QA team');
  const rProject = await reminder(A, 'project', pr.id, 'Renew AMC');
  const rLive = await reminder(A, 'environment', live.id, 'Renew SSL');
  const rDone = await reminder(A, 'project', pr.id, 'Already fired', 'DUE');
  const nKeep = await note(A, 'project', keep.id, 'Untouched project note');
  const nKeepEnv = await note(A, 'environment', keepEnv.id, 'Untouched environment note');
  const rKeep = await reminder(A, 'project', keep.id, 'Untouched');

  console.log('\n=== A. Deleting a project ===');
  const d = await req(A, 'DELETE', `/infra/projects/${pr.id}`);
  check('A1 delete the project → 200', d.status === 200, d);
  check('A2 its environments are gone (DB cascade)', !(await exists(A, `/infra/environments/${live.id}`)) && !(await exists(A, `/infra/environments/${stg.id}`)));
  check('A3 the project\'s note is gone', !(await exists(A, `/jobbag/notes/${nProject.id}`)));
  check('A4 its environments\' notes are gone', !(await exists(A, `/jobbag/notes/${nLive.id}`)) && !(await exists(A, `/jobbag/notes/${nStg.id}`)));
  check('A5 its WAITING reminders are gone (project and environment)', !(await exists(A, `/jobbag/reminders/${rProject.id}`)) && !(await exists(A, `/jobbag/reminders/${rLive.id}`)));
  check('A6 a reminder that already fired (DUE) is kept as history', await exists(A, `/jobbag/reminders/${rDone.id}`));
  const left = (await req(A, 'GET', `/jobbag/notes`)).data ?? [];
  check('A7 no note points at the deleted project or its environments',
    !left.some((n) => (n.parentType === 'project' && n.parentId === pr.id) || (n.parentType === 'environment' && [live.id, stg.id].includes(n.parentId))));
  const projAudit = await audit(A, 'project', pr.id);
  check('A8 the project\'s change-log keeps the deleted note text', deletedNotes(projAudit).includes('Client wants the renewal invoice in March'), projAudit);
  check('A9 the project\'s change-log records the deleted reminder', projAudit.some((x) => x.fieldLabel === 'Reminder deleted' && x.oldValue?.includes(`${P} Renew AMC`)), projAudit);
  const liveAudit = await audit(A, 'environment', live.id);
  check('A10 the environment\'s change-log keeps its deleted note text', deletedNotes(liveAudit).includes('Live DB password rotated by the client'), liveAudit);
  check('A11 … and the project\'s timeline shows it too', projAudit.some((x) => x.mirror && x.fieldLabel?.endsWith('Note deleted') && x.oldValue === 'Staging is shared with the QA team'), projAudit);

  console.log('\n=== B. Other records are untouched ===');
  check('B1 another project\'s note is kept', await exists(A, `/jobbag/notes/${nKeep.id}`));
  check('B2 another environment\'s note is kept', await exists(A, `/jobbag/notes/${nKeepEnv.id}`));
  check('B3 another project\'s reminder is kept', await exists(A, `/jobbag/reminders/${rKeep.id}`));

  console.log('\n=== C. Deleting an environment on its own ===');
  const d2 = await req(A, 'DELETE', `/infra/environments/${keepEnv.id}`);
  check('C1 delete the environment → 200', d2.status === 200, d2);
  check('C2 its note is gone', !(await exists(A, `/jobbag/notes/${nKeepEnv.id}`)));
  check('C3 the project\'s own note is kept', await exists(A, `/jobbag/notes/${nKeep.id}`));
  const keepAudit = await audit(A, 'project', keep.id);
  check('C4 the parent project\'s timeline keeps the environment\'s deleted note text',
    keepAudit.some((x) => x.mirror && x.fieldLabel?.endsWith('Note deleted') && x.oldValue === 'Untouched environment note'), keepAudit);
}

let exitCode = 0;
const A = await login(ADMIN.email, ADMIN.password);
try { await run(A); }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally {
  for (const id of made.notes) await req(A, 'DELETE', '/jobbag/notes/' + id);
  for (const id of made.reminders) await req(A, 'DELETE', '/jobbag/reminders/' + id);
  for (const id of made.envs) await req(A, 'DELETE', '/infra/environments/' + id);
  for (const id of made.projects) await req(A, 'DELETE', '/infra/projects/' + id);
}
console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(exitCode || (fail > 0 ? 1 : 0));
