# Deploy pe VPS-ul Oracle

Jocul rulează la **https://saniuta-la-vale.duckdns.org**, pe VPS-ul Oracle (Ubuntu, 1 GB RAM, user `ubuntu`,
alias SSH `oracle`), lângă Bombe și Petarde, Mașinuțe de Bâlci și jocul cu trenul. Scripturile ating doar ce
ține de săniuțe:

| Ce | Unde |
|---|---|
| user de sistem | `saniuta` |
| versiunile | `/opt/saniuta/releases/<data-ora>/` (`server/index.js` + `.map`, `client/`, `VERSION`) |
| versiunea activă / anterioară | symlink-urile `/opt/saniuta/current` și `/opt/saniuta/current.prev` |
| clientul servit de Caddy | `/var/www/saniuta` → `/opt/saniuta/current/client` |
| serviciul | `saniuta.service` (Node pe `127.0.0.1:2570`, `MemoryMax=150M`, heap `--max-old-space-size=105`, `Restart=always`) |
| clasamentul (etapa 6) | `/var/lib/saniuta/leaderboard.db` (SQLite, WAL; `StateDirectory` al user-ului `saniuta`) |
| backup-ul clasamentului | `saniuta-backup.timer` zilnic (~05:00) → `/var/lib/saniuta/backups/leaderboard-AAAALLZZ.db`, ultimele 7 |
| Caddy | blocul `saniuta-la-vale.duckdns.org` din `/etc/caddy/Caddyfile` |

**Nu se ating**: `bombe` (port 2567, `/opt/bombe`, `/var/www/bombe`, `bombe-petarde.duckdns.org`),
`masinute` (port 2568, `/opt/masinute`, `/var/www/masinute`, `/var/lib/masinute`, `masinute-balci.duckdns.org`),
`cabina-api` (`/var/www/cabina`, `tren-api.duckdns.org`). Caddy primește doar `reload`, niciodată restart.
Nu e nevoie de Docker, Redis sau module native: serverul e un singur fișier `index.js` (bundle esbuild).

Memoria: cu Săniuța, totalul `MemoryMax` pe VPS ajunge la 700M (300 + 250 + 150), plafonul ales pentru
1 GB, cu restul pentru Caddy, `cabina-api` și sistem. Măsurat local (Windows, bundle-ul de producție cu
`--max-old-space-size=105`, memoria rezidentă): 78 MB gol, 83–86 MB cu 6 camere pline (6 săniuțe, boți care
coboară și aruncă bulgări) timp de 30 s. Pe Linux se așteaptă ceva mai puțin.

Fișiere:

- `setup.sh`: instalarea inițială, pe VPS (o dată; poate fi rulat din nou fără efecte nedorite); pe server
  folderul `deploy/` stă în `/home/ubuntu/saniuta-deploy` (copia de la ultima instalare);
- `push.ps1`: actualizare de pe Windows (teste, typecheck, build, upload, comutare atomică, health check, rollback);
- `remote-update.sh`: partea de pe server a lui `push.ps1` (o urcă și o rulează el);
- `saniuta.service`, `Caddyfile`: unit-ul systemd și blocul Caddy, instalate de `setup.sh`;
- `saniuta-backup.service`, `saniuta-backup.timer`, `saniuta-backup.sh`: backup-ul zilnic al clasamentului,
  instalate tot de `setup.sh` (scriptul ajunge în `/usr/local/sbin/saniuta-backup`);
- `caddy-update.sh`: schimbări ulterioare ale blocului Caddy (înainte de prima instalare, `--dry-run` arată
  exact blocul pe care îl adaugă `setup.sh` și validează Caddyfile-ul rezultat).

## Înainte de prima instalare

1. **DuckDNS**: subdomeniul `saniuta-la-vale` pe IP-ul public al VPS-ului.
   Verifică: `Resolve-DnsName saniuta-la-vale.duckdns.org` (trebuie să dea IP-ul VPS-ului).
2. **Porturile** 80 și 443 sunt deja deschise (le folosesc celelalte site-uri). Portul 2570 **nu** se deschide:
   serverul ascultă doar pe loopback, Caddy e singura intrare.
3. **SSH**: `ssh oracle "echo ok"` merge din PowerShell fără parolă (alias în `~/.ssh/config`).
4. **Local**: `npm install`, apoi `.\deploy\push.ps1 -WhatIf` trece (teste, typecheck, build, arhivă;
   serverul nu e atins).

## Prima instalare

Din PowerShell, în rădăcina repo-ului:

```powershell
# 1. copiază folderul deploy/ pe server, în /home/ubuntu/saniuta-deploy (rămâne acolo)
ssh oracle "rm -rf ~/saniuta-deploy"
scp -r deploy oracle:saniuta-deploy
# scp de pe Windows lasă folderul scriibil de oricine; setup.sh rulează cu sudo, deci doar ubuntu scrie aici
ssh oracle "chmod 755 ~/saniuta-deploy && chmod 644 ~/saniuta-deploy/*"

# 2. (opțional) ce va adăuga setup.sh în Caddyfile, validat, fără să scrie nimic
ssh -t oracle "sudo bash ~/saniuta-deploy/caddy-update.sh --dry-run"

# 3. instalarea (user, directoare, systemd, backup, Caddy)
ssh -t oracle "sudo bash ~/saniuta-deploy/setup.sh"

# 4. prima versiune: build, upload, pornește serviciul, health check
.\deploy\push.ps1

# 5. verificare
ssh oracle "systemctl status saniuta --no-pager; cat /opt/saniuta/current/VERSION"
Invoke-WebRequest https://saniuta-la-vale.duckdns.org/colyseus/status -UseBasicParsing | Select-Object -Expand Content
```

`setup.sh`:

1. afișează memoria liberă și swap-ul; avertizează dacă nu există swap sau dacă sunt sub 300 MB disponibili
   (nu se oprește, nu creează swap);
2. verifică Node ≥ 22.12 în `/usr/bin/node` (pe acest VPS e deja instalat pentru celelalte jocuri, deci de
   obicei nu face nimic; altfel îl instalează din NodeSource);
3. verifică că portul 2570 e liber (sau deja al lui `saniuta`);
4. creează user-ul `saniuta`, `/opt/saniuta/releases` și symlink-ul `/var/www/saniuta`;
5. instalează și activează `saniuta.service` (îl repornește doar dacă unit-ul s-a schimbat; înainte de primul
   `push.ps1` nu pornește, pentru că nu există încă nicio versiune);
6. instalează `sqlite3` (dacă lipsește) și backup-ul zilnic (`saniuta-backup.timer`); cât baza nu există
   (până la clasamentul din etapa 6), backup-ul doar spune că nu are ce copia;
7. dacă `/etc/caddy/Caddyfile` nu conține încă `saniuta-la-vale.duckdns.org`: validează configurația existentă,
   face un backup cu dată și oră (`Caddyfile.bak-AAAALLZZ-HHMMSS`), adaugă blocul, validează din nou (dacă pică,
   restaurează backup-ul și se oprește fără reload), apoi `systemctl reload caddy`. Dacă blocul există deja,
   nu modifică nimic.

Primul health check public poate dura câteva secunde, cât Caddy ia certificatul HTTPS (`push.ps1` încearcă de
10 ori). Dacă tot pică la primul deploy, nu există o versiune anterioară la care să revină: verifică DNS-ul și
`ssh oracle "journalctl -u caddy -n 50 --no-pager"`.

## Actualizări

```powershell
.\deploy\push.ps1            # deploy
.\deploy\push.ps1 -WhatIf    # testele, build-ul și arhiva local + comenzile care s-ar rula; serverul nu e atins
.\deploy\push.ps1 -Rollback  # revine la versiunea anterioară, fără build
```

Parametri: `-Server` (implicit `oracle`), `-User`, `-Key`, `-WhatIf`, `-Rollback`; fără alias:
`.\deploy\push.ps1 -Server 203.0.113.10 -Key C:\cale\cheie` (user implicit `ubuntu`).

Ce face un deploy:

1. avertizează dacă ai modificări necomise (nu se oprește);
2. rulează local `npm test`, `npm run typecheck`, `npm run build` și se oprește la prima eroare;
3. pune `server/dist/index.js` (+ `.map`) și `client/dist/` (plus `VERSION`: commit și oră) într-un `release.tar.gz`;
4. îl copiază cu `scp`, împreună cu `remote-update.sh` (fără CRLF), în `/tmp/saniuta-push`;
5. pe server: despachetează într-o versiune nouă, mută `current.prev` pe versiunea activă și comută `current`
   pe cea nouă printr-o singură redenumire de symlink (serverul și clientul se schimbă împreună), apoi
   repornește `saniuta` și așteaptă `http://127.0.0.1:2570/health`;
6. de pe Windows verifică drumul public prin Caddy, `https://saniuta-la-vale.duckdns.org/colyseus/status`
   (`{"ok":true}`; `/colyseus/health` răspunde 404 din afară: e doar pentru scripturile de pe VPS).

Dacă oricare health check pică, revine automat la versiunea anterioară. Pe server se păstrează versiunea
activă, cea anterioară și încă trei.

Un restart pierde camerele în curs (jucătorii văd „Conexiunea cu serverul s-a pierdut”), deci actualizează
când nu se joacă nimeni. După o modificare a lui `saniuta.service` sau a backup-ului, copiază din nou
`deploy/` (pasul 1 de la prima instalare) și rulează `setup.sh` (`push.ps1` nu instalează unit-uri).

## Modificări ale blocului din Caddy

`setup.sh` adaugă blocul doar dacă lipsește. Pentru a-l schimba după prima instalare (de exemplu CSP-ul din
Report-Only în activ), `caddy-update.sh` înlocuiește doar blocul `saniuta-la-vale.duckdns.org`: validează
Caddyfile-ul de acum și pe cel nou înainte să scrie, face o copie `Caddyfile.bak-<data>`, dă
`systemctl reload caddy` (fără restart) și verifică Bombe, Mașinuțe, trenul și Săniuța; dacă ceva nu mai
răspunde ca înainte, pune copia înapoi.

```powershell
ssh oracle "rm -rf ~/saniuta-deploy"
scp -r deploy oracle:saniuta-deploy
ssh oracle "chmod 755 ~/saniuta-deploy && chmod 644 ~/saniuta-deploy/*"
ssh -t oracle "sudo bash ~/saniuta-deploy/caddy-update.sh --dry-run"   # diferența și validarea, nu scrie nimic
ssh -t oracle "sudo bash ~/saniuta-deploy/caddy-update.sh"             # aplicarea
```

Revenire manuală: `sudo cp -a /etc/caddy/Caddyfile.bak-<data> /etc/caddy/Caddyfile && sudo systemctl reload caddy`.
CSP-ul e întâi `Content-Security-Policy-Report-Only`: încălcările ajung în jurnalul serverului
(`ssh oracle "journalctl -u saniuta --no-pager | grep CSP:"`). Când nu mai apar câteva zile, numele header-ului
din `deploy/Caddyfile` devine `Content-Security-Policy` și se rulează din nou pașii de mai sus.

## Util

```powershell
ssh oracle "journalctl -u saniuta -n 50 --no-pager"       # loguri
ssh oracle "cat /opt/saniuta/current/VERSION"             # ce versiune rulează
ssh oracle "curl -s http://127.0.0.1:2570/health"         # camere active / maxim
ssh oracle "systemctl show saniuta -p MemoryCurrent"      # memoria folosită (limita: 150M)
ssh oracle "systemd-analyze security saniuta"             # cât de închis e serviciul
ssh oracle "free -h; swapon --show"
```

Restaurarea bazei (din etapa 6): `sudo systemctl stop saniuta`, copiază backup-ul peste
`/var/lib/saniuta/leaderboard.db` (șterge `-wal` și `-shm`, păstrează owner-ul `saniuta:saniuta`),
`sudo systemctl start saniuta`.
