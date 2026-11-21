import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Every test file boots the server on the same port.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
