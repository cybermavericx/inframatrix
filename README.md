<div align="center">
  <h1>InfraMatrix</h1>
  <p><b>Open-source Infrastructure &amp; JobBag Tracker</b></p>
  <p>🚀 <b>Version 2.0</b> — NestJS + React rewrite &nbsp;·&nbsp; v1 (Laravel/Filament) is tagged <code>v1-laravel</code></p>
  <p>Built by <a href="https://muhammednoufal.cybermavericx.com"><b>Muhammed Noufal</b></a> · <a href="https://cybermavericx.com">cybermavericx.com</a></p>
</div>

A single web app that merges **Infrastructure management** and **JobBag** (vendors, services,
renewals, billing, payments, reminders) into one platform with a **shared login** and
**per-module, per-resource access control**. Rebuilt from two legacy Laravel apps
(`inframatrix` = Filament admin, `manage jobbag` = Job Bag) into one modern TypeScript stack.

> **Doc map:** this README = what the app is + how to run it. **DEPLOY.md** = deploy to a server +
> release updates. Migrations live in `deploy/migrations/`.

---

### 1. Tech stack

| Area | Choice |
|------|--------|
| Backend | **NestJS** (TypeScript) + **TypeORM** |
| Database | **MySQL** (`inframatrix`) |
| Frontend | **React + Vite**, **TanStack React Query** (cached), **CASL** (abilities) |
| Auth | **JWT** (access + refresh), bcrypt |
| Scheduling | **@nestjs/schedule** (reminders, expiry/billing scans, log purge) |
| Email | **nodemailer** (logs to console in dev when no SMTP) |
| Excel | **exceljs** (generic import/export, de-duped by `import_uid`) |
| Monorepo | npm workspaces — `apps/api`, `apps/web` |

---

## 2. Architecture — single port

One NestJS process serves **everything** on `127.0.0.1:3035`: the built React UI
(`apps/web/dist`), the API (`/api/v1`), and uploads (`/uploads`). In production a CloudPanel
reverse-proxy terminates HTTPS and proxies to that port. See **DEPLOY.md**.

```
apps/
├── api/   NestJS — src/{auth,users,rbac,common,infra,jobbag,data,dashboard,mail,uploads,database}
└── web/   React  — src/{auth,components,pages,modules,lib}
```

- API base: `/api/v1` (health: `/api/v1/health`)
- **Default admin:** `admin@infra-v2.local` / `Admin@123` — **change immediately.**

---

## 3. Modules & screens

### Infra (`infra_*` tables)
- **Servers** — subscription, location, provider, panel, OS, status, AMC, IPs, capacity/usage.
- **Git Providers**, **Integration Types** (behavior: `generic_value` / `key_value` /
  `account_select_optional`), **Accounts**.
- **Projects** — tabbed editor (Overview / Environments). Nested **Environments** (type, URL,
  server, git provider, repo, CI/CD + reason, go-live checklist + attachment) and **Integrations**
  per environment. **Publish workflow**: Draft / Ready / Published, gated on a readiness check.
  - Projects list has free-text **search**; deleting a project cascades to its environments/integrations.

### JobBag (`jb_*` tables)

> **The Payment record is the single link** between a **client**, a **vendor-service** and a
> **vendor**. `direction = outgoing` = money we pay the vendor for the service; `direction = incoming`
> = money we bill a client for it. So a client's services, a service's clients, and all billing/payment
> history are all just that record's payments, grouped. (The old separate *Service Billing* screen was
> removed — an incoming Payment replaces it.)

- **Clients** — detail view lists the client's **services & billing** (from payments) with each
  period's payment status; click a row to open the vendor-service. Plus **+ Add reminder / note**.
- **Vendors** — detail view **expands** to its services (click → service) + reminders/notes.
- **Vendor Services** (cost/qty/frequency, start/expiry, renewable type) — detail view shows the
  service's full **purchase & client-billing history** (every payment, both directions, clickable) so
  you can see *what we bought, when, paid, and which clients it's assigned to*. Plus reminders/notes.
- **Payments** — money in/out, with a **recurrence engine** (ONE_TIME / WEEKLY / … / CUSTOM
  "every N months"). *Contract ends* is optional — **blank = repeat forever**.
  - **Period auto-fill:** set *Period from* + *Repeats* and *Period to* fills to the end of that
    cycle (e.g. MONTHLY 01 Jan → 31 Jan; WEEKLY → +6 days), with *Due date* defaulting to *Period to*.
    Only blank fields are filled (half-typed dates are ignored).
  - **Two ways to run a recurring contract:** (1) *Pay-as-you-go* — **Mark paid** spawns the next
    cycle; (2) **Generate schedule** — pre-create **every** cycle up to *Contract ends* (e.g. a 2-year
    monthly contract → 24 rows), each independently markable. Past cycles stay as `paid` rows = full
    year-by-year history.
- **Jobs** — a task you track + get reminded about. Link a **vendor-service** (its **vendor shows
  automatically**) and a **client**, write the **action**; add reminders/notes from the detail view.
- **Reminders** *(central log)* — every reminder. **Lifecycle:** `WAITING` → (its date arrives →
  email) `DUE` → **Resolve** (with a note) → `RESOLVED`; an intermediate `PENDING_RESOLVED` and
  `CANCELLED` also exist. Resolving a **recurring** reminder auto-creates the next occurrence. Filter
  by **status / type / month** and search; **Resolve** inline.
- **Reminder Groups** — distribution lists: a named set of users used as reminder recipients.
- **Notes** *(central log)* — every note added against a record (via **+ Add note**).
- **Outbox** — every email the system sent / stored, with the full rendered body. When no mail
  provider is configured, mails are **STORED** here so nothing is lost.
- **Notifications** — log of fired scans (reminders, payment-due, vendor-expiry); *Run now* + *Purge*.

#### The "+ Add anything" pattern
Open any record's detail view → **+ Add reminder** or **+ Add note** attaches it to *that* record
(polymorphic `parentType`/`parentId`). The item then shows in a panel under the record **and** in the
central Reminders / Notes log. Same mechanism on clients, vendors, services, payments and jobs.

### Admin
- **Users** — create directly or **invite by email** (7-day accept link), with per-module/per-app access.

---

## 4. Referential integrity (delete policy)

JobBag uses **RESTRICT** everywhere: you cannot delete a parent while children reference it — delete
the children first. A blocked delete returns a dialog that **names each blocking record with its id
and a click-through link** straight to it (Odoo-style). Chain:
`Vendor → Vendor Services → Payments`. Enforced both in the app (clear 409s) and at
the DB (FK `ON DELETE RESTRICT`, migration `deploy/migrations/2026-06-06-jobbag-fk-restrict.sql`).
All dates display as **`dd mmm yyyy`** (e.g. 07 Jun 2026); a "to" date can never be earlier than its
"from" (enforced on the form, the auto-fill, and the API).

Opening any record puts its id in the URL (`?view=<id>`) — visible, shareable, deep-linkable.

---

## 5. Access model (Odoo-style)

`users` → `user_modules` (which tabs) + `user_groups` → `groups` (per-app Viewer/Editor/Admin levels
+ standalone checkboxes) → `permissions` (model CRUD). Resolved into the JWT and enforced by guards
(`JwtAuthGuard` → `ModuleGuard` → CASL `PermissionsGuard`), mirrored in the UI.

---

## 6. Reminders, mail & outbox

- A **reminder** can be attached to **any** record (payment, vendor-service, client, vendor, job) via
  **+ Add reminder**. It has a schedule, an optional repeat (NONE/WEEKLY/MONTHLY/YEARLY) and
  **recipients** = chosen users and/or reminder-groups (+ extra emails).
- **Lifecycle:** `WAITING` → the hourly scheduler fires it on its date (emails recipients, records the
  mail to the **Outbox**, logs a Notification) → `DUE` → someone **Resolves** it with a note →
  `RESOLVED` (recurring reminders spawn the next `WAITING` occurrence on resolve). `PENDING_RESOLVED`
  and `CANCELLED` round out the states.
- **Mail providers** (env-selected): **SendGrid** (`SENDGRID_API_KEY`, via HTTPS — no extra dep) takes
  priority; else **SMTP** (`MAIL_HOST` …, via nodemailer); else **none**. Every mail is recorded in the
  **Outbox** first; with no provider it is **STORED** (viewable, nothing lost). All mail uses one
  branded HTML template.
- A daily job scans **vendor services** expiring ≤30d and **payments** due ≤30d → notifications
  (deduped per 7 days); then purges notifications older than 90 days. (Timezone Asia/Dubai.)

---

## 7. Import / Export & filtering

Every list has **Export** (xlsx) and **Import** — including **Users** (export omits the password, which
is `select:false`; import matches by email and updates existing users, skipping new ones since a
password isn't in the sheet). Import is idempotent (matches by `import_uid` or a natural unique key →
updates, never duplicates), coerces booleans, reports missing required fields per row, and skips bad
rows instead of failing the whole file.

**Filtering:** every list has a **Filters** bar (next to search) with one control per column, auto-typed
from the data — a dropdown for status/enum and low-cardinality columns, a from–to range for dates and
numbers, Yes/No for flags, and a "contains" box for names/free text. Combine several at once; the count
shows how many match. (Servers also have a *Hosting on this server* panel listing the environments
deployed on them.)

---

## 8. Run locally (WSL + Laragon MySQL)

Node runs under WSL; MySQL is Laragon on Windows. Two environment quirks:

1. **DB host:** from WSL, Laragon is reached via the **Windows host IP**, not 127.0.0.1
   (`ip route | grep default` → gateway). Set it in `apps/api/.env` (`DB_HOST`).
2. **Web build must use Windows node** — `node_modules` is Windows-native, so Linux Vite fails on the
   `rolldown` binary. The API runs fine under Linux node.

```bash
# 1. Build the web UI with Windows node (writes apps/web/dist):
cd apps/web && /mnt/c/Windows/System32/cmd.exe /c \
  "C:\laragon\bin\nodejs\node-v22\node.exe ..\..\node_modules\vite\bin\vite.js build"

# 2. Build the API (Linux node is fine):
cd .. && npm run api:build

# 3. Apply any new migrations to the DB:
node deploy/run-migration.mjs deploy/migrations/<file>.sql

# 4. Start the unified server on http://localhost:3035 :
cd apps/api && PORT=3035 node dist/main
```

First-time DB setup (creates schema + admin + RBAC): `npm --workspace apps/api run seed`
(dev seed recreates the schema — do **not** run against a DB with real data; use migrations instead).

Typecheck the web without building: `cd apps/web && npx tsc -b --noEmit`.

---

## 9. Testing / QA

See **testcase.md** for the manual + scripted QA checklist (API-driven smoke tests live in `qa/`,
plus the ad-hoc checks recorded there). Run after every change.

---

## 10. Production

See **DEPLOY.md** for the full server setup (CloudPanel reverse-proxy vhost, PM2, SMTP, secrets) and
the release-an-update procedure (`git pull` → build → run new migrations → `pm2 restart`).

---

## 👨‍💻 Author

**Muhammed Noufal** — Cloud & Infrastructure Engineer

- 🌐 Portfolio: [muhammednoufal.cybermavericx.com](https://muhammednoufal.cybermavericx.com)
- 🏢 [cybermavericx.com](https://cybermavericx.com)
- 🐙 GitHub: [@cybermavericx](https://github.com/cybermavericx)
- ✉️ [muhammednoufal7@gmail.com](mailto:muhammednoufal7@gmail.com)
