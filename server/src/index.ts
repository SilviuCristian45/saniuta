import { GAME_TITLE } from '@saniuta/shared';
import { createServer } from './app';
import { HOST, PORT } from './config';

const server = createServer();
await server.listen(PORT, HOST);
console.log(`${GAME_TITLE}: server pe http://${HOST}:${PORT}`);
