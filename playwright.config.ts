import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers:1,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 844 } },
  webServer: [
    { command: 'pnpm --filter @basket/server dev', url: 'http://127.0.0.1:8787/api/clock', reuseExistingServer: !process.env.CI },
    { command: 'pnpm --filter @basket/web dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  ],
});
