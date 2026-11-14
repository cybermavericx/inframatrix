/**
 * Mark paid fills the payment period and the next cycle's period — run after every change.
 *   QA_BASE=http://localhost:3035/api/v1 node qa/payment-period.mjs
 *
 * Logs in as admin, creates "QA Test Period …" payments (made-up data only), marks them paid via
 * POST /jobbag/payments/:id/pay and checks Period from / Period to on the paid row and on the next
 * cycle, then deletes everything it made.
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@infra-v2.local', password: 'Admin@123' };
const P = 'QA Test Period';

let pass = 0, fail = 0;
const fails = [];
const made = [];

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
const day = (v) => (v == null ? null : String(v).slice(0, 10));
async function mkPay(t, body) {
  const r = await req(t, 'POST', '/jobbag/payments', { direction: 'outgoing', amount: 10, currency: 'USD', status: 'due', ...body, forWhat: `${P} ${body.forWhat ?? ''}` });
  if (r.status >= 300) throw new Error(`create payment: ${r.status} ${JSON.stringify(r.data)}`);
  made.push(r.data.id);
  return r.data;
}
async function pay(t, id, paidDate) {
  const r = await req(t, 'POST', `/jobbag/payments/${id}/pay`, paidDate ? { paidDate } : {});
  if (r.data?.next?.id) made.push(r.data.next.id);
  return r;
}

async function run(A) {
  console.log('\n=== A. Monthly, period blank ===');
  const a = await mkPay(A, { forWhat: 'monthly blank', frequency: 'MONTHLY', dueDate: '2026-11-13' });
  const ra = await pay(A, a.id, '2026-11-13');
  check('A1 paid row: Period from = due date', ra.status === 201 && day(ra.data.paid.periodFrom) === '2026-11-13', ra.data?.paid);
  check('A2 paid row: Period to = one month later minus a day', day(ra.data?.paid?.periodTo) === '2026-12-12', ra.data?.paid);
  check('A3 next cycle: Period 2026-12-13 → 2027-01-12', day(ra.data?.next?.periodFrom) === '2026-12-13' && day(ra.data?.next?.periodTo) === '2027-01-12', ra.data?.next);
  check('A4 next cycle due date still anchored to the paid date', day(ra.data?.next?.dueDate) === '2026-12-13', ra.data?.next);
  const again = await pay(A, ra.data.next.id, '2026-12-15');
  check('A5 the chain continues: 2027-01-13 → 2027-02-12', day(again.data?.next?.periodFrom) === '2027-01-13' && day(again.data?.next?.periodTo) === '2027-02-12', again.data?.next);

  console.log('\n=== B. Period already filled is kept ===');
  const b = await mkPay(A, { forWhat: 'monthly filled', frequency: 'MONTHLY', dueDate: '2026-11-01', periodFrom: '2026-10-05', periodTo: '2026-11-04' });
  const rb = await pay(A, b.id, '2026-11-02');
  check('B1 paid row keeps its own period', day(rb.data?.paid?.periodFrom) === '2026-10-05' && day(rb.data?.paid?.periodTo) === '2026-11-04', rb.data?.paid);
  check('B2 next cycle continues from it: 2026-11-05 → 2026-12-04', day(rb.data?.next?.periodFrom) === '2026-11-05' && day(rb.data?.next?.periodTo) === '2026-12-04', rb.data?.next);

  console.log('\n=== C. One-time ===');
  const c = await mkPay(A, { forWhat: 'one time', frequency: 'ONE_TIME', dueDate: '2026-11-20' });
  const rc = await pay(A, c.id, '2026-11-21');
  check('C1 Period from = due date', day(rc.data?.paid?.periodFrom) === '2026-11-20', rc.data?.paid);
  check('C2 Period to stays blank (no cycle length)', rc.data?.paid?.periodTo == null, rc.data?.paid);
  check('C3 no next cycle', rc.data?.next == null, rc.data);

  console.log('\n=== D. Other frequencies + edge dates ===');
  const d1 = await mkPay(A, { forWhat: 'quarterly', frequency: 'QUARTERLY', dueDate: '2027-01-16' });
  const rd1 = await pay(A, d1.id, '2027-01-16');
  check('D1 quarterly: 2027-01-16 → 2027-04-15, next 2027-04-16 → 2027-07-15',
    day(rd1.data?.paid?.periodTo) === '2027-04-15' && day(rd1.data?.next?.periodFrom) === '2027-04-16' && day(rd1.data?.next?.periodTo) === '2027-07-15', rd1.data);
  const d2 = await mkPay(A, { forWhat: 'custom 2', frequency: 'CUSTOM', customMonths: 2, dueDate: '2026-11-22' });
  const rd2 = await pay(A, d2.id, '2026-11-22');
  check('D2 every 2 months: 2026-11-22 → 2027-01-21', day(rd2.data?.paid?.periodTo) === '2027-01-21', rd2.data?.paid);
  const d3 = await mkPay(A, { forWhat: 'yearly', frequency: 'YEARLY', dueDate: '2026-12-12' });
  const rd3 = await pay(A, d3.id, '2026-12-10');
  check('D3 yearly: 2026-12-12 → 2027-12-11', day(rd3.data?.paid?.periodTo) === '2027-12-11', rd3.data?.paid);
  const d4 = await mkPay(A, { forWhat: 'month end', frequency: 'MONTHLY', dueDate: '2027-01-31' });
  const rd4 = await pay(A, d4.id, '2027-01-31');
  check('D4 month end clamps: 2027-01-31 → 2027-02-27', day(rd4.data?.paid?.periodTo) === '2027-02-27', rd4.data?.paid);
  const d5 = await mkPay(A, { forWhat: 'no due date', frequency: 'MONTHLY' });
  const rd5 = await pay(A, d5.id, '2026-11-14');
  check('D5 no due date: Period from = paid date', day(rd5.data?.paid?.periodFrom) === '2026-11-14' && day(rd5.data?.paid?.periodTo) === '2026-12-13', rd5.data?.paid);

  console.log('\n=== E. Unchanged rules ===');
  const e = await pay(A, a.id, '2026-11-20');
  check('E1 paying a paid payment again → 409', e.status === 409, e);
  const stored = await req(A, 'GET', `/jobbag/payments/${a.id}`);
  check('E2 stored row matches (period saved, not only returned)', day(stored.data?.periodFrom) === '2026-11-13' && day(stored.data?.periodTo) === '2026-12-12', stored.data);
}

let exitCode = 0;
const login = await req(null, 'POST', '/auth/login', ADMIN);
const A = login.data?.accessToken;
if (!A) { console.error('login failed', login.status); process.exit(1); }
try { await run(A); }
catch (e) { console.error('FATAL', e); exitCode = 1; }
finally {
  for (const id of made.reverse()) await req(A, 'DELETE', '/jobbag/payments/' + id);
}
console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
process.exit(exitCode || (fail > 0 ? 1 : 0));
