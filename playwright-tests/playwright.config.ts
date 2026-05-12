import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const KIBANA_PORT = process.env.KIBANA_PORT ?? '5601';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: `http://localhost:${KIBANA_PORT}`,
    testIdAttribute: 'data-test-subj',  // Kibana uses data-test-subj, not data-testid
    viewport: null,
    video: 'on',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // Runs first: logs into Kibana once and saves the session to disk.
    // The VSCode extension automatically runs this before any dependent test.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // All snapshot/restore tests — depend on setup so auth runs first.
    {
      name: 'tests',
      testMatch: /\d{2}-.*\.spec\.ts/,
      use: { storageState: path.join(__dirname, 'playwright', '.auth', 'state.json') },
      dependencies: ['setup'],
    },
  ],
});
