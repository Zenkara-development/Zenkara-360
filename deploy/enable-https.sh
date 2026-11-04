#!/usr/bin/env bash
# One-time: put the CRM's domain on HTTPS with a free Let's Encrypt certificate.
#
# Why this is not optional: browsers refuse getUserMedia (face verification
# camera), geolocation (geofenced check-in, live location), service workers
# (PWA install, push nudges) on plain http:// — no prompt is ever shown, the
# camera box just stays black. Only https:// (and localhost) get those APIs.
#
# certbot's nginx plugin edits /etc/nginx/sites-available/zenkara-crm in
# place: it adds a `listen 443 ssl` server with the certificate paths and
# turns the existing `listen 80` server into a redirect. Renewal is handled by
# the systemd timer certbot installs (twice daily; certs last 90 days).
#
# Run as root on the instance, after DNS for the domain points here and the
# security group allows inbound 80 and 443:
#
#   sudo bash /opt/zenkara-crm/deploy/enable-https.sh zenkaratech@gmail.com
set -euo pipefail
EMAIL="${1:?usage: enable-https.sh <email-for-expiry-notices>}"
# The domain comes from the nginx site setup-server.sh wrote, unless given.
DOMAIN="${DOMAIN:-$(awk '/server_name/ {gsub(";",""); print $2; exit}' /etc/nginx/sites-available/zenkara-crm)}"
[ -n "$DOMAIN" ] || { echo "Set DOMAIN=crm.example.com" >&2; exit 1; }

apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
nginx -t && systemctl reload nginx
systemctl list-timers certbot.timer --no-pager | head -3
echo
echo "Done. Check: curl -sI https://$DOMAIN/ | head -1   (expect HTTP/2 200)"
echo "server/.env already uses https://$DOMAIN for APP_URL, FRONTEND_URL and CORS_ORIGIN (setup-server.sh)."
