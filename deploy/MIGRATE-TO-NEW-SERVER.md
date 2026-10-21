# InfraMatrix — Migrate to a New Server (lift-and-shift)

This is the **server-to-server migration** runbook (move an existing, working install to a new
box). For a *first-ever* install from scratch, use **DEPLOY.md** instead. For routine code
releases on an existing box, use **DEPLOY.md §7**.

> **What "migration" means here:** you copy the existing **code folder** and a **dump of the DB**
> to the new server, then re-wire it. The DB already has the full schema + data + every migration
> baked in — so **you do NOT run the seed and you do NOT run any `deploy/migrations/*.sql`** on the
> new box. Those are only for first-time setup / new releases.

The app is one Node process (PM2) on `127.0.0.1:3035` serving UI + API + uploads; CloudPanel
terminates HTTPS and reverse-proxies to that port. (Same single-port model as DEPLOY.md.)

---

## 0. Before you start — on the OLD server
1. **Dump the database:**
   ```bash
   mysqldump -u <db-user> -p inframatrix > inframatrix.sql
   ```
2. **Copy the uploads** (logos / attachments live on disk, NOT in the DB):
   `apps/api/uploads/` — make sure this directory comes across. (If it only contains `.gitkeep`,
   there are no uploads yet — nothing to migrate.)
3. Copy the whole project folder (or just `git clone` fresh on the new box — cleaner; see step 2).
4. Note your DB credentials and JWT secrets if you want existing logins to keep working.

> ⚠️ **Do NOT copy `node_modules` between machines.** It contains native binaries + symlinks built
> for the old OS/arch and will break the build (`Cannot find module '../lib/tsc.js'`). If you copied
> the whole folder, you'll delete and reinstall `node_modules` in step 3 anyway.

---

## 1. Create the database on the NEW server
**CloudPanel → Databases → Add Database:**
- Database name: `inframatrix`
- DB user + strong password, granted to that DB.

Then **import the dump** from the old server:
```bash
mysql -u <db-user> -p inframatrix < inframatrix.sql
```
Verify it came across:
```bash
mysql -u <db-user> -p inframatrix -e "SHOW TABLES; SELECT COUNT(*) AS users FROM core_users;"
```
You should see ~30+ tables and a user count > 0.

> The user in `core_users` is the app's login. The MySQL user (above) is separate — keep the two
> straight. The app connects over `127.0.0.1` (MySQL is local on the server).

---

## 2. Get the code onto the NEW server
Either copy the folder you brought over, or (cleaner) clone fresh and only bring `.env` + `uploads`:
```bash
cd /home/<site-user>/htdocs
git clone <your-repo> <site-domain> && cd <site-domain>
# then copy apps/api/uploads/ and (a corrected) apps/api/.env into place
```

---

## 3. Clean install dependencies (NEVER reuse copied node_modules)
```bash
cd /home/<site-user>/htdocs/<site-domain>
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm install
```
A clean install rebuilds the `.bin` symlinks and native modules for THIS server. (A successful run
reports "added ~925 packages", not "added 2 packages" — the latter means stale modules were left in
place.)

The `npm warn deprecated` lines and the `npm audit` count are transitive-dependency noise — **do not**
run `npm audit fix --force` (it makes breaking changes). Leave it.

---

## 4. Configure the environment (the #1 source of migration bugs)
`apps/api/.env` is gitignored, so it gets hand-copied — and the copied one is usually the *dev* file.
Write a correct production `.env`. This one-shot generates the JWT secrets and writes the file:

```bash
cd /home/<site-user>/htdocs/<site-domain>

ACCESS=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
REFRESH=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

cat > apps/api/.env <<EOF
NODE_ENV=production
PORT=3035
WEB_ORIGIN=https://<your-domain>

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=<db-user>
DB_PASSWORD=<db-password>
DB_DATABASE=inframatrix

JWT_ACCESS_SECRET=$ACCESS
JWT_ACCESS_TTL=900s
JWT_REFRESH_SECRET=$REFRESH
JWT_REFRESH_TTL=30d

MAIL_HOST=
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=
MAIL_PASS=
MAIL_FROM=no-reply@<your-domain>
EOF
```
> **Tip:** paste the block flush-left. If your lines are indented, the closing `EOF` must also be
> flush-left or the heredoc won't terminate. The parser tolerates leading spaces and ignores a stray
> `EOF` line, but a clean file is easier to read.

Sanity-check it:
```bash
head -1 apps/api/.env          # MUST be exactly:  NODE_ENV=production
grep -E 'WEB_ORIGIN|DB_PASSWORD|JWT_ACCESS_SECRET' apps/api/.env
```

`apps/web/.env` (build-time, relative API base) should be:
```
VITE_API_URL=/api/v1
```

**Checklist of things that are wrong in a copied dev `.env`:**
- [ ] `NODE_ENV=production` (dev file sometimes has a stray command pasted on this line)
- [ ] `WEB_ORIGIN` = your real https domain (not `localhost`)
- [ ] `DB_HOST=127.0.0.1` (the WSL "Windows host IP" note does NOT apply on a Linux server)
- [ ] `DB_PASSWORD` exactly matches the MySQL user's password on THIS server
- [ ] Strong, fresh `JWT_*_SECRET` values

---

## 5. Build (web first, then API)
```bash
cd /home/<site-user>/htdocs/<site-domain>
npm run web:build      # → apps/web/dist  (the API serves these static files)
npm run api:build      # → apps/api/dist
```
Web must build before the API starts (the API serves the UI from `apps/web/dist`).

---

## 6. Install PM2 (user-local — the site user has no sudo)
On CloudPanel, Node/npm exist **only** for the site user (per-user nvm), and `root` has no `npm` in
its PATH. So install PM2 into the site user's home — **as the site user, NOT root, NOT sudo:**
```bash
cd ~
npm config set prefix ~/.npm-global
npm install -g pm2
echo 'export PATH=$HOME/.npm-global/bin:$PATH' >> ~/.bashrc
export PATH=$HOME/.npm-global/bin:$PATH
pm2 -v            # prints a version
which node        # note this path — needed for the startup step
```

---

## 7. Start the app under PM2 (as the site user)
```bash
cd /home/<site-user>/htdocs/<site-domain>/apps/api
pm2 start dist/main.js --name inframatrix --cwd "$(pwd)" --update-env
pm2 logs inframatrix --lines 30      # look for "Nest application successfully started" + no DB error
```
Verify locally:
```bash
curl -s http://127.0.0.1:3035/api/v1/health ; echo     # → {"status":"ok","service":"infra-v2 api"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3035/   # → 200 (UI)
```
If you see `ER_ACCESS_DENIED`, the `.env` `DB_PASSWORD` ≠ the MySQL password — fix it and
`pm2 restart inframatrix --update-env`.

---

## 8. Make it survive reboots (needs the root shell ONCE)
As the **site user**:
```bash
pm2 save
pm2 startup
```
`pm2 startup` prints a line like:
```
sudo env PATH=$PATH:/home/<site-user>/.nvm/versions/node/<ver>/bin pm2 startup systemd -u <site-user> --hp /home/<site-user>
```
**Copy that whole line, switch to your root shell, and run it there** (root needs no password). Then,
back as the site user, run `pm2 save` once more.

> ⚠️ The startup service MUST be registered for `<site-user>`, not `root`. A bare `pm2 startup` run as
> root creates `pm2-root.service`, which resurrects root's (empty) list — so the app does NOT come
> back on reboot. Confirm: `systemctl is-enabled pm2-<site-user>` → `enabled`.

---

## 9. CloudPanel site, SSL & DNS
1. **Site type = Node.js** (CloudPanel → Sites). Set **Node.js Version = Node 22 LTS** and
   **App Port = 3035** (must match `PORT`). Save. A Node.js site auto-generates the HTTPS
   reverse-proxy to `127.0.0.1:3035` — you usually do **not** need to paste a custom vhost.
2. **Point DNS** for the domain at the new server's IP. (Do this early so SSL issuance works.)
3. **Site → SSL/TLS → issue Let's Encrypt.**
4. *(Optional)* If you upload large logos / xlsx, add `client_max_body_size 25m;` via the Vhost tab,
   or paste `deploy/cloudpanel-vhost.conf` (set `server_name`).

Browser test:
```
https://<your-domain>/api/v1/health    → {"status":"ok","service":"infra-v2 api"}
https://<your-domain>/                 → app loads
```

---

## 10. Cut-over & cleanup
- [ ] Log in with your **existing** credentials (they came over in the DB). If this DB still uses the
      default `admin@infra-v2.local` / `Admin@123`, change it now.
- [ ] Schedule `mysqldump` backups on the NEW box (the old server's cron did not migrate).
- [ ] **Stop the OLD server's PM2** (`pm2 delete inframatrix` / shut it down) so two schedulers don't
      both fire reminder emails against the same data.
- [ ] Keep the OLD server (and your DB dump) until you've confirmed the new one for a few days.

---

## Why each non-obvious step exists (the gotchas)
- **Reinstall node_modules:** copied modules carry old-arch native binaries + broken `.bin` symlinks
  (`Cannot find module '../lib/tsc.js'`). `npm install` over them only fills gaps.
- **Rebuild:** the served `apps/web/dist` is a static bundle; it must be rebuilt on the new box.
- **No seed / no migrations:** the imported DB already has schema + data + all migrations.
- **PM2 user-local:** the site user owns Node (per-user nvm) and has no sudo; root has no npm.
- **App Port = PORT:** CloudPanel's Node.js site proxies HTTPS to that exact port.
- **Uploads + DNS:** the two things most often forgotten — files on disk, and the DNS cut-over.
