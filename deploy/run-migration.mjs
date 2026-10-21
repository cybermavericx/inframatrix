// Apply a .sql migration file to the configured MySQL DB, reading creds from apps/api/.env.
// Usage (from repo root):  node deploy/run-migration.mjs deploy/migrations/<file>.sql
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const file = process.argv[2];
if (!file) { console.error('usage: node deploy/run-migration.mjs <path-to.sql>'); process.exit(1); }

const env = Object.fromEntries(
  readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const sql = readFileSync(file, 'utf8');
const conn = await mysql.createConnection({
  host: env.DB_HOST, port: +(env.DB_PORT || 3306), user: env.DB_USERNAME,
  password: env.DB_PASSWORD, database: env.DB_DATABASE, multipleStatements: true,
});
try {
  await conn.query(sql);
  console.log(`✅ applied: ${file}`);
} catch (e) {
  console.error(`❌ ${file}: ${e.code || ''} ${e.sqlMessage || e.message}`);
  process.exitCode = 1;
} finally {
  await conn.end();
}
