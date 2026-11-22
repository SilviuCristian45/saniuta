import { FIXED_TRACK_IDS, LEADERBOARD_MIN_HUMANS, LEADERBOARD_SIZE, nameKey, trackName, type LeaderboardEntry } from '@saniuta/shared';
import { fetchLeaderboard, formatRecordDate, formatRecordTime } from '../net/leaderboard';
import { load, save } from '../storage';
import { el } from '../ui/el';
import { button, onKeyFor, setButtonStyle, title } from '../ui/html';
import type { ScreenHost } from './host';

const MEDALS = ['gold', 'silver', 'bronze'];

/** "Clasament": the all-time best times, one tab per fixed track, opened from the menu. */
export function showLeaderboard(host: ScreenHost): void {
  const back = () => host.go({ to: 'menu', data: {} });
  const content = el('div', { class: 'leaderboard-body' }, [el('p', { class: 'message info', text: 'Se încarcă...' })]);
  let tracks: Record<string, LeaderboardEntry[]> | null = null;
  let current = savedTab();
  const tabs = FIXED_TRACK_IDS.map((trackId) => {
    const b = button(trackName(trackId), () => select(trackId), 'secondary', 'small');
    b.classList.add('tab');
    return b;
  });
  const select = (trackId: number) => {
    current = trackId;
    save('leaderboardTab', String(trackId));
    tabs.forEach((b, i) => setButtonStyle(b, FIXED_TRACK_IDS[i] === trackId ? 'primary' : 'secondary'));
    if (tracks) content.replaceChildren(trackRows(tracks[String(trackId)] ?? []));
  };
  host.mount('leaderboard', [
    title(true),
    el('h2', { text: `Clasament: cei mai buni ${LEADERBOARD_SIZE} timpi` }),
    el('div', { class: 'tabs', attrs: { role: 'tablist' } }, tabs),
    content,
    el('p', {
      class: 'note',
      text: `Intră doar manșele online cu cel puțin ${LEADERBOARD_MIN_HUMANS} jucători care chiar au condus (boții nu contează), doar cine a trecut linia de sosire, doar pe cele trei pârtii fixe: cel mai bun timp al fiecărei porecle.`,
    }),
    button('Înapoi', back, 'primary', 'medium'),
  ]);
  onKeyFor(host.life, 'Escape', back);
  select(current);
  void (async () => {
    const result = await fetchLeaderboard();
    // The player may have gone back while the request was out.
    if (!host.isActive()) return;
    if (result === null) {
      content.replaceChildren(el('p', { class: 'message', text: 'Clasamentul nu e disponibil acum: serverul nu răspunde. Încearcă puțin mai târziu.' }));
      return;
    }
    tracks = result;
    select(current);
  })();
}

function savedTab(): number {
  const saved = Number(load('leaderboardTab'));
  return FIXED_TRACK_IDS.includes(saved) ? saved : FIXED_TRACK_IDS[0]!;
}

function trackRows(entries: LeaderboardEntry[]): HTMLElement {
  if (entries.length === 0) return el('p', { class: 'message info', text: 'Încă nu e niciun timp pe pârtia asta. Fii primul!' });
  const me = nameKey(load('name') ?? '');
  const head = el(
    'tr',
    {},
    [
      ['Loc', ''],
      ['Porecla', ''],
      ['Timp', 'Cel mai bun timp, de la HAI! până la sosire'],
      ['Data', 'Când a fost stabilit (ora României)'],
    ].map(([text, hint]) => el('th', { text, attrs: hint ? { title: hint } : {} })),
  );
  const rows = entries.map((e) => {
    const medal = MEDALS[e.place - 1];
    const classes = [medal, nameKey(e.name) === me ? 'me' : ''].filter(Boolean).join(' ');
    return el('tr', { class: classes }, [
      el('td', { class: 'place', text: String(e.place) }),
      el('td', { class: 'name', text: e.name }),
      el('td', { class: 'time', text: formatRecordTime(e.ms) }),
      el('td', { class: 'date', text: formatRecordDate(e.setAt) }),
    ]);
  });
  const tableNode = el('table', { class: 'leaderboard-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]);
  // A narrow phone scrolls the table sideways instead of squeezing it.
  return el('div', { class: 'table-scroll' }, [tableNode]);
}
