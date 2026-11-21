import { defineConfig } from 'vitest/config';

// Only the DOM-free parts of the client are tested (node environment, no browser).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
