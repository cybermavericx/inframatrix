# CLAUDE.md — InfraMatrix (open-source edition)

See **README.md** (what the app is + how to run) and **DEPLOY.md** (ship to a server).

## Branding rule (open-source edition — must hold for every change)
This is the author's **personal open-source showcase**. The UI footer, auth screens and email template
credit **Muhammed Noufal** with links to muhammednoufal.cybermavericx.com, cybermavericx.com and
github.com/cybermavericx/inframatrix. All branding text lives in **two files only**:
`apps/web/src/branding.ts` (UI footer) and `apps/api/src/branding.ts` (email footer). `Footer.tsx` and
`mail/template.ts` just read them and are identical in both editions; when porting a commit between
editions, leave both `branding.ts` files out. A separate company build exists elsewhere — never bring any employer
name, domain, email, server, data or DB dump into this repo.

## Gotchas
- Dev seed drops the schema (`NODE_ENV !== 'production'`); on a server use
  `NODE_ENV=production node dist/database/seed.js` (additive).
- UI changes need `npm run web:build` — the prebuilt `apps/web/dist` is served by the API on port 3035.
- Local DB: Laragon MySQL on Windows, reached from WSL via the Windows host IP (`DB_HOST`).
