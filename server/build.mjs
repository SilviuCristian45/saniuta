// Production bundle: one ESM file with /shared and every dependency inlined,
// so the VPS only needs `node dist/index.js` (no node_modules).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: false,
  sourcemap: true,
  legalComments: 'none',
  // Bundled CommonJS dependencies still call require() for Node built-ins.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
