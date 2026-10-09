/**
 * Vitest configuration — covers only the ED triage module tests.
 *
 * Runs in Node environment (no DOM needed for business logic).
 * The existing tests/aiTestRun.js is unaffected (it uses `npm test`).
 * ED tests are run with `npm run test:ed`.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/ed/**/*.test.js'],
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
