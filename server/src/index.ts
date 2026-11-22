import { GAME_TITLE } from '@saniuta/shared';
import { createServer } from './app';
import { DB_PATH, HOST, PORT } from './config';
import { openLeaderboard, useLeaderboard } from './leaderboard';

const board = openLeaderboard(DB_PATH);
useLeaderboard(board);
console.log(board ? `Clasament: ${DB_PATH}` : 'Clasament dezactivat (vezi eroarea de mai sus); jocul merge fără el.');

const server = createServer();
await server.listen(PORT, HOST);
console.log(`${GAME_TITLE}: server pe http://${HOST}:${PORT}`);
