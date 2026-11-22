// Draws the link preview (og.png, 1200×630) and the favicons from code, in the game's look, and
// writes them to client/public. Run with `npm run og -w client` (as in Bombe și Petarde).
//
// Everything is plain SVG rendered by resvg; text uses the system's bold sans-serif fonts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Same palette as the game (render/colors.ts, ui/backdrop.ts).
const NIGHT = '#141b3d';
const SNOW = '#eef2ff';
const SNOW_SHADE = '#cfd6f0';
const ACCENT = '#ffb347';
const OUTLINE = '#1d2a52';
const COATS = ['#e63946', '#3a86ff', '#ffbe0b', '#2a9d8f', '#9b5de5', '#fb8500'];
const SCARVES = ['#ffd166', '#ff006e', '#8338ec', '#ffffff', '#06d6a0', '#00b4d8'];
const FONT = "'Trebuchet MS', 'Segoe UI', 'Arial Black', Arial, sans-serif";

/** Seeded so the picture is the same every time it is regenerated. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A wooden sled with a rider seen from above and a little from the side, going down to the right:
 * two runners, a plank seat, the rider's coat, bobble hat and a scarf flying behind.
 */
function sled(x, y, scale, coat, scarf, angle = 18) {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
    <ellipse cx="0" cy="16" rx="34" ry="7" fill="#1b2440" opacity="0.25"/>
    <path d="M-32 10 L28 10 Q38 10 38 0" stroke="#4a2f1a" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M-32 4 L28 4 Q36 4 36 -4" stroke="#6b4423" stroke-width="3" fill="none" stroke-linecap="round"/>
    <rect x="-28" y="-6" width="52" height="11" rx="3" fill="#9c6b3e"/>
    <rect x="-24" y="-5" width="10" height="9" fill="#c28e5c"/><rect x="-8" y="-5" width="10" height="9" fill="#c28e5c"/><rect x="8" y="-5" width="10" height="9" fill="#c28e5c"/>
    <path d="M-10 -8 Q-34 -14 -48 -6 Q-40 -18 -12 -14 Z" fill="${scarf}"/>
    <ellipse cx="-2" cy="-14" rx="15" ry="11" fill="${coat}"/>
    <circle cx="6" cy="-26" r="9" fill="#f2c9a0"/>
    <path d="M-3 -29 Q6 -42 15 -29 Z" fill="${coat}"/>
    <circle cx="6" cy="-40" r="4" fill="#ffffff"/>
    <rect x="-4" y="-21" width="16" height="5" rx="2" fill="${scarf}"/>
  </g>`;
}

/** A fir with snow on its tiers. */
function fir(x, y, h, color = '#1e4637') {
  let tiers = `<rect x="${x - 4}" y="${y - h * 0.15}" width="8" height="${h * 0.18}" fill="#4a2f1a"/>`;
  for (let i = 0; i < 3; i++) {
    const top = y - h + i * h * 0.25;
    const w = h * (0.28 + i * 0.1);
    tiers += `<polygon points="${x},${top} ${x - w},${top + h * 0.45} ${x + w},${top + h * 0.45}" fill="${color}"/>`;
    tiers += `<polygon points="${x},${top} ${x - w * 0.35},${top + h * 0.16} ${x + w * 0.35},${top + h * 0.16}" fill="${SNOW}" opacity="0.9"/>`;
  }
  return tiers;
}

/** A ridge of peaks with snow caps along y = base. */
function ridge(rand, base, height, peaks, color, snow, W) {
  const step = W / peaks;
  const tops = [];
  for (let i = -1; i <= peaks + 1; i++) tops.push([i * step + (rand() - 0.5) * step * 0.5, base - height * (0.45 + rand() * 0.55)]);
  let d = `M${-step} 630`;
  tops.forEach(([x, y], i) => {
    d += ` L${x.toFixed(0)} ${y.toFixed(0)}`;
    const next = tops[i + 1];
    if (next) d += ` L${((x + next[0]) / 2).toFixed(0)} ${(base - rand() * height * 0.3).toFixed(0)}`;
  });
  d += ` L${W + step} 630 Z`;
  const caps = tops
    .map(([x, y]) => {
      const w = height * 0.32;
      const h = height * 0.22;
      return `<polygon points="${x},${y} ${x + w * 0.5},${y + h} ${x + w * 0.2},${y + h * 0.8} ${x},${y + h * 1.05} ${x - w * 0.25},${y + h * 0.75} ${x - w * 0.5},${y + h}" fill="${snow}"/>`;
    })
    .join('');
  return `<path d="${d}" fill="${color}"/>${caps}`;
}

function ogSvg() {
  const W = 1200;
  const H = 630;
  const rand = rng(2026);
  let stars = '';
  for (let i = 0; i < 55; i++) {
    stars += `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * 170).toFixed(0)}" r="${(0.7 + rand() * 1.4).toFixed(1)}" fill="#fff4d6" opacity="${(0.35 + rand() * 0.6).toFixed(2)}"/>`;
  }
  let flakes = '';
  for (let i = 0; i < 80; i++) {
    flakes += `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * H).toFixed(0)}" r="${(1.5 + rand() * 3).toFixed(1)}" fill="#fff" opacity="${(0.4 + rand() * 0.5).toFixed(2)}"/>`;
  }
  // The slope: snow from the upper left down to the lower right, with grooming lines and sleds on it.
  const slope = (x) => 430 + (x / W) * 120 - Math.sin((x / W) * Math.PI) * 30;
  let slopePath = `M0 ${H}`;
  for (let x = 0; x <= W; x += 40) slopePath += ` L${x} ${slope(x).toFixed(0)}`;
  slopePath += ` L${W} ${H} Z`;
  let lines = '';
  for (let i = 1; i < 5; i++) lines += `<path d="M0 ${slope(0) + 18 + i * 22} L${W} ${slope(W) + 18 + i * 22}" stroke="#c2cbe8" stroke-width="3" opacity="0.8"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NIGHT}"/><stop offset="0.3" stop-color="#3a2d6b"/><stop offset="0.5" stop-color="#8a4f8f"/>
      <stop offset="0.62" stop-color="#e0806a"/><stop offset="0.75" stop-color="${ACCENT}"/><stop offset="1" stop-color="#ffd29a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}
  <circle cx="820" cy="300" r="120" fill="#ffb36b" opacity="0.18"/><circle cx="820" cy="300" r="70" fill="#ffc98a" opacity="0.35"/><circle cx="820" cy="300" r="44" fill="#ffe2b0"/>
  ${ridge(rand, 320, 150, 6, '#6a5a9e', '#d9cdf0', W)}
  ${ridge(rand, 390, 120, 5, '#4a3f7a', '#c4bce6', W)}
  ${ridge(rand, 450, 80, 4, '#2f2a58', '#b5b2dc', W)}
  <path d="${slopePath}" fill="${SNOW_SHADE}"/>
  <path d="${slopePath.replace(/L(\d+) (\d+)/g, (_, x, y) => `L${x} ${Number(y) + 10}`)}" fill="${SNOW}"/>
  ${lines}
  ${fir(60, slope(60) + 20, 90)}${fir(150, slope(150) + 26, 64)}${fir(1110, slope(1110) + 22, 96)}${fir(1170, slope(1170) + 30, 70)}
  ${sled(330, slope(330) + 70, 1.9, COATS[0], SCARVES[0], 14)}
  ${sled(560, slope(560) + 54, 2.2, COATS[1], SCARVES[1], 12)}
  ${sled(780, slope(780) + 78, 1.8, COATS[2], SCARVES[2], 10)}
  ${sled(960, slope(960) + 52, 1.6, COATS[3], SCARVES[3], 8)}
  ${flakes}
  <text x="${W / 2}" y="168" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="118"
    fill="#ffffff" stroke="${OUTLINE}" stroke-width="16" stroke-linejoin="round" paint-order="stroke">Săniuța la vale</text>
  <text x="${W / 2}" y="238" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="44"
    fill="${ACCENT}" stroke="${OUTLINE}" stroke-width="8" stroke-linejoin="round" paint-order="stroke">Cursă cu prietenii · până la 6</text>
</svg>`;
}

/**
 * The favicon: a little wooden sled seen from the side, red rider's scarf, on the dusk sky, simple
 * enough to read at 16×16.
 */
function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2d6b"/><stop offset="1" stop-color="#e0806a"/></linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#bg)"/>
  <path d="M0 50 L64 38 L64 64 L0 64 Z" fill="${SNOW}"/>
  <g transform="rotate(-10 32 36)">
    <path d="M8 44 L50 44 Q58 44 58 36" stroke="#4a2f1a" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="12" y="31" width="36" height="8" rx="2" fill="#c28e5c"/>
    <line x1="18" y1="39" x2="18" y2="44" stroke="#4a2f1a" stroke-width="4"/><line x1="42" y1="39" x2="42" y2="44" stroke="#4a2f1a" stroke-width="4"/>
    <ellipse cx="30" cy="25" rx="9" ry="7" fill="#e63946"/>
    <circle cx="35" cy="15" r="6" fill="#f2c9a0"/>
    <path d="M24 22 Q12 18 6 24" stroke="#ffd166" stroke-width="4" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;
}

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render().asPng();
}

mkdirSync(OUT, { recursive: true });
const write = (name, data) => {
  writeFileSync(join(OUT, name), data);
  console.log(`${name.padEnd(22)} ${(data.length / 1024).toFixed(1)} KB`);
};
const favicon = faviconSvg();
write('og.png', png(ogSvg(), 1200));
write('favicon.svg', favicon);
write('favicon-32.png', png(favicon, 32));
write('apple-touch-icon.png', png(favicon.replace('rx="14"', 'rx="0"'), 180)); // iOS rounds the corners itself
write('icon-512.png', png(favicon, 512));
