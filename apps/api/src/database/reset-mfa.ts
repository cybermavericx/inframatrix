// Break-glass MFA reset -- run from the server only, never web-reachable. For when someone loses
// their authenticator device and is locked out (or MFA itself needs disabling for one account).
// Deliberately NOT built on seed.ts's DataSource: that one runs with synchronize + conditional
// dropSchema, which is the wrong tool anywhere near an admin fix. Uses a plain query, not the User
// entity/repository -- User declares @ManyToMany relations to ModuleEntity/GroupEntity, which would
// otherwise need registering here too just to satisfy TypeORM's metadata builder for a two-column
// update; a raw query needs none of that and can't touch anything but the columns named below.
//
// Usage (after `npm run api:build`):
//   node dist/database/reset-mfa.js user@example.com
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

dotenv.config();

const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'infra-jobbag',
  charset: 'utf8mb4',
  synchronize: false,
});

async function run() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node dist/database/reset-mfa.js <email>');
    process.exit(1);
  }
  await ds.initialize();
  const result: { affectedRows: number } = await ds.query(
    'UPDATE users SET mfa_enabled = 0, mfa_secret_encrypted = NULL WHERE email = ?',
    [email],
  );
  if (!result.affectedRows) {
    console.error(`No user found with email ${email}`);
    await ds.destroy();
    process.exit(1);
  }
  console.log(
    `MFA disabled for ${email}. They can log in with just their password and re-enroll from Security settings.`,
  );
  await ds.destroy();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
