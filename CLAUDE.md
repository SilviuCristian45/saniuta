# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Săniuța la vale": browser multiplayer top-down sled race down a mountain slope (Carpathians, sunset/night, wooden sleds), between fir trees, rocks, ramps and snowballs. npm workspaces monorepo: `shared/` (pure deterministic simulation), `client/` (Phaser 3 + Vite), `server/` (authoritative Colyseus 0.18). README and user-facing strings are in Romanian; code comments are in English. Requires Node ≥ 22.12.

Architecture follows the `multiplayer-colyseus` skill; deploy follows the `vps-deploy` skill. Reference projects, **read only, never modify**:
- `C:\Users\silvi\bumper-cars` ("Mașinuțe de Bâlci"): closest model: continuous fixed-point physics, client prediction + reconciliation, touch joystick.
- `C:\Users\silvi\petarde` ("Bombe și Petarde"): lobby/menu UX, podium, awards, leaderboard.

## Commands

Run from the repo root:

```bash
npm install
npm run dev          # client (http://localhost:5175) + server (:2570) together; dev:client / dev:server for one
npm test             # vitest for /shared, the client's DOM-free modules (client/test), the server tests
npm run typecheck    # tsc for shared + client + server
npm run build        # client/dist (static) + server/dist/index.js (single esbuild bundle, no node_modules needed)
npm run sim          # (stage 1) headless bots-only race
npm run balance      # (stage 1) bot tournament stats per level
```

Single test file / test name:

```bash
npm test -w shared -- test/rng.test.ts
npm test -w shared -- -t "<test name substring>"
npm run test:watch -w shared
```

## Ports

| | port |
|---|---|
| dev client (Vite) | 5175 |
| dev server | 2570 |
| server tests (boot their own server) | 2571 |
| production (VPS, `127.0.0.1` only, behind Caddy) | 2570 |

These must not collide with the other projects (Bombe 2567/5173, Mașinuțe 2568–2569/5174; see `vps-deploy/VPS-INVENTORY.md`).

## Rules

- **Git**: branch `main`. Commits use only the identity from git config, **no `Co-Authored-By` or any Claude attribution**. Never change git config. Never force push. Commit + push at the end of each stage.
- **Stages** (stop after each one so the user can test): 0 repo/monorepo → 1 `/shared` sim + tests → 2 rendering + local mode + keyboard/touch → 3 menus and lobby → 4 Colyseus server + prediction, 100–150 ms lag test → 5 deploy via `vps-deploy` (nothing runs on the VPS without the user's explicit go) → 6 leaderboard, podium, atmosphere, tuning. Keep this file up to date at every stage.
- **VPS** (`oracle`, 1 GB RAM, shared with Bombe, Mașinuțe, the train `cabina-api`): never touch the other services. Production: `saniuta-la-vale.duckdns.org`, `127.0.0.1:2570`, `MemoryMax=150M`, heap 105 MB.

## Architecture

### `/shared` — deterministic simulation (no Phaser, no DOM)
- Consumed as raw TypeScript (`exports` → `src/index.ts`); no build step.
- **Determinism is a hard rule**: no `Date.now()`, `performance.now()`, `new Date`, `Math.random()`, float trig, `**`. Randomness goes through the seeded mulberry32 RNG whose state lives in the game state (`rng.ts`). Same seed + same inputs ⇒ byte-identical state.
- **Fixed-point**: every position, velocity, angle and timer is an integer. Angles are integer steps (`ANGLE_STEPS` = 1024) with a literal sine table (`fixed.ts`: `isin`/`icos`/`iatan2`/`isqrt`/`idiv` (never -0)/`hash32`/`percent`). **Never use bitwise operators on fixed-point values**; bitwise is allowed only in `rng.ts`/`fixed.ts`/`roomCode.ts` on uint32 words. `test/sourceRules.test.ts` enforces this.
- Fixed tick: 30/s (`TICK_RATE`). One `runTick(state, inputs)` (inputs + bot decisions + `step`) runs identically in `LocalTransport`, client prediction and on the server.
- Flat state (`players: Record<id, PlayerState>`, plain arrays, fixed slots instead of object lists) so it maps onto `@colyseus/schema`. A new state field goes into `stateKeys.ts` and `server/src/schema.ts`. Players are always iterated with `sortedPlayers` (slot order).
- **Track from seed**: the slope (width, bends, slope steepness, surfaces, obstacles) is generated from `trackId` + seed, identically on client and server; it is never sent over the network. Three fixed tracks ("Pârtia Bunicii" easy, "Valea Lupului" medium, "Coborârea Nebunilor" hard) + "Pârtie aleatoare".
- Planned game rules (stage 1): gravity × slope, steering (tight turns cost speed), push (only at low speed), brake; surfaces snow/ice/deep snow; sled–sled collisions; trees/rocks → crash ~1 s; ramps → airborne (no steering, passes over obstacles, landing boost); snowballs (pick up max 3, throw forward, hit = slowed); countdown "3, 2, 1, HAI!", 60–90 s runs, 15 s after the first finisher, points 10/7/5/3/2/1, match of 3/5/7 runs; bots Ușor/Mediu/Greu with a balance test.
- Current modules: `constants.ts`, `fixed.ts`, `rng.ts`, `roomCode.ts` (6-char room codes without 0/O/1/I/L).

### `/client` — rendering only
- Phaser 3 + Vite. Stage 0 has only a placeholder scene (`src/main.ts`).

### `/server` — authoritative Colyseus 0.18
- `src/config.ts` reads `HOST`/`PORT` from env (default `127.0.0.1:2570`); `src/app.ts` builds the server; `GET /health` for the deploy check. Built with `build.mjs` (esbuild) into one ESM file `dist/index.js`.
