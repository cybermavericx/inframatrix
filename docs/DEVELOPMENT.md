# Development notes

How changes are made and checked in this repo, plus lessons from past work. README.md covers what
the app is and how to run it; DEPLOY.md covers servers and releases.

## Workflow
1. **Assess:** read the code involved, reproduce the bug, write down facts with evidence.
2. **Plan:** what changes, where, the risks and how it will be tested. The maintainer approves before
   any code is written.
3. **Develop:** one branch per change from an up-to-date `main` (`feat/…`, `fix/…`, `docs/…`).
   Always branch from `main`; never stack a PR on another PR's branch, because a stacked PR merges
   into that branch, not into `main`.
4. **Local QA:** both builds, lint compared with `main`, the QA suites on a scratch database, and a
   browser check of the changed screens (below).
5. **PR:** push the branch and open a PR to `main` with what changed and the real QA output. The
   maintainer reviews and merges.
6. **Release:** add a `DEPLOY.md` section for anything that needs server steps (migration yes/no,
   build commands, checks, rollback).

## Local QA
- **Builds:** `npm run web:build` (tsc + vite) and `npm run api:build` (nest).
- **Lint:** the repo still has older lint findings, so compare against `main`: a change must not add
  findings. For Prettier findings in a file you touched, `npx eslint --fix <file>` on that file only.
- **QA suites** (`qa/*.mjs`): plain Node scripts that call the API and print each check. Run them
  against a **scratch database**, never a real one:
  ```bash
  QA_BASE=http://127.0.0.1:<port>/api/v1 node qa/<suite>.mjs
  ```
  Without `QA_BASE` the suites use `http://localhost:3000/api/v1`. When Node runs on Windows and the
  shell is WSL, environment variables don't cross over by default; pass them with
  `WSLENV=QA_BASE QA_BASE=… node.exe qa/<suite>.mjs`.
- `qa/seed-samples.mjs` is **not** a test: it adds persistent "QA Sample" records. Don't run it in a
  loop over all suites.
- **Browser check:** build the web app, open the changed screens, and try them with mouse and
  keyboard. Use made-up data. If a check clicks Delete, make sure it targets a throwaway record.

## Lessons from past changes
- **Menus inside scrolling or sticky containers get clipped.** Render popup menus into
  `document.body` with a portal (the list row ⋯ menu does this).
- **List state must not leak between lists.** `CrudPage` is keyed by its endpoint in `App.tsx`, so
  each resource gets fresh filter and search state.
- **Large lists:** memoize filtered rows, defer the search input (`useDeferredValue`), keep column
  definitions as module constants, and memoize row components. Measure before and after with the
  React profiler instead of guessing.
- **Mark paid** fills Period from/to when they are empty, and the next cycle's period follows on
  from the paid one. `qa/payment-period.mjs` covers it.
- **Notes** (`/notes`) are allowed or refused by the permissions of the record they belong to (the
  `ENTITY_RESOURCE` map). Only the author, or a notes moderator, can edit or delete a note; edits
  and deletes are written to the audit log. `qa/notes.mjs` covers it.
- **Deleting a record should also remove its notes and waiting reminders.** Check this whenever a
  new kind of record can have notes.
- **State facts, not guesses:** report what was run and what it printed. "Not reproduced" and
  "not measured" are valid results.
