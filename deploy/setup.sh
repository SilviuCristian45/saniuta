#!/usr/bin/env bash
# Prima instalare Săniuța la vale pe VPS (Ubuntu). Rulează pe server, din folderul deploy/ copiat acolo:
#   sudo bash ~/saniuta-deploy/setup.sh      (folderul stă în /home/ubuntu/saniuta-deploy)
# Idempotent: îl poți rula de mai multe ori. Atinge doar ce ține de saniuta (user-ul saniuta,
# /opt/saniuta, /var/www/saniuta, /var/lib/saniuta, saniuta.service, saniuta-backup.{service,timer},
# /usr/local/sbin/saniuta-backup și blocul saniuta-la-vale.duckdns.org din Caddyfile).
# Celelalte site-uri și servicii (vezi VPS-INVENTORY.md din skill-ul vps-deploy) rămân
# neatinse: nici nu sunt repornite, Caddy primește doar reload.
# Codul jocului NU vine de aici: îl pune deploy/push.ps1 (de pe Windows), care îl și pornește.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Rulează cu sudo: sudo bash $0" >&2; exit 1; fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DOMAIN=saniuta-la-vale.duckdns.org
APP_USER=saniuta
BASE=/opt/saniuta
WEB=/var/www/saniuta
UNIT=saniuta
UNIT_FILE=/etc/systemd/system/$UNIT.service
BACKUP_UNIT=saniuta-backup
BACKUP_SCRIPT=/usr/local/sbin/saniuta-backup
STATE=/var/lib/saniuta
PORT=2570
CADDYFILE=/etc/caddy/Caddyfile
NODE_MAJOR=22
NODE_MINOR=12 # the server needs Node >= 22.12

say() { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!! %s\n' "$*" >&2; }
die() { printf '\nEROARE: %s\n' "$*" >&2; exit 1; }

for f in "$HERE/saniuta.service" "$HERE/Caddyfile" "$HERE/saniuta-backup.service" "$HERE/saniuta-backup.timer" "$HERE/saniuta-backup.sh"; do
  [ -f "$f" ] || die "Lipsește $f. Copiază pe server tot folderul deploy/ (vezi deploy/README.md)."
done
command -v apt-get >/dev/null || die "Scriptul e pentru Ubuntu/Debian (apt-get)."

# 0. Memoria: VPS-ul are 1 GB și e comun cu alte proiecte.
say "Memorie și swap"
free -h
if swapon --show --noheadings | grep -q .; then
  swapon --show
else
  warn "Nu e niciun swap activ. Pe 1 GB RAM e bine să existe (ex. un swapfile de 1 GB); scriptul nu îl creează."
fi
avail_mb="$(free -m | awk '/^Mem:/ {print $7}')"
if [ "${avail_mb:-0}" -lt 300 ]; then
  warn "Doar ${avail_mb} MB disponibili; $UNIT poate folosi până la 150M (MemoryMax)."
fi

# 1. Node >= 22.12 în /usr/bin/node (calea din saniuta.service). NodeSource e același depozit ca la
# celelalte proiecte: dacă Node e deja la zi, nu se instalează nimic.
node_ok() {
  /usr/bin/node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>$NODE_MAJOR||(a===$NODE_MAJOR&&b>=$NODE_MINOR)?0:1)" 2>/dev/null
}
say "Verific Node.js"
if node_ok; then
  echo "Node $(/usr/bin/node -v) în /usr/bin/node: ok"
else
  say "Instalez Node.js $NODE_MAJOR din depozitul NodeSource"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gpg >/dev/null
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
  node_ok || die "Node >= $NODE_MAJOR.$NODE_MINOR nu s-a instalat în /usr/bin/node."
  echo "Instalat: Node $(/usr/bin/node -v)"
fi

# 2. Portul: 2570 trebuie să fie liber sau deja al nostru (porturile luate: VPS-INVENTORY.md).
say "Portul $PORT"
if ss -ltnp 2>/dev/null | grep -q ":$PORT "; then
  if systemctl is-active --quiet "$UNIT"; then
    echo "$PORT e folosit de $UNIT: ok"
  else
    ss -ltnp | grep ":$PORT " || true
    die "Portul $PORT e ocupat de alt proces; $UNIT nu ar putea porni."
  fi
else
  echo "$PORT e liber"
fi

# 3. User de sistem și directoare
say "User și directoare"
if id "$APP_USER" >/dev/null 2>&1; then
  echo "user-ul $APP_USER există deja"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  echo "am creat user-ul $APP_USER"
fi
# Codul aparține lui root; serviciul îl poate doar citi.
install -d -o root -g root -m 755 "$BASE" "$BASE/releases"
# /var/www/saniuta e un symlink către versiunea activă a clientului (îl comută push.ps1 odată cu serverul).
if [ -L "$WEB" ]; then
  echo "$WEB -> $(readlink "$WEB")"
else
  if [ -e "$WEB" ]; then
    moved="$WEB.old-$(date +%Y%m%d-%H%M%S)"
    mv "$WEB" "$moved"
    warn "$WEB era un folder obișnuit; l-am mutat în $moved"
  fi
  install -d -o root -g root -m 755 "$(dirname "$WEB")"
  ln -s "$BASE/current/client" "$WEB"
  echo "$WEB -> $BASE/current/client"
fi

# 4. systemd
say "Serviciul systemd $UNIT"
unit_changed=0
if ! tr -d '\r' < "$HERE/saniuta.service" | cmp -s - "$UNIT_FILE"; then
  # Poate veni de pe Windows: fără CRLF.
  tr -d '\r' < "$HERE/saniuta.service" > "$UNIT_FILE.tmp"
  install -o root -g root -m 644 "$UNIT_FILE.tmp" "$UNIT_FILE"
  rm -f "$UNIT_FILE.tmp"
  unit_changed=1
  echo "am instalat $UNIT_FILE"
else
  echo "$UNIT_FILE e deja la zi"
fi
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1
if [ -f "$BASE/current/server/index.js" ]; then
  # Un restart pierde room-urile în curs: doar dacă unit-ul s-a schimbat.
  if [ "$unit_changed" = 1 ]; then systemctl restart "$UNIT"; else systemctl start "$UNIT"; fi
  # Node needs a few seconds to start (and open the leaderboard): wait up to 15 s.
  up=0
  for _ in $(seq 1 15); do
    sleep 1
    if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health"; then echo; up=1; break; fi
  done
  if [ "$up" = 0 ]; then warn "Serverul nu răspunde. Vezi: journalctl -u $UNIT -n 50 --no-pager"; fi
else
  echo "Încă nu e nicio versiune instalată: serviciul pornește la primul deploy/push.ps1."
fi

# 5. Backup zilnic al clasamentului (/var/lib/saniuta/leaderboard.db -> /var/lib/saniuta/backups, ultimele 7 zile).
# Baza o creează serverul la pornire, în StateDirectory (al user-ului saniuta); deploy-ul și rollback-ul
# lucrează doar în /opt/saniuta, deci nu o ating niciodată.
say "Backup zilnic al clasamentului"
if ! command -v sqlite3 >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq sqlite3 >/dev/null
  echo "am instalat sqlite3"
else
  echo "sqlite3 există deja"
fi
# Scriptul vine poate de pe Windows: fără CRLF.
tr -d '\r' < "$HERE/saniuta-backup.sh" > "$BACKUP_SCRIPT.tmp"
install -o root -g root -m 755 "$BACKUP_SCRIPT.tmp" "$BACKUP_SCRIPT"
rm -f "$BACKUP_SCRIPT.tmp"
for f in "$BACKUP_UNIT.service" "$BACKUP_UNIT.timer"; do
  tr -d '\r' < "$HERE/$f" > "/etc/systemd/system/$f.tmp"
  install -o root -g root -m 644 "/etc/systemd/system/$f.tmp" "/etc/systemd/system/$f"
  rm -f "/etc/systemd/system/$f.tmp"
done
systemctl daemon-reload
systemctl enable --now "$BACKUP_UNIT.timer" >/dev/null 2>&1
echo "$BACKUP_UNIT.timer: următoarea rulare $(systemctl show "$BACKUP_UNIT.timer" --property=NextElapseUSecRealtime --value)"
if [ -d "$STATE" ]; then ls -la "$STATE"; fi

# 6. Caddy: blocul pentru domeniu, doar dacă lipsește
say "Caddy ($DOMAIN)"
command -v caddy >/dev/null || die "Caddy nu e instalat (pe acest VPS ar trebui să existe deja, pentru celelalte site-uri)."
[ -f "$CADDYFILE" ] || die "Nu găsesc $CADDYFILE."

# Validează cu variabilele de mediu ale serviciului caddy (alte site-uri pot folosi {$VAR}).
validate_caddy() (
  set -a
  for f in $(systemctl show caddy --property=EnvironmentFiles --value | grep -o '/[^ ]*' || true); do
    if [ -r "$f" ]; then . "$f"; fi
  done
  set +a
  # shellcheck disable=SC2046
  env $(systemctl show caddy --property=Environment --value) caddy validate --config "$CADDYFILE" --adapter caddyfile
)

if grep -Eq "^[[:space:]]*(https?://)?$DOMAIN([[:space:]:,{]|\$)" "$CADDYFILE"; then
  echo "Blocul pentru $DOMAIN există deja în $CADDYFILE: nu îl modific."
else
  validate_caddy >/dev/null 2>&1 || die "Caddyfile-ul existent nu trece validarea; nu îl modific. Verifică: sudo caddy validate --config $CADDYFILE"
  backup="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CADDYFILE" "$backup"
  echo "backup: $backup"
  { printf '\n'; tr -d '\r' < "$HERE/Caddyfile"; } >> "$CADDYFILE"
  if ! validate_caddy; then
    cp -a "$backup" "$CADDYFILE"
    die "Caddyfile-ul cu blocul nou nu trece validarea; am restaurat backup-ul. Caddy nu a fost reîncărcat."
  fi
  systemctl reload caddy
  echo "Am adăugat blocul pentru $DOMAIN și am reîncărcat Caddy (reload, fără restart: celelalte site-uri nu au nicio întrerupere)."
fi

say "Memorie după instalare"
free -h

cat <<EOF

==> GATA. Ce urmează:
  1. De pe Windows, din repo:  .\\deploy\\push.ps1      (build, upload, pornește serviciul, health check)
  2. DuckDNS: $DOMAIN trebuie să arate spre IP-ul acestui VPS.
  3. Porturile 80 și 443 sunt deja deschise (le folosesc celelalte site-uri). Portul $PORT NU se deschide.
  Clasamentul: $STATE/leaderboard.db; backup manual: sudo systemctl start $BACKUP_UNIT
EOF
