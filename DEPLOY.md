# InfraMatrix — Deployment Guide (Linux + CloudPanel)

**Single-port model.** One NestJS process (PM2) serves the whole app on `127.0.0.1:3035`:
the built React UI (`apps/web/dist`), the API (`/api/v1`), and uploads (`/uploads`).
A CloudPanel **Reverse Proxy** site terminates HTTPS and proxies everything to that port.

```
Browser ──HTTPS──> CloudPanel site (nginx, reverse proxy)
                     └── /  → reverse_proxy → 127.0.0.1:3035  (NestJS, PM2)
                                ├── /              → React UI (apps/web/dist, SPA fallback)
                                ├── /api/v1/...    → API
                                └── /uploads/...   → uploaded files
                                        └── MySQL  inframatrix
```

> The vhost to paste into CloudPanel lives in **`deploy/cloudpanel-vhost.conf`** (port 3035 hardcoded;
> set your `server_name`). See step 6.

---

## 0. Prerequisites (on the server)
- Linux + **CloudPanel** installed.
- **Node 20+** (`node -v`) and **npm**.
- **PM2**: `npm i -g pm2`
- **MySQL** (CloudPanel ships MySQL).

---

## 1. Create the database
**CloudPanel → Databases → Add Database**:
- Database name: `inframatrix`
- Create a DB user + strong password; grant it to that database.

(CLI alternative: `mysql -u root -p` → ``CREATE DATABASE `inframatrix` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`` + a user with privileges.)

> On the server the API connects over `127.0.0.1` (MySQL is local). The WSL-dev quirk of using the
> Windows host IP does **not** apply here.

---

## 2. Get the code & configure env
```bash
cd /home/<site-user>/htdocs
git clone <your-repo> inframatrix && cd inframatrix
npm install
```

**`apps/api/.env`** (production) — `.env` is gitignored; create it from `apps/api/.env.example`:
```
NODE_ENV=production
PORT=3035                                       # MUST match the vhost proxy_pass port
WEB_ORIGIN=https://yourdomain.tld               # same-origin in this model; listed for safety
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=inframatrix_user
DB_PASSWORD=<strong-db-password>
DB_DATABASE=inframatrix
JWT_ACCESS_SECRET=<long-random-string>
JWT_ACCESS_TTL=900s
JWT_REFRESH_SECRET=<another-long-random-string>
JWT_REFRESH_TTL=30d
# Email (invites + reminders). Provider priority: SendGrid → SMTP → none (mails STORED in the Outbox).
# Option A — SendGrid (recommended for prod; uses HTTPS, no extra dependency):
SENDGRID_API_KEY=<sendgrid-api-key>
# Option B — SMTP (used only if SENDGRID_API_KEY is unset). Leave all blank to STORE mail in the Outbox:
MAIL_HOST=smtp.yourprovider.com
MAIL_PORT=587
MAIL_SECURE=false                               # true for port 465 (implicit TLS)
MAIL_USER=apikey
MAIL_PASS=<smtp-secret>
MAIL_FROM=no-reply@yourdomain.tld                # the From: address for both providers
# Optional: override where the UI build is served from (default: ../web/dist relative to apps/api)
# WEB_DIST=/home/<site-user>/htdocs/inframatrix/apps/web/dist
```

**`apps/web/.env`** (build-time) — same-origin, so a **relative** base:
```
VITE_API_URL=/api/v1
```

> Generate secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

---

## 3. Build (web first, then API)
```bash
npm run web:build      # → apps/web/dist  (the API serves these static files)
npm run api:build      # → apps/api/dist
```
The API serves the UI from `apps/web/dist`, so the web build must exist before you start the API.

---

## 4. First-time database setup (creates schema + admin + RBAC; no wipe in prod)
```bash
cd apps/api
NODE_ENV=production npm run seed
```
With `NODE_ENV=production` the seed **does not drop** anything — it creates missing tables and seeds
modules/apps/groups/permissions + the admin user.
**Default admin:** `admin@infra-v2.local` / `Admin@123` — **change this password immediately.**

---

## 5. Run the unified server with PM2 (first-time only — releases use §7)
This is the **one-time** start on a fresh server (or after the process is lost). Routine code releases
do **not** repeat this — they just `pm2 restart` (see §7).

Start from `apps/api` (the app resolves the UI at `../web/dist`, so the working dir must be `apps/api`),
**as the site user — not root** (the process must be owned by the same user whose `.pm2` survives reboots):
```bash
cd /home/<site-user>/htdocs/inframatrix/apps/api
pm2 start dist/main.js --name inframatrix --cwd "$(pwd)" --update-env
pm2 save                                   # freezes the current process list to <site-user>'s ~/.pm2/dump.pm2
pm2 startup                                # prints a `sudo env PATH=… pm2 startup systemd -u <site-user> --hp …` line
#   ↳ copy-paste & run THAT printed line, THEN run `pm2 save` again.
```

> ⚠️ **Reboot-survival gotcha (this is the usual reason the app is down after a reboot).**
> `pm2 startup` must register the service for **`<site-user>`**, not `root`. If you run a bare
> `pm2 startup` while `su`-ed to **root**, it creates `pm2-root.service` which resurrects *root's*
> (empty) list — so the app does **not** come back on reboot. Always run the exact
> `… pm2 startup systemd -u <site-user> --hp /home/<site-user>` line that pm2 printed under the site
> user. To undo a wrong one: run `pm2 unstartup systemd` **as that user** (e.g. `pm2 unstartup systemd`
> as root removes `pm2-root.service`). Confirm with `systemctl is-enabled pm2-<site-user>` → `enabled`.

The process now serves UI + API + uploads on `127.0.0.1:3035`, and runs the in-app scheduler
(reminders / expiry / notification purge). Verify locally:
```bash
curl -s http://127.0.0.1:3035/api/v1/health     # → {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3035/   # → 200 (UI)
```

**After a reboot, if `pm2 list` is empty:** the startup service wasn't set up for the site user. Re-run
the start + `pm2 save` above as the site user, then fix `pm2 startup` per the gotcha — no rebuild needed.

---

## 6. CloudPanel site (Reverse Proxy + the vhost)
1. **CloudPanel → Sites → Add Site → Create a Reverse Proxy** (or add a site, then replace its vhost).
   Domain Name = your hostname (e.g. `inframatrix.yourdomain.tld`).
2. **Site → SSL/TLS** → issue a Let's Encrypt certificate.
3. **Site → Vhost** → paste the contents of **`deploy/cloudpanel-vhost.conf`** and **set `server_name`**
   to your domain, then Save. Key points already in that file:
   - `proxy_pass http://127.0.0.1:3035/;` (single `location /` — proxies the whole app)
   - `client_max_body_size 25m;` (logo / attachment / xlsx-import uploads)
   - WebSocket-upgrade + long timeouts; the `{{...}}` tokens are CloudPanel template vars — leave them.

That's it — no separate static root, no `/api` location: the Node app serves everything.

---

## 7. Releasing an update (the regular code-release step)
This is what you run for **every** deploy. It does **not** re-run `pm2 start`/`pm2 startup` (§5) — the
process already exists, so you only **rebuild + `pm2 restart`**. UI-only changes still need `web:build`
(the prebuilt `apps/web/dist` is served), then a browser hard-refresh (Ctrl+Shift+R).
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build
# Apply any new DB migrations (additive, no data loss) — see deploy/migrations/. Run each new one once:
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-06-05-payment-recurrence.sql
# One-time cleanup of environments orphaned by project deletes before the cascade fix (safe to re-run):
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-06-05-cleanup-orphan-environments.sql
pm2 restart inframatrix --update-env
```

### Releasing cross-entity JobBag filters (2026-06-10, jobbag-filters)
Adds the drill-in relation filter to Vendors / Vendor Services / Payments / Clients / Jobs (filter a
list by its related records). **Backend changed** (new `listWithRelations` aggregates on vendors,
vendor-services, clients), so build BOTH; no DB migration/seed.
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull && npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify e.g. **Payments → Filter**: `Vendor ▸ Name` / `Service ▸ Expiry date` /
`Client ▸ Name`; **Vendors → Filter**: `Services ▸ Status` / `Payments ▸ Status`; **Vendor Services →
Filter**: `Clients ▸ Name`.

### Releasing the Odoo-style filter picker + popup editor (2026-06-10, filter-ux)
Adds the searchable drill-in field picker (Environments ▸ / Integrations ▸) to the Custom Filter,
splits the integration filter fields (key / value / combined), and makes the project Open/Edit a popup.
**Backend changed** (split integration aggregates), so build BOTH; no DB migration/seed.
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull && npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify on **Projects → Filter**: field picker is searchable with `Environments ▸` /
`Integrations ▸` drill-ins; e.g. all PHP 8.x hostings → `Integrations ▸ Type · key · value` *contains*
`php 8`. Opening a project shows the editor as a centred popup (list stays in place).

### Releasing the env/integration project filters (2026-06-10, filters)
Lets the Projects Filter reach into environments + integrations (their own tables). **Needs an API
rebuild** (new aggregate fields on the projects list response) **plus** `web:build`. No DB migration,
no seed (aggregates are computed at read time from existing tables).
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build   # BOTH — backend changed this time
pm2 restart inframatrix --update-env
```
Hard-refresh the browser. Verify on **Projects → Filter**: the field dropdown now lists
**Environment URL / type / server** and **Integration type / value** — e.g. "Environment URL contains
example.com", "Integration type = SendGrid", "Integration value contains php 8.3".

### Releasing the reusable View + import/export (2026-06-10)
**UI-only change — no API rebuild strictly needed, no DB migration, no seed.** Adds the shared
`RecordDetail` "View" (incl. a **View button on Project → Environments**) and the `useImportExport`
hook. Because the prebuilt `apps/web/dist` is what gets served, the only required steps are:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install                 # no new deps, but keeps the lockfile honest
npm run web:build           # REQUIRED — rebuilds the served UI bundle
pm2 restart inframatrix --update-env
```
Then **hard-refresh the browser (Ctrl+Shift+R)**. Verify: open a project → **Environments** tab → each
environment now has **View** (read-only fields + Reminders/Notes panels). No `api:build`/migration/seed
needed (environment reminders/notes reuse the existing polymorphic `parentType` — no schema change).

### Releasing the JobBag overhaul (2026-06-07)
This release removes **Service Billing** (merged into Payments), adds **Notes** + **Outbox**, the new
**reminder lifecycle**, and **job** links. Steps (on top of the standard `git pull` → build above):
```bash
# 1. Schema + data migration (adds reminder/job/notes/outbox columns & tables, maps reminder statuses,
#    and copies each service-billing row into Payments as an `incoming` payment). Run ONCE:
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-06-07-jobbag-overhaul.sql

# 2. Register the two new RBAC resources (jobbag.notes, jobbag.outbox) + grant admin. The prod seed is
#    ADDITIVE (NODE_ENV=production never drops) — it upserts perms/groups/apps and the admin user:
cd apps/api && NODE_ENV=production node dist/database/seed.js && cd ..

# 3. (Optional) configure SENDGRID_API_KEY (or MAIL_*) in apps/api/.env so reminders actually email —
#    otherwise every mail is STORED in the Outbox screen.

pm2 restart inframatrix --update-env
```
After verifying the migrated Payments look correct in the UI, you may drop the now-unused table:
`DROP TABLE jb_vendor_service_clients;` (the line is included, commented, at the end of the migration).
**Keep your Excel backup** until you've confirmed the migration.

> **Schema changes (important):** the runtime uses TypeORM `synchronize: false`, so new columns are
> added via the explicit, additive SQL in **`deploy/migrations/`** — run each new file once. Do NOT
> rely on the seed's `synchronize` for an existing production DB (it can drop/alter columns). The
> seed is only for first-time setup (schema + admin + RBAC).
>
> The **payment-recurrence** migration adds: `frequency, custom_months, tenure_end, series_id,
> spawned_next` to `jb_payments`. It's a MySQL `ALTER TABLE ADD COLUMN` (errors harmlessly if already applied).

> **Dependency security:** `package.json` pins a `uuid` override (`^11.1.1`) and `package-lock.json`
> reflects it, so `npm install` on the server yields **0 audit vulnerabilities**. Run `npm audit` to confirm.

### Releasing TOTP two-factor auth (2026-09-10, mfa)

Adds self-service MFA (Google Authenticator / Authy / any TOTP app) — off by default per user, opted
into from the new **Security** page. **Backend changed** (new endpoints + encrypted secret storage),
so build both; one migration, and two new required env vars.

```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install                                    # pulls in otplib + qrcode
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-09-10-mfa.sql
```

In `apps/api/.env`, add (see `.env.example` for the full comments):
```
JWT_MFA_SECRET=<long-random-string>            # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
MFA_ENCRYPTION_KEY=<32-byte-hex>               # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
MFA_ENFORCED=true                              # leave true; see break-glass note below
```
Then the normal build + restart:
```bash
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: **Security** nav link → enable MFA → scan the QR → confirm code → log out → log
back in with password → confirm it now prompts for a code before letting you in.

**Two break-glass paths if this ever goes wrong (per-account, and whole-feature) — both intentionally
have no HTTP route; only SSH reaches either:**
- **One person is locked out** (lost their phone): `node dist/database/reset-mfa.js user@example.com`
  from `apps/api` — clears that one account's MFA so they can log in with just their password and
  re-enroll.
- **The feature itself is broken for everyone:** set `MFA_ENFORCED=false` in `apps/api/.env`, then
  `pm2 restart inframatrix --update-env`. MFA is skipped for all logins regardless of who has it
  enabled until you flip it back.

Never make MFA (or any auth check) manageable from inside the app itself as its own recovery path —
if the thing that locks you out also gates the only way to unlock it, an account issue becomes
unrecoverable without server access anyway, so it may as well require server access on purpose,
cleanly, via the two paths above.

### Releasing enforced MFA + admin controls (2026-09-10, mfa-required)

Layers an admin-mandated policy on top of the self-service MFA above: an admin marks a user
required (checkbox on create/edit) with a 15-day grace period; once it passes, that user is blocked
from the app (Security setup only, Logout still works) until they enroll. **Backend changed**, one
migration — this one is **not idempotent and rewrites data**, since it retroactively applies the
15-day policy to every current user who doesn't already have MFA on:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-09-10-mfa-required-policy.sql
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
No new env vars. Hard-refresh. Verify: **Users** list now has an MFA column (days-left / overdue /
ON); creating a user has the "Require two-factor authentication" checkbox (checked by default);
selecting user(s) in the list shows **Reset MFA** and **Remove MFA requirement** bulk actions.

**Once this is live, every current user has 15 days to enable MFA before being blocked.** If that's
not what you want yet (e.g. you want to announce it first), immediately uncheck "Require" for
whoever needs more time — bulk-select them and use **Remove MFA requirement** — or, to postpone the
whole rollout, re-run with a longer interval before deploying (edit the `INTERVAL 15 DAY` in the
migration file for your own copy; it can't be changed after the fact except per-user via Edit, since
the deadline is stamped once).

**Admin remediation for "lost my phone"** is now available two ways — pick whichever you have
access to at the time: the **Reset MFA** bulk action on the Users screen (needs an admin session,
gives the affected user a fresh 15-day window automatically if they're under the policy), or the
SSH-only `node dist/database/reset-mfa.js <email>` script from the previous release (needs server
access instead, for when no admin session is usable at all).

### Releasing self-service change-password / change-email (2026-09-11, self-service-creds)

Adds "Change password" and "Change email" to the **Security** page, so any logged-in user can update
their own credentials (previously only an admin could, via Edit on the Users screen). **Backend
changed** (two new endpoints), so build both. No DB migration, no new env vars.

```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: **Security** page → both new cards appear below the two-factor section; changing
the password requires the current one and takes effect immediately; changing the email requires the
current password, then signs you out — log back in with the new address to confirm it took.

### Releasing the Odoo-style export field picker (2026-09-23, export-picker)

Replaces every list's fixed full-column Export with a field picker (pick which fields, own or one
hop into a to-one relation, reorder, save as a template, XLSX or CSV) — and adds an **Export** button
to FK-filtered related panels (e.g. a Server's "Hosting on this server"), scoped to just that panel's
rows. **Backend changed** (new `GET /data/:resource/fields`, extended `/export` to accept
`fields`/`format`/an equality filter), so build both. No DB migration, no new env vars — omitting
`fields` on `/export` keeps the old full-column-dump behavior, so the round-trip import/export
templates (Projects bundle, vendor-services seeding, etc.) are unaffected.

```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: any list's **Export** button opens the picker (pre-seeded with that list's
visible columns) instead of downloading immediately; on **Servers**, open a server with hosting →
**Hosting on this server** panel → **Export** → pick a field or two (try expanding **Server** to add
e.g. Public Ip) → Export → file downloads scoped to just that server's environments.

**Follow-up same day (2026-09-23):** the first pass missed **Projects** — it has its own page (not
the generic list component), so its Export button still did the old immediate full-column download.
Fixed: Projects' Export now opens the same picker (defaulting to its own visible columns); the old
full Projects+Environments workbook is still there, relabeled **Export for re-import** (that's the
round-trip format Import expects — not a general report, kept as-is). Also added: checking rows in
any list and clicking Export (or the new **Export selected** button next to Publish/Delete selected)
scopes the file to just those rows (`?ids=...`, matching the Odoo convention that a selection scopes
the toolbar Export). Same build/restart steps as above — no new migration or env var either.

**Second follow-up same day (2026-09-23):** the picker still only went one relation hop deep, and only
through to-one relations — so "export each server's hosted domains/URLs" was impossible (that's the
*reverse* side of Environment.server, which didn't exist as a relation at all). Now arbitrary-depth,
including to-many/reverse relations (Server → Environments, Project → Environments, Client/Vendor/
VendorService → Payments) — the field tree lazily loads each level as you expand it, and the moment a
picked path crosses a to-many hop, its values join into one "; "-separated cell per parent row rather
than multiplying the export's row count. Also added the "Import-compatible export" checkbox (adds the
importUid/id column, Odoo's "I want to update data" equivalent, so re-importing the sheet updates
existing records instead of duplicating them). **Backend changed** (new relation-walking logic in
`data.controller.ts`, plus new read-only `OneToMany` inverse relations on five entities — no schema/
migration change, just exposes FKs that already existed), so build both:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: **Servers** → open a server with hosting → Hosting panel's **Export** → expand
**Environments** (tagged "multiple") → add **Url** → Export → each server's row lists all its hosted
URLs, semicolon-separated. Separately: any project's **Edit → Environments** tab now shows each
environment's server name + IP inline with a **Copy IP** button (previously only visible back in the
list's Hosting column, forcing a trip back and forth to copy one).

**Third follow-up same day (2026-09-23) — important correctness fix:** "Import-compatible export" as
first shipped did not actually round-trip. The custom export wrote pretty column headers ("Server
Name") but the shared import endpoint only matches real column names ("serverName") — same convention
the original default export/import has always used — so re-importing a custom-export file silently
updated nothing. Fixed: own-field headers are now the real propertyName; the id column is now the
literal `importUid`; the checkbox is now hidden (with an explanatory note) for the couple of resources
that have no `importUid` (core.users, infra.invites) instead of writing a `id` header the import
parser was always going to ignore; CSV is now disabled whenever import-compatible is checked, since
Import only reads `.xlsx`. Relation-drilled columns (a to-one hop, or an aggregated to-many list like
a server's flattened hosting URLs) are unchanged in behavior — reference-only, never written back —
but are now labeled "reference only" in the picker so that's explicit rather than a silent no-op.
Also added: a "+ Add all fields" button at the root and on every expanded relation node. **Backend
changed** (data.controller.ts only — no new endpoints, same shapes), so build both:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: export any resource with **Import-compatible export** checked → confirm the
first column header reads exactly `importUid` and CSV is greyed out. To confirm the full round trip:
export one record, edit one of its own fields (not a "reference only" one) in the sheet, re-import →
Users screen / toast reports `updated: 1` for that record, not a new row.

**Fourth follow-up same day (2026-09-23) — UI cleanup:** removed Projects' second **Export for
re-import** button (mentioned above) — two differently-behaving "Export" buttons was exactly the kind
of confusion it looks like, and the field-picker's Import-friendly toggle already covers the common
case. **Import** is unaffected: it already fell back to reading a plain single-sheet file when no
"Projects" worksheet was present, so nothing about it depended on that button specifically. Also
restyled Import-friendly from a checkbox-in-a-paragraph to an actual toggle switch. **Frontend only**
(ProjectsPage.tsx, ExportPicker.tsx) — `npm run web:build` is enough, no `api:build`/restart needed:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build
```
Hard-refresh. Verify: **Projects** page head shows exactly one **Export** button (no "Export for
re-import"); **Import** still works on both a plain field-picker export and an old-style bundle file
if anyone still has one saved.

**Fifth follow-up same day (2026-09-23) — relation-field import, Odoo-style:** two changes, checked
against Odoo's own documented behavior first (via Context7). (1) **Correctness fix affecting every
existing relation-name import, not just the new picker:** a name that doesn't match any existing
record now blocks that whole row (previous behavior: silently cleared the relation to null and logged
a buried warning — this affected the Projects+Environments bundle import too, not just the new
feature). (2) A to-one relation field that lands on exactly that relation's own name column (e.g. a
Project's **Poc → Name**) is now tagged **editable** in the picker and genuinely round-trips: pick an
existing name and reimport to update it, pick a name that doesn't exist and the row is rejected with
a clear "row N: ... not found" error — reuses the same matching the default export already had, not
new logic. Every other relation-drilled field is unchanged (reference-only). **Backend changed**
(data.controller.ts), frontend changed (ExportPicker.tsx tagging) — build both:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: export a Project with **Name** + **Poc: Name** (tagged "editable"), Import-friendly
on → edit the POC cell to a different real user's name → reimport → `updated: 1`, POC changed. Try an
invalid name instead → response reports `skipped: 1` with a "not found" error naming the row, and
nothing in that row was applied (including any other field you also edited on it).

### Releasing the full-system audit fixes (2026-09-23, security) — deploy this one promptly

A requested full-codebase audit (not scoped to the export feature) turned up several real issues,
two of them genuine security holes on the live site right now. **Backend changed** (10 files across
auth, uploads, audit, integration-types, payments, reminders) — build both, same as usual:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
No DB migration, no new env vars. What changed, in priority order:

1. **Stored XSS, reminder → Outbox → any admin who opens it.** A reminder's free-text content was
   interpolated unescaped into its email/Outbox HTML — anyone who could create a reminder could plant
   a script payload that ran in an admin's session (full token theft) the next time that admin viewed
   the Outbox. Now HTML-escaped at the source.
2. **Unrestricted file upload.** `/uploads` accepted any extension with no serving safeguards — an
   `.html`/`.svg` upload was a same-origin script-execution vector for whoever opened its link. Now
   restricted to documents/images/archives.
3. **Disabled users could keep working.** `POST /auth/refresh` never checked account status — a
   disabled user's existing refresh token kept minting new access tokens for up to 30 days after being
   disabled. Now checked, same as login already was.
4. **Audit/change-log had no permission check.** Any authenticated user could read any record's full
   field-change history by id, regardless of whether they had read access to that resource. Now gated.
5. **Session revocation on credential change.** Changing your password/email, or an admin resetting
   someone's MFA, now revokes that user's other active sessions — previously a stolen token survived
   all three.
6. **`IntegrationType` delete had no safety check** despite cascading to delete every integration of
   that type, system-wide, on delete — now blocked with the referencing list, matching how every other
   cascade-risk delete in the app already behaves.
7. Three smaller correctness fixes: marking an already-paid payment "paid" again no longer silently
   overwrites its paid date; resolving an already-resolved recurring reminder a second time no longer
   spawns a duplicate next occurrence; a payment schedule that would need more than 600 cycles to
   reach its end date now fails clearly instead of silently generating a truncated schedule.

Every fix above was verified against the running app (scripted before/after checks), not just read
and assumed correct — see the commit message for exact verification output.

**Known, deliberately not fixed here** (each needs a decision, not a quick patch): the Dashboard has
no permission gate (shows both infra and jobbag stats to anyone authenticated, regardless of their
actual module access); there's no rate-limiting on `/auth/login` itself (only the MFA step is capped);
`mfaAttempts` is an in-memory map that never prunes abandoned entries; no maximum password length is
enforced (bcrypt's own 72-byte truncation applies, as everywhere).

**Same-day follow-up — cosmetic (2026-09-23):** the Import-friendly id column now displays Odoo's own
`module.identifier` "External ID" format (e.g. `__export__.infra_servers_1_51c82bb6-...`) instead of a
bare UUID — the real identity is still the same importUid embedded at the end; nothing about matching
changed, and old exports with a bare UUID still import fine. **Backend only** (`data.controller.ts`):
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
npm run api:build
pm2 restart inframatrix --update-env
```

### Releasing CI/CD status: Auto / Manual / Disabled (2026-09-24)

Replaces the environment editor's binary "CI/CD configured" checkbox with a 3-state field that
distinguishes how deployment actually works: **Auto** (webhook — pushes deploy automatically),
**Manual** (repo connected to the server, deployed by clicking "Deploy now" / a manual pull), or
**Disabled** (no repo connected at all — FTP-only deployment). The reason textarea now only appears
(and is only required by the publish-readiness check) when status is Disabled — same idea as before,
just correctly scoped to the state it actually applies to. **Schema change, rewrites existing data** —
this migration backfills every environment's old `cicd_configured` boolean into the new field
(`configured=1 → 'auto'`, `configured=0 → 'disabled'`) then drops the old column, so it is **not**
idempotent and cannot be safely re-run:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull
npm install
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-09-24-cicd-status.sql
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: open any project → **Environments** → **Edit** on an environment → **CI/CD**
shows a dropdown (Auto / Manual / Disabled) instead of a checkbox; the reason box only appears when
Disabled is selected; switching away from Disabled and saving clears any reason that was there.

### Releasing full change history — Odoo-style Activity (2026-10-06, change-history)
Every create / edit / delete is now logged with **who, when, old → new** and shown in an **Activity**
timeline on the record's detail view (click a row): Projects, Servers, Environments, Git Providers,
Integration Types, Accounts, Clients, Vendors, Vendor Services, Payments, Jobs. Changes made by one save
are grouped into one entry. Foreign keys show **names** ("Hostinger → vm-tw-dxb-lnx02"), not ids. Changes
to a project's environments/integrations also appear on the **Project's** Activity. Excel imports and
project publish/revert are logged too. **Users → History** shows account events (created, edited,
password changed, 2FA on/off/reset, deleted) — never the password itself.

> **No DB migration.** Backend + web changed, and `nodemailer` was bumped (`npm install` picks it up,
> `npm audit` is back to 0 vulnerabilities).
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull && npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. History starts from this deploy — earlier edits can't be reconstructed (only the
project/server/environment changes already logged before show up, with raw ids for old FK changes).
Verify: edit a server's IP, open it → Activity shows `Public ip: old → new` by you.

### Releasing the Activity Log screens + Activity refresh fix (2026-10-06, activity-log)
- **Activity refresh fix:** the Activity panel no longer shows stale data — an edit appears immediately
  (before, it could lag up to 30 s until you reloaded), and one save is shown as one grouped entry.
- **New "Full history" button** on every record's Activity panel (and Users → History): the complete
  history as a filterable, paged table (search, person, date range).
- **Who is shown by current name:** history rows resolve the author from their user id, so changing
  your email/name no longer leaves old entries under the stale email (shown by name; email on hover/CSV).
- **New Administration → Activity Log** page: every change across the system, filter by record type /
  person / date, Export CSV. Visible to users who can read Users.

> ## ⚠ DATABASE MIGRATION REQUIRED — run it BEFORE restarting
> Adds `audit_log.entity_label` + `audit_log.mirror` (+ an index). **If you skip it, the change-log
> cannot be read or written and every Activity panel will be empty/erroring** (same failure mode as the
> CI/CD column outage). It is additive and safe; run it exactly once:
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull && npm install
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-10-06-audit-entity-label.sql
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: **Administration → Activity Log** lists recent changes; edit a server's capacity,
open it → the entry is there at once, and **Full history** shows the table. Entries written before this
release show the record as `#id` (their name wasn't stored); new ones carry the name.

### Releasing project developers (2026-10-07, project-developers)
Each project can now have **any number of developers**, chosen from a searchable checklist of Users
(create the developers as Users first). Shown in the project form (**Developers**), the project View, a
new **Developers** column in the Projects list, and the list Filter/search. Developer changes appear in
the project's Activity by name (`Developers: Asha → Asha, Ravi`).

> ## ⚠ DATABASE MIGRATION REQUIRED — run it BEFORE restarting
> Creates the join table `infra_project_developers`. **If you skip it, every Projects query fails and
> the Projects list shows empty** (the same failure as the CI/CD column outage). Additive and safe; run
> once (it is `CREATE TABLE IF NOT EXISTS`, so a repeat is harmless).
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull && npm install
mysql -u <db-user> -p <db-name> < deploy/migrations/2026-10-07-project-developers.sql
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: open a project → **Developers** checklist → tick two users → **Save project** →
the list shows them in the Developers column and the project's Activity shows the change.

### Releasing the gap-sweep fixes (2026-10-09, gap-sweep)
Found by a full review of the app; **no database migration** (backend + web changed — build both).
- **User pickers for non-admins:** Point of Contact / Developers / Checklist-submitted-by / reminder
  recipients were empty for anyone without Users admin access (they read the admin-only `/users`). They
  now use a new minimal `GET /users/lookup` (id, name, email of active users) open to any logged-in user.
- **Dashboard respects permissions:** it used to return every module's numbers and details (server IPs,
  environment URLs, POC emails…) to any logged-in user. Each section is now filled only if the user can
  read that resource; otherwise it is zeroed.
- **Login brute-force brake:** after 10 failed logins for one email from one address (50 per address) in
  15 minutes, login returns 429 for the rest of the window. A success clears it. In memory — a
  `pm2 restart` resets it. Passwords are capped at 128 characters (256 on login).
- **Export picker cleaned up:** readable field names ("AMC status", "Point of contact", "CI/CD" — not
  "Amc Status", "Poc User Id"); raw `…Id` columns hidden (the related record is offered by name); no
  circular drill-ins (Project → Environments → Project); a related User exposes only name/email (no MFA
  state); a **Filter fields…** box; taller lists. A plain export now has readable column headings
  (like Odoo); only **Import-friendly** exports keep the technical headings the Import button matches.
- **Users list:** the Edit button (and so every permission control) could be clipped off-screen — fixed.
```bash
cd /home/<site-user>/htdocs/inframatrix
git pull && npm install
npm run web:build && npm run api:build
pm2 restart inframatrix --update-env
```
Hard-refresh. Verify: as a user without Users access, open a project → the Developers / POC dropdowns
list people; Dashboard shows only the modules they can read.

---

## 8. Operations
- **Logs:** `pm2 logs inframatrix`  ·  **Status:** `pm2 status`  ·  **Restart:** `pm2 restart inframatrix`
- **Backups:** schedule a `mysqldump` of `inframatrix` (CloudPanel has scheduled DB backups).
- **Scheduler:** runs inside the API process — reminders hourly, expiry + 90-day notification purge daily
  (Asia/Dubai). No separate cron needed.
- **Health check:** `https://yourdomain.tld/api/v1/health` → `{"status":"ok"}`.

## 9. Production checklist
- [ ] Changed the admin password
- [ ] Strong `JWT_*` secrets, real DB user (not root)
- [ ] `NODE_ENV=production`, `PORT` matches the vhost (3035), `VITE_API_URL=/api/v1`
- [ ] Web built **before** starting the API (UI is served from `apps/web/dist`)
- [ ] SMTP configured (invites + reminder emails)
- [ ] SSL issued; vhost pasted from `deploy/cloudpanel-vhost.conf` with your `server_name`
- [ ] PM2 `save` + `startup` done; DB backups scheduled
