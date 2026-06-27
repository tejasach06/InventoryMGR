import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/test/**/*.test.ts', 'src/test/**/*.test.tsx'],
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Next.js App Router entry points (root layout loads next/font, server/client
      // route composition) are exercised by the Playwright E2E suite, not jsdom units.
      exclude: ['src/app/**', 'src/test/**', '**/*.d.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
});
