# Săniuța la vale

Joc multiplayer în browser: curse cu săniuțe de lemn pe o pârtie din Carpați, la apus, printre brazi,
pietre, trambuline și bulgări. Până la 6 jucători, intri cu un cod sau joci offline cu boți.

Online: **https://saniuta-la-vale.duckdns.org**

## Cum se joacă

- Săgeți / WASD: stânga-dreapta conduci, sus împingi cu picioarele (doar cât sania merge încet), jos frânezi.
  Spațiu aruncă un bulgăre. Pe telefon: joystick-ul și butonul „Bulgăre”.
- Ia bulgări din grămezi (maxim 3) și nimerește-i pe ceilalți: îi încetinești.
- Puncte pe manșă după locul la sosire: 10 / 7 / 5 / 3 / 2 / 1. După primul sosit mai sunt 15 secunde;
  cine n-a ajuns ia jumătate din punctele locului.
- `P` pauză (offline), `M` sunet pornit/oprit, `Esc` ieșire.

## Clasament

Cel mai bun timp pe fiecare dintre cele trei pârtii fixe (Pârtia Bunicii, Valea Lupului, Coborârea Nebunilor),
top 15, un rând pe poreclă. Intră doar manșele online cu cel puțin 2 jucători care chiar au condus, doar cine a
trecut linia de sosire (fără boți). „Pârtie aleatoare” nu intră.

## Sunete

Toate sunetele sunt generate din cod (Web Audio). Oricare poate fi înlocuit cu un fișier pus în
`client/public/audio/`, cu numele de mai jos și extensia `.ogg` (sau `.mp3`); fișierul are prioritate.

| fișier | când se aude |
|---|---|
| `alunecare` | în buclă cât sania alunecă (mai tare și mai ascuțit cu viteza; altfel pe gheață și în zăpada adâncă) |
| `vant` | în buclă, vântul care crește cu viteza |
| `brad` | răsturnare într-un brad |
| `piatra` | răsturnare într-o piatră |
| `saritura` | desprinderea de pe trambulină |
| `aterizare` | aterizarea în zăpadă |
| `aruncare` | un bulgăre aruncat |
| `lovit` | un bulgăre care nimerește o sanie |
| `ciocnire` | două săniuțe care se lovesc |
| `numaratoare` | „3, 2, 1” |
| `hai` | „HAI!” la start |
| `sosire` | trecerea liniei de sosire |
| `castig` | finalul meciului (podiumul) |

Sunetul se oprește și pornește din butonul 🔊 din joc, din colțul meniului sau din „Setări”, și rămâne așa
în browser.

## Dezvoltare (Node ≥ 22.12)

```bash
npm install
npm run dev          # http://localhost:5175 (client) + server pe :2570
npm test
npm run typecheck
npm run build
npm run og -w client # imaginea de previzualizare (og.png) și iconițele, generate din cod
```

Arhitectura, regulile și comenzile pentru boți: `CLAUDE.md`. Deploy-ul pe VPS: `deploy/README.md`.
