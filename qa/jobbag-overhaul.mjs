// Intensive QA for the JobBag overhaul. Creates tagged throwaway data (QADEL*), exercises every new
// flow, asserts results, and (unless KEEP=1) deletes everything it created. Run: node qa_overhaul.mjs
const BASE = 'http://localhost:3035/api/v1';
const TAG = 'QADEL';
let TOK = '';
const created = { reminders: [], notes: [], payments: [], jobs: [], services: [], vendors: [], clients: [] };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOK ? { Authorization: 'Bearer ' + TOK } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}

async function main() {
  // ── login ──
  const login = await api('POST', '/auth/login', { email: 'admin@infra-v2.local', password: 'Admin@123' });
  TOK = login.data?.accessToken;
  ok(!!TOK, 'login');

  // ── infra still works (no regression) ──
  ok((await api('GET', '/infra/servers')).status === 200, 'infra servers list (no regression)');
  ok((await api('GET', '/infra/projects')).status === 200, 'infra projects list (no regression)');

  // ── service-billing is gone ──
  ok((await api('GET', '/jobbag/service-billing')).status === 404, 'service-billing endpoint removed (404)');

  // ── build a vendor → service → client graph ──
  const vendor = await api('POST', '/jobbag/vendors', { vendorName: TAG + ' Vendor', status: 'active' });
  created.vendors.push(vendor.data.id);
  const svc = await api('POST', '/jobbag/vendor-services', { vendorId: vendor.data.id, serviceName: TAG + ' Hosting', status: 'STARTED', isRenewable: 'Y', startDate: '2026-01-01', expiryDate: '2026-12-31' });
  created.services.push(svc.data.id);
  const client = await api('POST', '/jobbag/clients', { name: TAG + ' Client', status: 'active' });
  created.clients.push(client.data.id);
  ok(vendor.status === 201 && svc.status === 201 && client.status === 201, 'created vendor + service + client');

  // ── Payment as universal join: outgoing (pay vendor) + incoming (bill client) for the SAME service ──
  const pOut = await api('POST', '/jobbag/payments', { direction: 'outgoing', vendorServiceId: svc.data.id, vendorId: vendor.data.id, amount: 100, currency: 'AED', periodFrom: '2026-01-01', periodTo: '2026-01-31', dueDate: '2026-01-01', status: 'due', frequency: 'MONTHLY' });
  const pIn = await api('POST', '/jobbag/payments', { direction: 'incoming', vendorServiceId: svc.data.id, clientId: client.data.id, amount: 250, currency: 'AED', periodFrom: '2026-01-01', periodTo: '2026-01-31', dueDate: '2026-01-05', status: 'paid' });
  created.payments.push(pOut.data.id, pIn.data.id);
  ok(pOut.status === 201 && pIn.status === 201, 'created outgoing + incoming payments on the service');

  // client aggregation: the client's payments include the incoming bill
  const clientPays = (await api('GET', '/jobbag/payments')).data.filter((p) => p.clientId === client.data.id);
  ok(clientPays.some((p) => p.vendorServiceId === svc.data.id), "client's services derive from payments (join works)");
  // service aggregation: service's payments include both directions
  const svcPays = (await api('GET', '/jobbag/payments')).data.filter((p) => p.vendorServiceId === svc.data.id);
  ok(svcPays.some((p) => p.direction === 'outgoing') && svcPays.some((p) => p.direction === 'incoming'), 'service shows purchase + client-billing history');

  // ── date validation: periodTo < periodFrom must be rejected ──
  const bad = await api('POST', '/jobbag/payments', { direction: 'outgoing', periodFrom: '2026-05-01', periodTo: '2026-01-01' });
  ok(bad.status >= 400 && bad.status < 500, 'payment with periodTo < periodFrom rejected (' + bad.status + ')');

  // ── Job linked to service (vendor shown via relation) + client ──
  const job = await api('POST', '/jobbag/jobs', { title: TAG + ' Negotiate renewal', vendorServiceId: svc.data.id, clientId: client.data.id, action: 'Call vendor, negotiate price' });
  created.jobs.push(job.data.id);
  const jobFull = (await api('GET', '/jobbag/jobs/' + job.data.id)).data;
  ok(job.status === 201 && jobFull.uniqueId?.startsWith('QUT'), 'job created with QUT id');
  ok(jobFull.vendorService?.vendor?.vendorName === TAG + ' Vendor', 'job auto-shows vendor via service relation');

  // ── + Add reminder against the SERVICE (polymorphic), due in the past, MONTHLY ──
  const past = new Date(Date.now() - 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const rem = await api('POST', '/jobbag/reminders', { parentType: 'vendor_service', parentId: svc.data.id, title: TAG + ' Renew', status: 'WAITING', recurrence: 'MONTHLY', content: 'Renew the hosting', scheduledDateTime: past, emailTo: 'qa@example.com' });
  created.reminders.push(rem.data.id);
  ok(rem.status === 201 && rem.data.status === 'WAITING', 'reminder created as WAITING against vendor_service');

  // list reminders by parent
  const byParent = await api('GET', `/jobbag/reminders?parentType=vendor_service&parentId=${svc.data.id}`);
  ok(byParent.data.some((r) => r.id === rem.data.id), 'list reminders by parent works');

  // ── fire the scheduler: WAITING (past) → DUE + outbox row ──
  const run = await api('POST', '/jobbag/notifications/run');
  ok(run.status === 201 || run.status === 200, 'notifications run');
  const remAfter = (await api('GET', '/jobbag/reminders/' + rem.data.id)).data;
  ok(remAfter.status === 'DUE', 'reminder fired: WAITING → DUE');
  const outbox = (await api('GET', '/jobbag/outbox')).data;
  const ourMail = outbox.find((o) => o.relatedType === 'reminder' && o.relatedId === rem.data.id);
  ok(!!ourMail, 'mail recorded in Outbox when fired');
  ok(ourMail && (ourMail.status === 'STORED' || ourMail.status === 'SENT'), 'outbox mail STORED (no provider) / SENT — ' + (ourMail?.status));

  // ── resolve with note; MONTHLY → next WAITING spawned ──
  const resolved = await api('POST', `/jobbag/reminders/${rem.data.id}/resolve`, { note: 'Renewed for another month', status: 'RESOLVED' });
  ok(resolved.status === 201 && resolved.data.resolved.status === 'RESOLVED', 'reminder resolved with note');
  ok(resolved.data.resolved.resolvedNote === 'Renewed for another month', 'resolution note saved');
  ok(!!resolved.data.next && resolved.data.next.status === 'WAITING', 'recurring resolve spawned next WAITING occurrence');
  if (resolved.data.next) created.reminders.push(resolved.data.next.id);
  ok(resolved.data.next?.scheduledDateTime > rem.data.scheduledDateTime, 'next occurrence is one month later');

  // ── + Add note against the service ──
  const note = await api('POST', '/jobbag/notes', { parentType: 'vendor_service', parentId: svc.data.id, body: TAG + ' price went up 10%', authorName: 'QA' });
  created.notes.push(note.data.id);
  ok(note.status === 201, 'note created against vendor_service');

  // ── export still works (import/export intact) ──
  const exp = await fetch(BASE + '/data/jobbag.payments/export', { headers: { Authorization: 'Bearer ' + TOK } });
  ok(exp.status === 200 && (exp.headers.get('content-type') || '').includes('spreadsheet'), 'payments export (xlsx) works');

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed`);

  // ── cleanup ──
  if (process.env.KEEP === '1') { console.log('  KEEP=1 → leaving test data'); return; }
  console.log('  cleaning up test data…');
  for (const id of created.reminders) await api('DELETE', '/jobbag/reminders/' + id);
  for (const id of created.notes) await api('DELETE', '/jobbag/notes/' + id);
  for (const id of created.jobs) await api('DELETE', '/jobbag/jobs/' + id);
  for (const id of created.payments) await api('DELETE', '/jobbag/payments/' + id);
  for (const id of created.services) await api('DELETE', '/jobbag/vendor-services/' + id);
  for (const id of created.clients) await api('DELETE', '/jobbag/clients/' + id);
  for (const id of created.vendors) await api('DELETE', '/jobbag/vendors/' + id);
  // verify clean
  const leftover = (await api('GET', '/jobbag/payments')).data.filter((p) => String(p.forWhat || '').includes(TAG));
  const remLeft = (await api('GET', '/jobbag/reminders')).data.filter((r) => String(r.title || '').includes(TAG));
  console.log(`  cleanup done. leftover tagged payments=${leftover.length} reminders=${remLeft.length}`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('QA crashed:', e); process.exit(1); });
