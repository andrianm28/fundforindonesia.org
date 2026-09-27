import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // CI reads failures as annotations; locally the HTML report is easier to
  // explore.
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Mobile',
      use: {
        viewport: { width: 375, height: 667 },
      },
    },
    {
      name: 'Tablet',
      use: {
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'Desktop',
      use: {
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  // CI's e2e job builds first (`next build`) and the server under test is
  // the production bundle (`next start`), so what Playwright drives is what
  // ships. Locally `reuseExistingServer` lets a dev server stand in.
  webServer: {
    command: 'npx next start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
})
