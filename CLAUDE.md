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
npm run sim -- --bots usor,mediu,greu,greu --rounds 3 --track 1 --seed abc -v   # headless bots-only match, prints every run + standings
npm run balance -- --matches 20 --lineup usor,usor,mediu,mediu,greu,greu --track all   # bot tournament per track: points, wins, finish %, times, crashes, hits (--set key=value,... tries TUNING values)
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
- Flat state (`players: Record<id, PlayerState>`, number arrays, fixed slots instead of object lists) so it maps onto `@colyseus/schema`. **A new state field goes into `stateKeys.ts` (`GAME_STATE_KEYS` scalars, `GAME_ARRAY_KEYS` number arrays, `PLAYER_STATE_KEYS`) and `server/src/schema.ts`**; `test/netcode.test.ts` checks the lists against `createGameState`/`addPlayer`. Players are always iterated with `sortedPlayers` (slot order), collision pairs in that order.
- World axes: x right, y down the slope (the race goes toward +y). Angles: 0 = +x, `DOWNHILL` = 256 = +y; the heading stays within `MAX_HEADING_OFFSET` (~105°) of downhill. **Steering is screen-relative: steer > 0 goes toward +x, which lowers the heading.** Input per tick: `{ seq, steer, throttle, fire }` (`steer`/`throttle` integers in -100..100; throttle > 0 = kick "sus", < 0 = brake "jos"; `fire` latched until the next tick).
- `tuning.ts`: the riding-feel numbers physics reads at run time (`TUNING`, defaults `DEFAULT_TUNING` from `constants.ts`). **Only the local `?tune` panel may change `TUNING`**; a test asserts the defaults. To adopt tuned values, change `constants.ts` and re-run `npm run balance` + the balance test.
- Modules:
  - `track.ts`: **the track is never in the state or on the wire**: `getTrack(trackId, seed)` (cached) builds it with its own RNG (never `GameState.rng`). Rows `ROW_LEN` (32 px) apart with `center`/`half`/`slope` (smooth waypoint series), interpolated between rows (`centerAt`/`halfWidthAt`/`slopeAt`). Obstacles (trees, rocks: discs), ramps (rectangles), snowball piles are bucketed by their center row (`nearby` looks at the row ±1, `itemsBetween` for bots looking ahead); patches of ice/deep snow follow the track (lo/hi in per-mille of the half width) and `surfaceAt` reads them. Generation keeps the start clear, obstacles `minGap` apart and an opening of 6 sled radii across every stretch (`roomFor` checks the whole band; `test/track.test.ts` re-checks every 8 px). `TRACK_DEFS`: "Pârtia Bunicii" (easy), "Valea Lupului" (medium), "Coborârea Nebunilor" (hard), fixed seeds; "Pârtie aleatoare" mixes their parameters and gets a new seed every run (`startRound` draws `trackSeed` from `state.rng`).
  - `physics.ts`: `rideSled` (overturned: no control, heavy friction, gets up pointing downhill with `graceTicks`; in the air: no steering, little drag, landing boost along the heading; riding: steering, gravity × slope, kick only below `pushMaxSpeed`, friction/grip per surface + turn drag + brake, speed cap), `rideFinished` (coasts in the run-out), `keepOnTrack` (snowbank at the edges bounces and costs speed), `hitObstacles` (pushed out; approach ≥ `crashMinSpeed` and not down/grace → overturned `crashTicks`), `tryJump` (fast sled whose center is on a ramp: `airTicks = airTotal` from the speed), `collideSleds` (equal-mass impulse + separation; only both on the snow or both in the air, never finished ones).
  - `snowballs.ts`: piles (`pileTimers` per track pile, back after `PILE_RESPAWN_TICKS`), at most `MAX_SNOWBALLS` carried, throws into `BALL_SLOTS` flat slots (`ballX/Y/Vx/Vy/Ticks/Owner` arrays), a hit sled keeps `ballHitKeepPct` of its speed and gets `splatTicks` (no kicking); balls break on obstacles and the snowbank; the thrower, sleds in the air and overturned ones are never hit.
  - `sim.ts`: `applyInput`, `step` (countdown → `go` → ride/throw → sled collisions → obstacles/ramps/piles/snowbank → finishes (same tick: further past the line first) → snowballs; run ends when everyone is down, `FINISH_GRACE_TICKS` (15 s) after the first finisher (`lastCall`), or at `RUN_TIME_LIMIT_TICKS`; places for the rest by distance; points `POINTS_BY_PLACE` 10/7/5/3/2/1 for finishers, **half of their place's points (rounded down, at least 1) for those still on the way** (`lateFinishPoints`); `results` for `RESULTS_TICKS`, then the next run, or `finished` + `matchEnd`).
  - `match.ts`: lobby/run/match lifecycle as in Bombe (`createGameState`, `addPlayer`, `addBot`, `setTrack`, `setRounds`, `startMatch`, `startRound` (sleds side by side above the start line in a seeded order), `leavePlayer`, `backToLobby`, `computeStandings`: points, wins, best time, slot).
  - `bot.ts`: one procedure, `BOT_PARAMS` per level (reaction interval, lookahead, lanes, clearance, ice/deep costs, ramp/pile bonuses, jumps over what is behind a ramp, brakes when blocked, throw chance/range/angle, mistakes, aim noise). Each decision scores `lanes` lines across the track at the lookahead (half as far when all are blocked) along a two-segment path (a few ticks along the current velocity, all of the air time when flying, then to the target) and steers just enough to close the angle by the next decision. `botThink` is pure (rolls are hashes of `state.rng`, round, decision, slot; never advances the RNG).
  - `runner.ts` (`runTick`, `skipBotRound`), `awards.ts` (Fulgerul, Pădurarul, Lunetistul, Cascadorul, Strângătorul, Neclintitul), `protocol.ts` (wire contract, `ROOM_NAME`, leaderboard types), `stateKeys.ts` + `netcode.ts` (`InputQueue`, `parseInput`, `Predictor`, as in Mașinuțe), `roomCode.ts`.
- `test/sourceRules.test.ts` greps the source for banned APIs and for bitwise operators outside `rng.ts`/`fixed.ts`/`roomCode.ts`. Tests build runs with `makeRace` on real tracks and exact physics situations on `flatTrack` (`test/helpers.ts`). `test/netcode.test.ts` runs a server and a predicting client over a simulated 100–150 ms network: a sled braking hard right in front is mispredicted, then the prediction is exact again within a round trip and a few ticks. `test/balance.test.ts`: Greu > Mediu > Ușor on every fixed track.

### `/client` — rendering only
- Phaser 3 + Vite, a fixed 1280×720 canvas scaled to fit (`render/layout.ts`). **Two layers, two cameras** (`scenes/GameScene.ts`): everything in the world goes on the world layer (the `addWorld` helper; the main camera follows the player's sled a little ahead down the slope and zooms out with speed), the HUD/minimap/snowfall/dusk tint go on the HUD layer (`addHud`; a second camera that never moves). Objects created with `scene.add.*` must be passed through one of the two helpers, or both cameras draw them.
- Scenes only talk to `GameTransport` (`net/GameTransport.ts`): `setInput` every frame (the transport samples it once per tick, throw presses latched), `send`, `onEvents`, `view()` (poses blended between ticks + snowballs in flight, `net/view.ts`). `LocalTransport`: fixed-step accumulator (catch-up ≤ 250 ms), bots via `runTick`.
- `render/`: `textures.ts` (every picture drawn from code once: sleds per slot with rider, firs, rocks, ramp, pile, snowball, cabin, lamp, glow), `TrackView.ts` (the track in chunks of 24 rows with manual culling: ground Graphics with grooming lines, steep shading, ice/deep snow, snowbanks, start/finish; obstacles, ramps, piles; firs, cabins and lamps beside the track from `hash32` of the track seed), `SledView.ts` (shadow, sled scaled up in the air, spin when overturned, blink during grace, snow splat, a scarf of trailing links that flutters, names alternating above/below), `Trails.ts` (runner tracks, gaps over jumps/crashes), `Snowfall.ts` (screen-space flakes with parallax), `Minimap.ts` (the whole track as a strip, bends stretched ×3), `Hud.ts` (run/track, time, place, km/h, snowballs, standings, countdown "3, 2, 1, HAI!", last-call and finish banners), `ResultsPanel.ts` (between runs and at the end), `fx.ts`.
- Input (`input/`): `KeyboardInput` (arrows/WASD, Space throws), `TouchInput` (HTML over the canvas: analog joystick (`stick.ts`: sideways steers in proportion, up past `KICK_ZONE` kicks, down past `BRAKE_ZONE` brakes) + snowball button showing how many are carried; left-handed mode), `CombinedInput`. Touch is detected with `(hover: none) and (pointer: coarse)` or forced with `?touch` (`device.ts`); phones get a rotate prompt and fullscreen + wake lock on the first tap (`ui/orientation.ts`). `settings.ts`: "Efecte reduse" (on by default on phones: fewer flakes, shorter trails, no camera shake), left-handed. `storage.ts`: localStorage with the `saniuta.` prefix, errors ignored.
- Flow (stage 3): Intro → Nume (saved, "Salut, X!") → Meniu → Lobby → Joc → (host: Enter / tap on the final panel) Lobby. The screens are HTML over the canvas (`screens/`: `intro.ts`, `name.ts`, `menu.ts`, `lobby.ts`; built with `ui/el.ts` + `ui/html.ts`, `textContent` everywhere), one Phaser scene each (`scenes/menuScenes.ts`), talking to the scene only through a `ScreenHost` (`screens/host.ts`, `scenes/phaserHost.ts`: routes = scenes, sled avatars from the textures). Behind them `ui/backdrop.ts` draws the Carpathians at dusk (sky, ridges, forests, cabin, snowfall, sleds sliding by; still with "Efecte reduse"); the canvas is ENVELOP behind screens and FIT in the game (`ui/dom.ts` `useScaleMode`). Menu: "Creează joc", "Intră la un prieten" (`ui/CodeInput.ts`, 6 boxes, paste of a link works), "Joacă offline cu boți", "Setări" (`ui/settingsDialog.ts`) on touch, "Efecte reduse" in the corner on desktop; `?room=COD` joins after the name. `net/rooms.ts`: offline room (3 bots, lobby first); online create/join reject with "nu e gata încă" until stage 4. Lobby: code + share (online only), 6 rows (host tag, per-bot level tag the host cycles), track (4 buttons), runs 3/5/7, level for new bots, ±Bot, Start, rules, "Ieși din joc". In game: "Pauză" (offline) / "Ieși (Esc)" HTML buttons top right (`.game-corner`), Esc opens "Sigur ieși?" (`ui/dialog.ts`; offline it pauses meanwhile). CSS: `style.css` (page, `:root` palette, safe areas) + `screens.css` (screens, dialogs; a sideways-phone layout under `max-height: 520px`; `[hidden]` forced to `display: none`).
- Test URL options (`urlOptions.ts`) skip the menus and start a local match at once (`quickStart`): `?bots=1..5` (default 3), `?rounds=3|5|7`, `?track=0..3`, `?seed=abc`, `?botlevel=usor|mediu|greu`, `?debug` (obstacle hitboxes, sled discs, each bot's line (red when blocked), tick/FPS, speed/heading/input/air/crash/surface/slope; `window.__game`), `?tune` (`debug/TunePanel.ts`: a slider per `TUNING` key, saved in this browser, local games only); `?online` (or `?room=`) keeps the menus, so `?online&debug` gives `window.__game` with the normal flow. `?touch` / `?touch=0` only force the layout. In game: `P` pauses (a tap resumes on phones; the page going to the background pauses); in a quick-start match `Enter` (or a tap on the final panel) starts a new match.
- Automated Chrome windows run `requestAnimationFrame` at ~2/s; to look at a running game from a script, `game.loop.sleep()` and call `game.loop.step(t)` with your own increasing `t` (with `?debug`, `window.__game`).

### `/server` — authoritative Colyseus 0.18
- `src/config.ts` reads `HOST`/`PORT` from env (default `127.0.0.1:2570`); `src/app.ts` builds the server; `GET /health` for the deploy check. Built with `build.mjs` (esbuild) into one ESM file `dist/index.js`.

## Open items (stage 6)
- Pârtia Bunicii: Greu finishes only ~85% of runs there, less than on the harder tracks (`npm run balance`). Find out why (the 15 s window behind a fast leader on the easiest track?).
- Ușor rarely finishes within the 15 s; Mediu and Ușor overturn a lot on Coborârea Nebunilor. Retune with `npm run balance`.
