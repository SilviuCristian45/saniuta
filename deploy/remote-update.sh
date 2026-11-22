#!/usr/bin/env bash
# Run on the VPS by deploy/push.ps1 (as the SSH user, with sudo). Not meant to be run by hand,
# though `bash remote-update.sh rollback` works from the folder push.ps1 uploads to.
#   deploy   unpack release.tar.gz into a new release folder, switch to it, restart, health check;
#            if the server does not come up healthy, switch back to the previous release
#   rollback switch back to the previous release (current.prev), restart, health check
#
# Layout: /opt/saniuta/releases/<id>/{server/index.js,client/,VERSION}
#         /opt/saniuta/current      -> the active release   (saniuta.service runs current/server/index.js)
#         /opt/saniuta/current.prev -> the one before it
#         /var/www/saniuta          -> /opt/saniuta/current/client (served by Caddy)
# Switching is one rename of a symlink, so server and client change together and nobody ever
# sees a half-updated site.
set -euo pipefail

MODE="${1:-deploy}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${APP_BASE:-/opt/saniuta}" # overridable only to test this script locally
RELEASES=$BASE/releases
CURRENT=$BASE/current
PREVIOUS=$BASE/current.prev
UNIT=saniuta
HEALTH=http://127.0.0.1:2570/health
KEEP=3 # releases kept besides current and previous

say() { printf '==> %s\n' "$*"; }
die() { printf 'EROARE: %s\n' "$*" >&2; exit 1; }

# Atomically points symlink $1 at $2 (rename over the old link).
point() { sudo ln -sfn "$2" "$1.tmp" && sudo mv -T "$1.tmp" "$1"; }

healthy() {
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 2 "$HEALTH"; then echo; return 0; fi
    sleep 1
  done
  return 1
}

restart() {
  sudo systemctl restart "$UNIT"
  sleep 1
}

show() {
  say "Versiunea activă: $(readlink "$CURRENT" 2>/dev/null || echo '-') ($(cat "$CURRENT/VERSION" 2>/dev/null || echo '?'))"
  say "Versiunea anterioară: $(readlink "$PREVIOUS" 2>/dev/null || echo '-')"
}

prune() {
  local keep_cur keep_prev
  keep_cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  keep_prev="$(readlink -f "$PREVIOUS" 2>/dev/null || true)"
  # newest first; skip the first $KEEP, never delete current/previous
  ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's#/$##' | tail -n +$((KEEP + 1)) | while read -r dir; do
    if [ "$dir" != "$keep_cur" ] && [ "$dir" != "$keep_prev" ]; then sudo rm -rf "$dir"; fi
  done
}

deploy() {
  local archive="$HERE/release.tar.gz" id new old oldprev
  [ -f "$archive" ] || die "Lipsește $archive"
  [ -d "$RELEASES" ] || die "Lipsește $RELEASES: rulează întâi deploy/setup.sh pe server."
  id="$(date +%Y%m%d-%H%M%S)"
  # never unpack over an existing release (two deploys in the same second)
  if [ -e "$RELEASES/$id" ]; then id="$id-$$"; fi
  new="$RELEASES/$id"
  say "Despachetez în $new"
  sudo install -d -o root -g root -m 755 "$new"
  sudo tar -xzf "$archive" -C "$new" --no-same-owner --no-same-permissions || { sudo rm -rf "$new"; die "Arhiva nu s-a putut despacheta."; }
  sudo chown -R root:root "$new"
  sudo chmod -R u=rwX,go=rX "$new"
  [ -f "$new/server/index.js" ] && [ -f "$new/client/index.html" ] || { sudo rm -rf "$new"; die "Arhiva nu conține server/index.js și client/index.html"; }

  old="$(readlink "$CURRENT" 2>/dev/null || true)"
  oldprev="$(readlink "$PREVIOUS" 2>/dev/null || true)"
  if [ -n "$old" ]; then point "$PREVIOUS" "$old"; fi
  say "Comut pe $id"
  point "$CURRENT" "$new"
  restart
  if healthy; then
    prune
    show
    return 0
  fi
  sudo journalctl -u "$UNIT" -n 30 --no-pager || true
  if [ -n "$old" ]; then
    say "Health check eșuat: revin la $old"
    point "$CURRENT" "$old"
    # Back to exactly how it was: a later rollback must not land on the broken release.
    if [ -n "$oldprev" ]; then point "$PREVIOUS" "$oldprev"; else sudo rm -f "$PREVIOUS"; fi
    sudo rm -rf "$new"
    restart
    healthy || true
    show
    exit 3
  fi
  die "Health check eșuat și nu există o versiune anterioară la care să revin."
}

rollback() {
  local prev cur
  prev="$(readlink "$PREVIOUS" 2>/dev/null || true)"
  [ -n "$prev" ] && [ -d "$prev" ] || die "Nu există o versiune anterioară (current.prev)."
  cur="$(readlink "$CURRENT" 2>/dev/null || true)"
  say "Revin la $prev"
  point "$CURRENT" "$prev"
  # swap, so a second rollback goes forward again
  if [ -n "$cur" ]; then point "$PREVIOUS" "$cur"; fi
  restart
  healthy || { sudo journalctl -u "$UNIT" -n 30 --no-pager || true; die "Serverul nu răspunde nici după rollback."; }
  show
}

case "$MODE" in
  deploy) deploy ;;
  rollback) rollback ;;
  *) die "Mod necunoscut: $MODE (deploy | rollback)" ;;
esac
