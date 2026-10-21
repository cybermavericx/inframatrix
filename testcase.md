# InfraMatrix — QA Test Cases

Automated smoke/regression suite to run **after every change**. It drives the real API
as `admin`, asserts the publish-readiness rules and the Excel export/import behaviour,
then **deletes everything it created**.

## How to run

```powershell
# 1. dev server must be running (api :3000 + web :5173)
$env:Path = "C:\laragon\bin\nodejs\node-v22;$env:Path"
npm run dev

# 2. in another terminal, from the repo root:
node qa/testcase.mjs        # exits 0 = all pass, 1 = a failure (or fatal)
```

Optional override: `QA_BASE=http://host:3000/api/v1 node qa/testcase.mjs`.

## Naming & cleanup (important)

| Prefix | Created by | Lifetime |
|---|---|---|
| **`QA Test …`** | `qa/testcase.mjs` | **Ephemeral** — deleted in teardown after every run (teardown also runs *before* the run to clear leftovers from an interrupted run, and runs even if asserts fail). |
| **`QA Sample …`** | `qa/seed-samples.mjs` | **Persistent** — demo data kept in the DB; never touched by the test suite. |

So "run testcase.md" = `node qa/testcase.mjs`; it cleans up its own `QA Test …` records and
leaves your real data and the `QA Sample …` demo records intact.

Re-seed the persistent demo records anytime with: `node qa/seed-samples.mjs`
(creates `QA Sample Project 01 (Publishable)` and `QA Sample Project 02 (Draft - needs env)`).

## Recent QA — 2026-06-06 redesign (JobBag integrity, correlation, billing period, reminders)

These cover the latest changes. API-driven checks were scripted ad-hoc (see the patterns below); the
UI aspects are manual spot-checks. Re-verify after touching `jobbag/*`, `common/blocked.ts`,
`CrudPage.tsx`, `ReminderModal.tsx`, `MultiRefSelect.tsx`, or the scheduler.

### Delete = RESTRICT, with a click-through blocker dialog
| # | Scenario | Expected |
|---|---|---|
| R1 | Delete a vendor that has services/payments | **409**, body lists `blockers:[{resource,id,label}]` + hint |
| R2 | Delete a vendor-service that has payments / billing links | **409** with those blockers |
| R3 | Delete a client referenced by payments / billing links | **409** with those blockers |
| R4 | Delete a leaf (payment, billing link) | **200** |
| R5 | Delete parent after all children removed | **200** |
| R6 | `DELETE /jobbag/vendors/:id/cascade` | **404** (cascade/"Del + all" was removed) |
| R7 | UI: blocked dialog — each blocker is a link to `/<resource>?view=<id>`; opens that record | manual |

### Record id in the URL
- Opening any record (View / a blocker link / child link / dashboard payment row) sets `?view=<id>`;
  loading that URL deep-opens the record; the detail header shows a `#id` badge. (manual)

### Payments correlation
| # | Scenario | Expected |
|---|---|---|
| C1 | Vendor row → "Payments ↗" | navigates to `/jobbag/payments?vendorId=<id>`, list filtered to that vendor |
| C2 | Vendor-Service row → "Payments ↗" | `/jobbag/payments?vendorServiceId=<id>`, filtered |
| C3 | Filter banner | shows readable name (e.g. `Vendor: Acme`), not `vendorId: 5` |

### Service Billing period (dynamic)
| # | Scenario | Expected |
|---|---|---|
| SB1 | Create billing with `frequency` (preset or typed) + `nextBillDate` | persisted; "250" now means "per <freq>, next <date>" |
| SB2 | Daily scan `runBillingDue` | service billings due ≤30d → a `BILLING_DUE` notification (deduped per 7d) |

### Reminders (created from records → recipients → email)
| # | Scenario | Expected |
|---|---|---|
| RM1 | Create a **Reminder Group** with `memberUserIds` | created; members stored |
| RM2 | Reminders tab | **read-only** — no New/Edit; lists running reminders with parent link |
| RM3 | ⏰ Remind on a Payment / Service-Billing → set when + recipients (users/groups) | `POST /jobbag/reminders` with `parentType/parentId/recipientUserIds/recipientGroupIds` |
| RM4 | Scheduler fires a due reminder | recipients resolved (group members ∪ users ∪ emails), email sent (logged in dev), **Notification** logged, one-off → `SENT`, recurring → rescheduled |
| RM5 | Reminder with no resolvable recipient | notification status `SKIPPED` |

Scripted-check pattern (adapt as needed): log in as admin → build the scenario via `POST` →
assert the `DELETE`/`POST` status codes and response bodies → `POST /jobbag/notifications/run` to
fire the scheduler → assert `/jobbag/notifications` → tear down (delete children before parents).

## What it covers (128 assertions)

### A–E. Publish-readiness rules (a project may publish **only** when all hold)
A POC is set · AMC active ⇒ both AMC from/to set and to ≥ from · ≥1 environment exists ·
every env has `type, url, server, git provider, repo URL, repo branch` · CI/CD off ⇒ a reason ·
**any** env with the checklist marked completed ⇒ document + submitted-by + date + version ·
a **live** env with the checklist not completed ⇒ a not-completed reason · every
`generic_value` integration has a value.

| # | Scenario | Expected |
|---|---|---|
| A1 | Project, no POC, no env | publish **rejected** |
| A2 | Project + POC, no env | publish **rejected** |
| B1 | Env missing url/server/git/repo | publish **rejected** |
| B2 | Full env, CI/CD on (staging) | publish **accepted** |
| B3 | CI/CD off, no reason | publish **rejected** |
| B4 | CI/CD off, with reason | publish **accepted** |
| C1 | Live env, checklist completed, missing docs | publish **rejected** |
| C2 | Live env, checklist completed, all 4 docs | publish **accepted** |
| C3 | Live env, checklist not completed, no reason | publish **rejected** |
| C4 | Live env, checklist not completed, with reason | publish **accepted** |
| CA1 | AMC active, no from/to dates | publish **rejected** |
| CA2 | AMC active, from/to dates set | publish **accepted** |
| CB1 | **Non-live** env, checklist completed, no submitter/date/version | publish **rejected** |
| CB2 | **Non-live** env, checklist completed, all details | publish **accepted** |
| D1 | `generic_value` integration, no value | publish **rejected** |
| D2 | `generic_value` integration, with value | publish **accepted** |
| D3 | `account_select_optional` integration, no value | publish **accepted** (value not required) |
| D4 | `key_value` integration, missing key name | publish **rejected** |
| D5 | `key_value` integration, missing value | publish **rejected** |
| D6 | `key_value` integration, key + value | publish **accepted** |
| E  | Publish a ready project, then revert | state → published → ready; flags flip |

### DR. Date-range validation (`to` must be on/after `from`) — enforced by the API on create/update
The API (`CrudService.assertDateRanges`) rejects inverted date pairs, mirroring the web form.
Pairs: **Project** `amcFrom → amcTo`, **Vendor Service** `startDate → expiryDate`.
(Servers `configuredDate`, Reminders `scheduledDateTime`, and the checklist `submitted date`
are single dates — no range to validate.)

| # | Scenario | Expected |
|---|---|---|
| DR1 | Project create, `amcTo` < `amcFrom` | **400 rejected** |
| DR2 | Project create, valid AMC dates | created |
| DR3 | Project PATCH `amcTo` earlier than stored `amcFrom` | **400 rejected** (merge-checked) |
| DR4 | Vendor service create, `expiryDate` < `startDate` | **400 rejected** |
| DR5 | Vendor service create, valid dates | created |

### F–G. Excel export / import
- **F** Bundle export structure: `Projects` / `Environments` / `Reference` sheets exist;
  `Projects` exposes `pocEmail`, hides `id`/`pocUserId`, keeps `importUid`; `Environments`
  exposes `projectName`, hides `projectId`.
- **G** Import idempotency: a row created via import receives a stable `importUid`, so
  re-importing the same file **updates** instead of **duplicating** (regression test for the
  import-duplication bug).

### H. Full CRUD + Export/Import for every resource
For each of servers, git-providers, integration-types, accounts, clients, vendors,
vendor-services, reminders, environments, integrations: **create → get → list → update →
export+re-import (idempotent) → delete → confirm gone**. This exercises the New / Save / Edit /
Export / Import / Delete buttons on every screen.

### I. Special actions
- Jobs: create auto-assigns a `QUT####` id.
- Notifications: **Run reminders now** and **Purge old** endpoints return 2xx.
- Users: create (admin); **duplicate email → 409** (not 500); a deleted user's **email is
  reusable** (restore-on-recreate).
- Invites: **Send invite** returns an `acceptUrl` + token; the public token lookup works.
- Integration identifier **suggestions**: distinct prior values for a type are queryable
  (source data for the autocomplete on the Identifier / Config ID field).

### J. Dashboard + create robustness
- `GET /dashboard/stats` returns the full shape (servers, projects, environments, byPoc, jobbag)
  and the counts are internally consistent (`unpublished = total - published`). Computed in a
  constant number of queries so it scales to thousands of rows.
- Creating a server with **empty optional fields** (provider/panel/status) succeeds — status
  falls back to its default (`active`) instead of 500ing on a NOT NULL column.
- A **genuinely-required** field left empty (serverName) returns a clean **400**, not a 500.

## Notes
- **Integration form (UI):** the fields shown depend on the integration type's `behavior`:
  `generic_value` → **Identifier / Config ID**; `key_value` → **Key name** + **Value**;
  `account_select_optional` → **Account**. Unused fields are nulled on save. The key/identifier
  inputs autocomplete from prior values for that type (a `<datalist>`) so the same key is reused
  instead of duplicated. (API side asserted by D1–D6 + the suggestion-source checks in I; the
  field visibility/datalist itself is verified manually.)
- The publish-readiness **rule lives in the API** (`apps/api/src/infra/projects.module.ts`,
  `ProjectsService.readiness`) — that is the single source of truth and is what this suite
  asserts. The web UI mirrors it for button/badge state only.
- This suite does not (yet) drive the browser UI; it verifies the backend contract the UI
  depends on. Run alongside manual UI spot-checks for visual/UX changes.
