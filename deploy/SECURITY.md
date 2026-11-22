# Securitate: checklist-ul înainte de primul deploy public

Checklist-ul din skill-ul `multiplayer-colyseus` (SECURITY-CHECKLIST.md), punct cu punct pentru Săniuța.
„Test” = verificat automat în `server/test` (prin Caddy = cu header-ul `x-forwarded-for`, ca în producție).
Clasamentul vine în etapa 6: punctele lui se bifează atunci.

## Camere și matchmaking
- [x] Camere private: `setPrivate(true)` în `SaniutaRoom.onCreate`. Test: `security.test.ts` (M1).
- [x] Doar `create`, `joinById`, `reconnect` (`app.ts`); `join`/`joinOrCreate` refuzate. Test: M1.
- [x] Codul camerei din `crypto.randomInt`, alfabet fără 0/O/1/I/L; seed-ul din `crypto.randomBytes`.
      Test: D2 + m1 (și că sursa camerei nu folosește `Math.random`).
- [x] `MAX_ROOMS` 20 global („Serverul e plin”) și 4 camere pe IP. Teste: `room.test.ts`, C1.
- [x] Lobby nepornit închis după 20 min (`CLOSE_LOBBY_IDLE`, mesaj în meniu). Test: D4.
- [x] `lock()` la Start, `unlock()` la lobby; 6 locuri cu tot cu boții. Teste: `room.test.ts`.
- [x] Coduri necunoscute: buget pe IP (join, reconnect, `/rooms/:code`); după el nu se mai răspunde nici
      pentru coduri reale. Test: D2.

## Conexiuni și IP
- [x] Serverul ascultă pe `127.0.0.1:2570` (`HOST` în `saniuta.service`); Caddy e singura intrare.
- [x] IP-ul doar din ultima intrare `X-Forwarded-For` și doar de la loopback (`clientIp.ts`); IPv6 pe /64;
      fără header, limitele sunt oprite, cu avertisment în log. Caddy: `header_up X-Real-IP {remote_host}`,
      `header_up -X-Client-IP`. Test: M3.
- [x] Guard-ul (`guard.ts`) înfășoară `request`/`upgrade` după `listen()`; IP-ul în `x-saniuta-ip`, valoarea
      trimisă de client sub acest nume e ștearsă întâi; `onAuth` îl mută în opțiuni. Test: M3.
- [x] Allowlist de Origin: în producție doar `https://saniuta-la-vale.duckdns.org` (`NODE_ENV=production` în
      unit); localhost și adresele LAN doar în dev. CORS fără credentials. Test: M2.
- [x] Limite per IP pentru 6 prieteni pe același Wi-Fi: 24 WebSocket-uri, 4 camere, matchmake 30 + 60/min,
      creare 6/min, `/status` 30/min, `/rooms/:code` 20/min; 429 cu `Retry-After`. Test: M2, C1.
- [x] `maxMessagesPerSecond` = 60 (2 × 30 tick-uri): clientul care trimite mai mult e deconectat. Test: `room.test.ts`.
- [x] `/csp-report` doar scrie în jurnal, cu o limită globală; răspunde mereu 204. Test: M2.

## Input și acțiuni
- [x] Input-ul trece prin `parseInput` (seq întreg 1..2³²−1, axe numerice, `fire` doar `true`); `applyInput`
      limitează și trunchiază axele; `onMessage('*')` ignoră restul. Teste: `shared/test/netcode.test.ts`, `room.test.ts`.
- [x] Id-ul jucătorului din `client.sessionId`, niciodată din mesaj. Test: `room.test.ts`.
- [x] Input doar în faza `playing`; coadă de 4, seq-uri vechi/repetate ignorate. Teste: `room.test.ts`, `netcode.test.ts`.
- [x] Acțiunile de lobby (start, pistă, manșe, boți, niveluri, skipRound) verificate în `shared/src/match.ts`
      (host, faza). Test: `room.test.ts`.

## Porecle
- [x] Afișate doar cu `textContent` sau text Phaser (nicăieri `innerHTML`/`insertAdjacentHTML`; verificat cu grep).
- [x] `sanitizeName` pe server (NFC, ș/ț cu virgulă, fără control/format/private/neasignate, litere invizibile,
      spații simple, max 2 semne combinatorii, 16 caractere, altfel „Jucător”). Test: `shared/test/match.test.ts`.
- [x] Duplicate în cameră ⇒ „Ana 2”; `nameKey` (porecla normalizată, litere mici) pentru clasament.

## Clasament (etapa 6)
- [ ] ≥ 2 oameni care au jucat real (≥ 30% din tick-uri activi); starea `idle` („zzz”) există deja pe server.
- [ ] Doar oamenii prezenți la final, fără boți; meciurile offline nu ajung la server.
- [ ] Maxim N meciuri salvate pe IP pe zi (`DailyQuota` există în `limits.ts`).
- [ ] Erorile bazei doar logate; fără IP-uri în bază.

## Client și dependențe
- [x] `@colyseus/sdk` fixat la `0.18.10` (exact), cu `client/test/sdkReconnect.test.ts` pentru internals.
- [x] Fără secrete în client sau repo; configurarea serverului vine din env-ul unit-ului.
- [x] CSP în Caddy, întâi Report-Only: `script-src 'self'`, `connect-src 'self' wss://saniuta-la-vale.duckdns.org`,
      `object-src 'none'`, `frame-ancestors 'none'`, raportare la `/colyseus/csp-report`. Trece pe activ după
      câteva zile fără încălcări (`caddy-update.sh`).
- [x] `npm audit`: 0 vulnerabilități (2026-11-22). Bundle-ul serverului: un fișier, fără module native.

## VPS (skill-ul `vps-deploy`)
- [x] `saniuta.service`: `ProtectSystem=strict`, `IPAddressDeny=any` + `IPAddressAllow=localhost`,
      `CapabilityBoundingSet=` gol, `SystemCallFilter=@system-service` (EPERM), `UMask=0077`, `MemoryMax=150M`.
- [x] Header-e: HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options DENY`, `Permissions-Policy`, `-Server`.
- [x] `/colyseus/` și `/colyseus/health` dau 404 din afară; `/colyseus/status` e verificarea publică.
- [ ] După instalare (cu acord): `systemd-analyze security saniuta`, header-ele reale, `/colyseus/health` 404.
