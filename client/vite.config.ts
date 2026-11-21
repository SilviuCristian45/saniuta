import { defineConfig } from 'vite';

/**
 * Public address of the game, used for the absolute URLs link previews need (og:url, og:image).
 * Override at build time with SITE_URL=https://... npm run build.
 */
const SITE_URL = (process.env.SITE_URL ?? 'https://saniuta-la-vale.duckdns.org').replace(/\/$/, '');

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    },
  ],
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5175,
    // Reachable from a phone on the same Wi-Fi (http://<this PC's LAN address>:5175).
    host: true,
    // Same path as in production (Caddy handle_path): the prefix is stripped before the server.
    proxy: {
      '/colyseus': {
        target: 'http://127.0.0.1:2570',
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ''),
      },
    },
  },
});
