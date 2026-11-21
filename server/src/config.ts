/** Loopback only: Caddy is the public entry point. */
export const HOST = process.env.HOST ?? '127.0.0.1';
/** 2570 in dev and in production (saniuta.service); the server tests use 2571. */
export const PORT = Number(process.env.PORT ?? 2570);
