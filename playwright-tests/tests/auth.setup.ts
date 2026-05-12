/**
 * Authentication setup — runs once before all tests (and before any single test
 * run via the VSCode Playwright extension). Logs into Kibana and saves the session
 * state so subsequent tests start already authenticated.
 */
import { test as setup } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PASSWORD = process.env.ELASTIC_PASSWORD ?? 'training123';
const authFile = path.join(__dirname, '..', 'playwright', '.auth', 'state.json');

setup('authenticate with Kibana', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[data-test-subj="loginUsername"]', 'elastic');
  await page.fill('[data-test-subj="loginPassword"]', PASSWORD);
  await page.click('[data-test-subj="loginSubmit"]');

  // Wait until we are no longer on the login page
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
