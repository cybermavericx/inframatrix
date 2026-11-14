/**
 * Notes on records (GET/POST /notes, PATCH/DELETE /notes/:id) — run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/notes.mjs
 *
 * Logs in as admin, creates "QA Test Notes …" records and users (made-up data only), checks that
 * note access follows the record's permissions, that only authors (or note moderators) change a
 * note, validation, and the change-log entries; then deletes everything it made.
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const P = 'QA Test Notes';
const PASSWORD = 'QaTest@12345';

let pass = 0, fail = 0;
const fails = [];
const made = { projects: [], envs: [], payments: [], users: [], notes: [] };

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
async function mkUser(admin, slug, moduleKeys, groupKeys) {
  const email = `qa_test_notes_${slug}@example.com`;
  const r = await req(admin, 'POST', '/users', { name: `${P} ${slug}`, email, password: PASSWORD, moduleKeys, groupKeys });
  if (r.status >= 300) throw new Error(`mkUser ${slug}: ${r.status} ${JSON.stringify(r.data)}`);
  made.users.push(r.data.id);
  return { token: await login(email, PASSWORD), id: r.data.id, name: `${P} ${slug}` };
}
const list = (t, parentType, parentId) => req(t, 'GET', `/notes?parentType=${parentType}&parentId=${parentId}`);
async function add(t, parentType, parentId, body, extra = {}) {
  const r = await req(t, 'POST', '/notes', { parentType, parentId, body, ...extra });
  if (r.status === 201 && r.data?.id) made.notes.push(r.data.id);
  return r;
}

async function run(A) {
  // ---- fixtures (made-up) ----
  const pr = await mk(A, 'projects', '/infra/projects', { name: `${P} Project`, status: 'active' });
  const pr2 = await mk(A, 'projects', '/infra/projects', { name: `${P} Project 2`, status: 'active' });
  const env = await mk(A, 'envs', '/infra/environments', { projectId: pr.id, type: 'staging', url: 'https://notes.qa-notes.test' });
  const pay = await mk(A, 'payments', '/jobbag/payments', { direction: 'outgoing', amount: 1, currency: 'USD', status: 'due', forWhat: `${P} payment` });
  const viewer = await mkUser(A, 'viewer', ['infra'], ['infra.projects.viewer']);
  const editor = await mkUser(A, 'editor', ['infra'], ['infra.projects.editor']);
  const editor2 = await mkUser(A, 'editor2', ['infra'], ['infra.projects.editor']);
  const payEd = await mkUser(A, 'payeditor', ['jobbag'], ['jobbag.payments.editor']);

  console.log('\n=== A. Access follows the record ===');
  const a1 = await add(editor.token, 'project', pr.id, '  Client asked to keep PHP 8.1 until March  ', { authorName: 'someone else', createdBy: 1 });
  check('A1 project editor (Infra only, no JobBag) adds a note on a project → 201', a1.status === 201, a1);
  check('A2 text is trimmed; author name + createdBy come from the login, not the request',
    a1.data?.body === 'Client asked to keep PHP 8.1 until March' && a1.data?.authorName === editor.name && a1.data?.createdBy === editor.id, a1.data);
  const v = await list(viewer.token, 'project', pr.id);
  check('A3 project viewer can read the project\'s notes', v.status === 200 && v.data.length === 1, v);
  check('A4 project viewer cannot add a note → 403', (await add(viewer.token, 'project', pr.id, 'x')).status === 403);
  check('A5 project editor without environment access cannot add on an environment → 403', (await add(editor.token, 'environment', env.id, 'x')).status === 403);
  check('A6 … or read environment notes → 403', (await list(editor.token, 'environment', env.id)).status === 403);
  check('A7 project editor cannot read payment notes → 403', (await list(editor.token, 'payment', pay.id)).status === 403);
  const a8 = await add(payEd.token, 'payment', pay.id, 'Client approved Cloudflare Pro for Dec on call');
  check('A8 payments editor (JobBag only) adds a note on a payment → 201', a8.status === 201, a8);
  check('A9 payments editor cannot read project notes → 403', (await list(payEd.token, 'project', pr.id)).status === 403);
  check('A10 the old all-notes list still needs jobbag.notes → 403 for a project editor', (await req(editor.token, 'GET', '/jobbag/notes')).status === 403);
  const a11 = await list(A, 'project', pr2.id);
  check('A11 notes are per record (another project has none)', a11.status === 200 && a11.data.length === 0, a11);

  console.log('\n=== B. Who can change a note ===');
  const own = (await list(editor.token, 'project', pr.id)).data[0];
  check('B1 author sees canEdit + canDelete on their note', own?.canEdit === true && own?.canDelete === true, own);
  const other = (await list(editor2.token, 'project', pr.id)).data[0];
  check('B2 another editor sees canEdit/canDelete false', other?.canEdit === false && other?.canDelete === false, other);
  check('B3 another editor cannot edit it → 403', (await req(editor2.token, 'PATCH', `/notes/${own.id}`, { body: 'hijack' })).status === 403);
  check('B4 another editor cannot delete it → 403', (await req(editor2.token, 'DELETE', `/notes/${own.id}`)).status === 403);
  const b5 = await req(editor.token, 'PATCH', `/notes/${own.id}`, { body: 'Client asked to keep PHP 8.1 until April' });
  check('B5 author edits their note → 200', b5.status === 200 && b5.data?.body === 'Client asked to keep PHP 8.1 until April', b5);
  const adminNote = await add(A, 'project', pr.id, 'Admin note');
  check('B6 author cannot edit an admin\'s note → 403', (await req(editor.token, 'PATCH', `/notes/${adminNote.data.id}`, { body: 'x' })).status === 403);
  const b7 = await req(A, 'PATCH', `/notes/${own.id}`, { body: 'Client asked to keep PHP 8.1 until April (confirmed)' });
  check('B7 admin (jobbag.notes moderator) can edit anyone\'s note → 200', b7.status === 200, b7);
  check('B8 viewer cannot delete → 403', (await req(viewer.token, 'DELETE', `/notes/${own.id}`)).status === 403);

  console.log('\n=== C. Validation ===');
  check('C1 unknown record type → 400', (await add(A, 'spaceship', 1, 'x')).status === 400);
  check('C2 users can\'t carry notes → 400', (await add(A, 'user', 1, 'x')).status === 400);
  check('C3 empty / whitespace text → 400', (await add(A, 'project', pr.id, '   ')).status === 400);
  check('C4 non-text body → 400', (await add(A, 'project', pr.id, { a: 1 })).status === 400);
  check('C5 over 5000 characters → 400', (await add(A, 'project', pr.id, 'x'.repeat(5001))).status === 400);
  check('C6 record that does not exist → 404', (await add(A, 'project', 999999999, 'x')).status === 404);
  check('C7 bad parentId → 400', (await list(A, 'project', 'abc')).status === 400);
  check('C8 missing parentType → 400', (await req(A, 'GET', '/notes?parentId=1')).status === 400);
  check('C9 edit a note that does not exist → 404', (await req(A, 'PATCH', '/notes/999999999', { body: 'x' })).status === 404);
  check('C10 no login → 401', (await list(null, 'project', pr.id)).status === 401);

  console.log('\n=== D. Change-log ===');
  const del = await req(editor.token, 'DELETE', `/notes/${own.id}`);
  check('D1 author deletes their note → 200', del.status === 200, del);
  check('D2 it is gone from the list', !(await list(A, 'project', pr.id)).data.some((n) => n.id === own.id));
  const audit = (await req(A, 'GET', `/audit?entityType=project&entityId=${pr.id}`)).data ?? [];
  const edited = audit.filter((x) => x.fieldLabel === 'Note edited');
  const deleted = audit.find((x) => x.fieldLabel === 'Note deleted');
  check('D3 edits are in the project\'s change-log with old → new text', edited.length === 2
    && edited.some((x) => x.oldValue === 'Client asked to keep PHP 8.1 until March' && x.newValue === 'Client asked to keep PHP 8.1 until April'), edited);
  check('D4 delete is in the change-log with the deleted text', deleted?.oldValue === 'Client asked to keep PHP 8.1 until April (confirmed)', deleted);
  check('D5 the change-log names who deleted it', deleted?.authorName === editor.name, deleted);
}

let exitCode = 0;
const A = await login(ADMIN.email, ADMIN.password);
try { await run(A); }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally {
  for (const id of made.notes) await req(A, 'DELETE', '/notes/' + id);
  for (const id of made.payments) await req(A, 'DELETE', '/jobbag/payments/' + id);
  for (const id of made.envs) await req(A, 'DELETE', '/infra/environments/' + id);
  for (const id of made.projects) await req(A, 'DELETE', '/infra/projects/' + id);
  for (const id of made.users) await req(A, 'DELETE', '/users/' + id);
}
console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(exitCode || (fail > 0 ? 1 : 0));
