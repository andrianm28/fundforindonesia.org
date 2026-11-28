import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Two projects so only component tests pay for jsdom. Under jsdom for every
// file the suite spent most of its time building DOM environments (282 s of
// "environment" over a 197 s run on 4 vCPU), and most .ts tests never touch
// the DOM. A .ts test that does needs `// @vitest-environment jsdom` as its
// first line. `include` lives only in the projects: with `extends: true`
// arrays are merged, so a root `include` would put every file in both.
const shared = {
  setupFiles: './tests/setup.ts',
  exclude: ['node_modules', 'tests/e2e/**'],
}

export default defineConfig({
  plugins: [react()],
  test: {
    passWithNoTests: true,
    // next-intl imports 'next/navigation' without the .js extension; inlining
    // lets Vite resolve it (otherwise Node's ESM resolver rejects it).
    server: { deps: { inline: ['next-intl'] } },
    projects: [
      {
        extends: true,
        test: {
          ...shared,
          name: 'node',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
        },
      },
      {
        extends: true,
        test: {
          ...shared,
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.tsx', 'tests/**/*.{test,spec}.tsx'],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
