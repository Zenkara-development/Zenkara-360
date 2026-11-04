# Deploy Zenkara 360 on Ubuntu (domain + HTTPS)

Server: Ubuntu 26.04 on AWS EC2, Elastic IP `65.1.105.78`, domain pointed to it with Route 53.
Repo: `https://github.com/Zenkara-development/Zenkara-360`

- Run everything as **root** (`sudo su`).
- Paste one block at a time and check its output before the next.
- If you reconnect to SSH halfway through, run step 0 again first. The other steps use `$DOMAIN`.

```
Browser → https://DOMAIN → nginx ─┬─ /      → React build   /opt/zenkara360/client/dist
                                  └─ /api/  → Node API      127.0.0.1:4000 (systemd: zenkara360-api)
                                              PostgreSQL    127.0.0.1:5432 (database zenkara360)
```

> **Security group:** keep only **22 (SSH), 80 and 443** open. With "all ports" open, the API's port 4000 is reachable directly from the internet, bypassing nginx and HTTPS.

## Step 0 — Set your domain (in every new SSH session)

```bash
export DOMAIN=360.zenkara.in
export EMAIL=zenkaratech@gmail.com      # Let's Encrypt expiry notices
getent ahostsv4 $DOMAIN | head -1       # must show 65.1.105.78
```

## Step 1 — Server setup: packages, swap, Node.js 22

```bash
apt update && apt -y upgrade
apt install -y curl git unzip ca-certificates gnupg openssl nginx postgresql certbot python3-certbot-nginx

fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt install -y nodejs

node -v && npm -v && psql --version && nginx -v
```

If NodeSource refuses your Ubuntu version, run `apt install -y nodejs npm` instead. `node -v` must be 20 or newer.

## Step 2 — Clone the project

```bash
git clone https://github.com/Zenkara-development/Zenkara-360.git /opt/zenkara360
cd /opt/zenkara360 && git log --oneline -1
```

**If it asks for a username, the repo is private.** Press Ctrl+C and use a read-only deploy key instead:

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/zenkara360_deploy -C "zenkara360-server"
cat /root/.ssh/zenkara360_deploy.pub
# GitHub → Zenkara-360 → Settings → Deploy keys → Add deploy key → paste (write access OFF)
printf 'Host github.com\n  IdentityFile /root/.ssh/zenkara360_deploy\n  IdentitiesOnly yes\n' >> /root/.ssh/config
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts
git clone git@github.com:Zenkara-development/Zenkara-360.git /opt/zenkara360
```

## Step 3 — Create the database and server/.env

This creates database `zenkara360` with a random password and writes `server/.env` with new random secrets. Nothing secret is printed.

```bash
DB_PASS=$(openssl rand -hex 24)
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE zenkara360 LOGIN PASSWORD '$DB_PASS';"
sudo -u postgres createdb -O zenkara360 zenkara360
r() { openssl rand -hex 64; }
umask 077
cat > /opt/zenkara360/server/.env <<EOF
NODE_ENV="production"
PORT="4000"
DATABASE_URL="postgresql://zenkara360:$DB_PASS@127.0.0.1:5432/zenkara360"
JWT_SECRET="$(r)"
JWT_EXPIRES_IN="15m"
ENCRYPTION_KEY="$(r)"
QUOTE_SHARE_SECRET="$(r)"
WORKFLOW_WEBHOOK_SECRET="$(r)"
APP_URL="https://$DOMAIN"
FRONTEND_URL="https://$DOMAIN"
CORS_ORIGIN="https://$DOMAIN"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="zenkaratech@gmail.com"
SMTP_PASS=""
SMTP_FROM="Zenkara 360 <zenkaratech@gmail.com>"
ADMIN_NOTIFY_EMAIL="zenkara360superadmin@gmail.com"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GROQ_API_KEY=""
OPENAI_API_KEY=""
S3_BUCKET=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
S3_REGION=""
S3_ENDPOINT=""
DEMO_RESET_SECRET=""
DIRECTORY_SYNC_SECRET=""
PLATFORM_BOOTSTRAP_SECRET=""
SEED_ADMIN_EMAIL=""
SEED_CRM_EMAIL=""
SEED_SALES_EMAIL=""
SEED_ITMANAGER_EMAIL=""
SEED_ITAGENT_EMAIL=""
SEED_PASSWORD=""
EOF
chmod 600 /opt/zenkara360/server/.env
umask 022
unset DB_PASS
sudo -u postgres psql -lqt | cut -d'|' -f1 | grep -w zenkara360 && echo "database + .env ready"
```

Then add your keys with `nano /opt/zenkara360/server/.env`. To save, press Ctrl+O, then Enter, then Ctrl+X.
- `SMTP_PASS`: the 16-character Gmail **App Password** for zenkaratech@gmail.com (Google Account → Security → App passwords). Without it, no emails go out, including signup approval emails.
- `GROQ_API_KEY` or `OPENAI_API_KEY`: needed for the AI features and the robot chat.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: only if you use Google sign-in.

## Step 4 — Install, create tables, build

```bash
cd /opt/zenkara360
npm ci
cd server && npx prisma generate && npx prisma migrate deploy && cd ..
NODE_OPTIONS=--max-old-space-size=3072 npm run build --workspace=server
NODE_OPTIONS=--max-old-space-size=2048 VITE_API_URL=/api npm run build --workspace=client
ls -l server/dist/index.js client/dist/index.html
```

## Step 5 — Run the API as a service

```bash
useradd --system --home /opt/zenkara360 --shell /usr/sbin/nologin zenkara360
cat > /etc/systemd/system/zenkara360-api.service <<'EOF'
[Unit]
Description=Zenkara 360 API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=zenkara360
WorkingDirectory=/opt/zenkara360/server
EnvironmentFile=/opt/zenkara360/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now zenkara360-api
sleep 5 && curl -s http://127.0.0.1:4000/health
```

You should see `{"status":"ok","db":"connected",...}`. If not, check `journalctl -u zenkara360-api -n 50 --no-pager`.

## Step 6 — nginx for your domain

```bash
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s|/opt/zenkara-crm|/opt/zenkara360|g" /opt/zenkara360/deploy/nginx-site.conf > /etc/nginx/sites-available/zenkara360
ln -sf /etc/nginx/sites-available/zenkara360 /etc/nginx/sites-enabled/zenkara360
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
curl -sI http://$DOMAIN/ | head -1          # expect HTTP/1.1 200 OK
```

## Step 7 — HTTPS (free Let's Encrypt certificate, auto-renews)

```bash
certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect
nginx -t && systemctl reload nginx
curl -sI https://$DOMAIN/ | head -1         # expect HTTP/2 200
systemctl list-timers certbot.timer --no-pager | head -3
```

Open **https://your-domain** and you should see the login page.

## Step 8 — Create your platform super admin

The **leading space** before `npm` keeps the password out of the shell history.

```bash
cd /opt/zenkara360/server
 npm run platform:admin -- --email zenkara360superadmin@gmail.com --password 'YOUR-PASSWORD' --name "Platform Admin"
```

Sign in at `https://your-domain` with that account; it goes to the Platform Admin console. Companies register with **Create account**, and you approve them from the email (this needs `SMTP_PASS`).

*Optional: demo companies.*
1. Fill in the `SEED_*` lines in `server/.env`. If you skip this, the demo uses public default logins.
2. Run `cd /opt/zenkara360 && npm run db:seed --workspace=server`.

## Step 9 — One-command updates

```bash
cat > /usr/local/bin/zenkara360-redeploy <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/zenkara360
git pull --ff-only
npm ci
(cd server && npx prisma generate && npx prisma migrate deploy)
NODE_OPTIONS=--max-old-space-size=3072 npm run build --workspace=server
NODE_OPTIONS=--max-old-space-size=2048 VITE_API_URL=/api npm run build --workspace=client
systemctl restart zenkara360-api
systemctl reload nginx
echo "Deployed $(git rev-parse --short HEAD)"
EOF
chmod +x /usr/local/bin/zenkara360-redeploy
```

From now on, after each `git push` from your PC, run **`zenkara360-redeploy`** on the server.

## Step 10 — Nightly database backup (14 days kept)

```bash
mkdir -p /var/backups/zenkara360 && chown postgres /var/backups/zenkara
cat > /etc/cron.d/zenkara360-backup <<'EOF'
30 2 * * * postgres pg_dump -Fc zenkara360 > /var/backups/zenkara360/zenkara360-$(date +\%F).dump && find /var/backups/zenkara360 -name '*.dump' -mtime +14 -delete
EOF
```

To restore a backup: `sudo -u postgres pg_restore --clean -d zenkara360 /var/backups/zenkara360/<file>.dump`

## Everyday commands

| Task | Command |
|---|---|
| API status / live logs | `systemctl status zenkara360-api` · `journalctl -u zenkara360-api -f` |
| Restart API (after editing .env) | `systemctl restart zenkara360-api` |
| Deploy new code | `zenkara360-redeploy` |
| nginx test + reload | `nginx -t && systemctl reload nginx` |
| Database shell | `sudo -u postgres psql zenkara360` |
| Certificate status | `certbot certificates` |
| Disk / memory | `df -h` · `free -h` |

## Troubleshooting

- **502 Bad Gateway:** the API is down. Run `journalctl -u zenkara360-api -n 80 --no-pager`. A "FATAL: refusing to start" message names the missing `.env` value.
- **certbot fails:** DNS isn't pointing here yet (`getent ahostsv4 $DOMAIN`), or port 80 is blocked.
- **Build killed / out of memory:** check that swap is on (`free -h`), or use a bigger instance.
- **Login works but emails don't arrive:** `SMTP_PASS` is missing or wrong. Restart the API after fixing it.
