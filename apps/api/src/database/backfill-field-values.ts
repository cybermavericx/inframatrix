// Backfill for the technology catalog (phase 3): copies every custom_fields integration's
// fieldValues JSON into infra_integration_field_values, and every fixed-list entry into
// infra_integration_field_options. Run AFTER deploy/migrations/2026-11-09-integration-field-catalog.sql.
//
//   node dist/database/backfill-field-values.js --dry-run             report only, writes nothing
//   node dist/database/backfill-field-values.js                       do it
//   --exclude-env=12,34      leave the integrations of these environments alone (e.g. demo data)
//   --technology-type=<id>   ALSO upgrade that custom_fields type: rename it "Technology Stack" and
//                            append the per-product version fields that are missing (never removes
//                            or changes an existing field). Prints the SQL that undoes it.
//
// Safety:
//   - The dry run executes the exact same code inside a transaction and ROLLS IT BACK, so its numbers
//     are the real run's numbers. The real run commits once at the end (all or nothing).
//   - Idempotent: a second run reports 0 inserted / 0 updated / 0 deleted.
//   - Never writes infra_integrations or its fieldValues JSON; proves it with a checksum before/after.
//   - Existing values outside a fixed list are reported, never changed.
//   - Take a mysqldump first (DEPLOY.md). Plain SQL: no synchronize, no schema changes.
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { join } from 'path';
import { DataSource, type EntityManager } from 'typeorm';
import { format } from 'mysql2';
import { IntegrationType, type IntegrationTypeField } from '../infra/entities/integration-type.entity';
import { syncTypeOptions, type Unmapped } from '../infra/field-catalog';

dotenv.config();

const PRODUCT_FIELDS: IntegrationTypeField[] = [
  { key: 'php', label: 'PHP' },
  { key: 'nodejs', label: 'Node.js' },
  { key: 'laravel', label: 'Laravel' },
  { key: 'wordpress', label: 'WordPress' },
  { key: 'mysql_mariadb', label: 'MySQL / MariaDB' },
  { key: 'web_server', label: 'Web server' },
].map((f) => ({ ...f, kind: 'version' as const, mode: 'possible' as const, possibleValues: [], avoidableValues: [] }));
const TECH_NAME = 'Technology Stack';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const known = ['dry-run', 'exclude-env', 'technology-type'];
for (const a of args) if (!known.some((k) => a === `--${k}` || a.startsWith(`--${k}=`))) { console.error(`Unknown argument: ${a}`); process.exit(2); }
const dryRun = !!flag('dry-run');
const ids = (v: string | undefined) => (v?.split('=')[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
  if (!/^\d+$/.test(x)) { console.error(`Not an id: ${x}`); process.exit(2); }
  return Number(x);
});
const exclude = new Set(ids(flag('exclude-env')));
const techType = flag('technology-type') ? ids(flag('technology-type'))[0] : undefined;

const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'infra-jobbag',
  charset: 'utf8mb4',
  entities: [join(__dirname, '..', '**', '*.entity.js')],
  synchronize: false,
});

async function counts(m: EntityManager) {
  const one = async (sql: string) => Number((await m.query(sql))[0].n);
  const rows: { id: number; f: string | null }[] = await m.query('SELECT id, CAST(field_values AS CHAR) AS f FROM infra_integrations ORDER BY id');
  const types: { id: number; f: string | null; name: string }[] = await m.query('SELECT id, name, CAST(fields AS CHAR) AS f FROM infra_integration_types ORDER BY id');
  const hash = (list: { id: number; f: string | null }[]) => createHash('sha256').update(list.map((r) => `${r.id}:${r.f ?? ''}`).join('\n')).digest('hex').slice(0, 16);
  return {
    integrations: rows.length,
    jsonChecksum: hash(rows),
    typeFieldsChecksum: hash(types),
    options: await one('SELECT COUNT(*) n FROM infra_integration_field_options'),
    values: await one('SELECT COUNT(*) n FROM infra_integration_field_values'),
  };
}

async function upgradeTechnologyType(m: EntityManager, id: number) {
  const t = await m.findOne(IntegrationType, { where: { id } });
  if (!t) throw new Error(`--technology-type: no integration type ${id}`);
  if (t.behavior !== 'custom_fields') throw new Error(`--technology-type: type ${id} is "${t.behavior}", not custom_fields`);
  const clash = await m.findOne(IntegrationType, { where: { name: TECH_NAME } });
  if (clash && clash.id !== id) throw new Error(`--technology-type: another type (${clash.id}) is already called "${TECH_NAME}"`);
  const fields = t.fields ?? [];
  const have = new Set(fields.map((f) => f.key));
  const added = PRODUCT_FIELDS.filter((f) => !have.has(f.key));
  console.log(`\nTechnology type ${id}: name "${t.name}" → "${TECH_NAME}"; fields kept: ${fields.length}; product fields added: ${added.map((f) => f.key).join(', ') || 'none'}`);
  if (t.name === TECH_NAME && !added.length) { console.log('  already upgraded — nothing to do'); return; }
  console.log('  UNDO (run after reverting, if needed):');
  console.log('  ' + format('UPDATE infra_integration_types SET name = ?, fields = CAST(? AS JSON) WHERE id = ?;', [t.name, JSON.stringify(t.fields ?? null), id]));
  await m.update(IntegrationType, id, { name: TECH_NAME, fields: [...fields, ...added] });
}

async function run() {
  await ds.initialize();
  const tables: { n: number }[] = await ds.query(
    "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('infra_integration_field_options', 'infra_integration_field_values')");
  if (Number(tables[0].n) !== 2) throw new Error('Run deploy/migrations/2026-11-09-integration-field-catalog.sql first.');

  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  const m = qr.manager;
  try {
    const before = await counts(m);
    if (techType !== undefined) await upgradeTechnologyType(m, techType);
    const typeIds: { id: number; name: string; behavior: string }[] = await m.query('SELECT id, name, behavior FROM infra_integration_types ORDER BY id');
    const total = { optIns: 0, optUpd: 0, optDel: 0, ins: 0, upd: 0, del: 0, wanted: 0 };
    const unmapped: (Unmapped & { type: number })[] = [];
    const outOfList: (Unmapped & { type: number })[] = [];
    const blocked: string[] = [];
    const skippedOptions: string[] = [];
    console.log(`\n${dryRun ? 'DRY RUN — nothing will be saved' : 'REAL RUN'}${exclude.size ? `; excluded environments: ${[...exclude].join(', ')}` : ''}`);
    console.log('type | behavior | options +ins ~upd -del | values +ins ~upd -del | wanted');
    for (const t of typeIds) {
      const r = await syncTypeOptions(m, t.id, { excludeEnvironments: exclude });
      const v = r.values ?? { inserted: 0, updated: 0, deleted: 0, wanted: 0, unmapped: [], outOfList: [] };
      total.optIns += r.inserted; total.optUpd += r.updated; total.optDel += r.deleted;
      total.ins += v.inserted; total.upd += v.updated; total.del += v.deleted; total.wanted += v.wanted;
      unmapped.push(...v.unmapped.map((u) => ({ ...u, type: t.id })));
      outOfList.push(...v.outOfList.map((u) => ({ ...u, type: t.id })));
      for (const b of r.plan?.inUse ?? []) blocked.push(`type ${t.id} ${JSON.stringify(b.fieldKey)} = ${JSON.stringify(b.value)} (used by ${b.uses}) — kept`);
      for (const s of r.plan?.skipped ?? []) skippedOptions.push(`type ${t.id} ${JSON.stringify(s.fieldKey)} = ${JSON.stringify(s.value)}: ${s.reason}`);
      console.log(`${t.id} | ${t.behavior} | +${r.inserted} ~${r.updated} -${r.deleted} | +${v.inserted} ~${v.updated} -${v.deleted} | ${v.wanted}`);
    }
    const after = await counts(m);
    const excludedRows = exclude.size
      ? Number((await m.query(`SELECT COUNT(*) n FROM infra_integration_field_values v JOIN infra_integrations i ON i.id = v.integration_id WHERE i.environment_id IN (${[...exclude].map(() => '?').join(',')})`, [...exclude]))[0].n)
      : 0;

    console.log(`\nTOTAL options +${total.optIns} ~${total.optUpd} -${total.optDel} | values +${total.ins} ~${total.upd} -${total.del}`);
    console.log(`BEFORE integrations=${before.integrations} options=${before.options} values=${before.values} json=${before.jsonChecksum} typeFields=${before.typeFieldsChecksum}`);
    console.log(`AFTER  integrations=${after.integrations} options=${after.options} values=${after.values} json=${after.jsonChecksum} typeFields=${after.typeFieldsChecksum}`);
    const countsMatch = after.values - excludedRows === total.wanted;
    const jsonSame = before.jsonChecksum === after.jsonChecksum && before.integrations === after.integrations;
    const typesSame = techType !== undefined || before.typeFieldsChecksum === after.typeFieldsChecksum;
    console.log(`CHECK values in JSON (copyable) = ${total.wanted}, value rows (not excluded) = ${after.values - excludedRows} → ${countsMatch ? 'MATCH' : 'MISMATCH'}`);
    console.log(`CHECK integrations JSON unchanged → ${jsonSame ? 'YES' : 'NO'}${techType === undefined ? `; type definitions unchanged → ${typesSame ? 'YES' : 'NO'}` : ''}`);
    console.log(`\nUNMAPPED (${unmapped.length}) — not copied, or copied without a sort key; the JSON keeps them:`);
    for (const u of unmapped) console.log(`  type ${u.type} integration ${u.integrationId} ${JSON.stringify(u.fieldKey)}: ${u.reason}`);
    console.log(`OUT OF LIST (${outOfList.length}) — existing values not in their fixed list; reported only, never changed:`);
    for (const u of outOfList) console.log(`  type ${u.type} integration ${u.integrationId} ${JSON.stringify(u.fieldKey)}`);
    if (skippedOptions.length) { console.log(`OPTIONS NOT MIRRORED (${skippedOptions.length}):`); skippedOptions.forEach((s) => console.log('  ' + s)); }
    if (blocked.length) { console.log(`OPTIONS NO LONGER IN THE LIST BUT STILL USED (${blocked.length}):`); blocked.forEach((s) => console.log('  ' + s)); }

    if (!countsMatch || !jsonSame || !typesSame) throw new Error('Checks failed — rolled back, nothing saved.');
    if (dryRun) { await qr.rollbackTransaction(); console.log('\nDRY RUN: rolled back. Run again without --dry-run to apply exactly the above.'); }
    else { await qr.commitTransaction(); console.log('\nCommitted.'); }
  } catch (e) {
    if (qr.isTransactionActive) await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
}

run()
  .then(() => ds.destroy())
  .catch(async (e) => {
    console.error(`\n❌ ${(e as Error).message}`);
    if (ds.isInitialized) await ds.destroy();
    process.exit(1);
  });
