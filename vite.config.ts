import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    // A test run has no `.env`, and `lib/env.mjs` throws on import when
    // required variables are missing — so any suite that transitively reaches
    // it failed before its first assertion. Individual files worked around this
    // by mocking the module; this is the same fix, once, for the ones that have
    // no other reason to know env exists.
    env: { SKIP_ENV_VALIDATION: '1' },
  },
});


