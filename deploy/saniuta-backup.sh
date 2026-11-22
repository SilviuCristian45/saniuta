#!/usr/bin/env bash
# Daily backup of the leaderboard, run by saniuta-backup.service as the saniuta user.
# sqlite3 .backup uses SQLite's online backup API: a consistent copy even while the server writes (WAL).
# Keeps the last 7 days in /var/lib/saniuta/backups (one file per UTC day).
set -euo pipefail

DIR=/var/lib/saniuta
DB=$DIR/leaderboard.db
OUT=$DIR/backups
KEEP=7

if [ ! -f "$DB" ]; then
  echo "Nu există încă $DB; nimic de copiat."
  exit 0
fi
mkdir -p "$OUT"
day="$(date -u +%Y%m%d)"
tmp="$OUT/.leaderboard-$day.db.tmp"
rm -f "$tmp"
sqlite3 "$DB" ".timeout 5000" ".backup '$tmp'"
[ "$(sqlite3 "$tmp" 'PRAGMA integrity_check;')" = ok ] || { rm -f "$tmp"; echo "Copia nu trece integrity_check" >&2; exit 1; }
mv -f "$tmp" "$OUT/leaderboard-$day.db"
# newest first; everything past the first $KEEP goes
ls -1t "$OUT"/leaderboard-*.db | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "Backup: $OUT/leaderboard-$day.db ($(stat -c %s "$OUT/leaderboard-$day.db") bytes)"
