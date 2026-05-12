/**
 * One-time setup: registers the filesystem repository, installs sample data,
 * and takes the baseline snapshot that all subsequent tests depend on.
 *
 * Run this first. It is safe to re-run — each step is idempotent.
 */
import { test, expect } from '@playwright/test';
import {
  registerFsRepository,
  installSampleData,
  snapshotExists,
  takeSnapshot,
  REPO_NAME,
  SNAPSHOT_NAME,
  TEST_INDEX,
} from '../helpers/es-api';
import { gotoRepositories, gotoSnapshots } from '../fixtures/kibana-page';

test.describe.configure({ mode: 'serial' });

test('register filesystem repository', async ({ page }) => {
  await registerFsRepository();

  await gotoRepositories(page);
  await expect(page.getByRole('link', { name: REPO_NAME }).or(page.getByText(REPO_NAME)).first())
    .toBeVisible({ timeout: 15_000 });
});

test('install eCommerce sample data', async ({ page }) => {
  await installSampleData();

  // Just confirm Kibana is reachable and we are logged in
  await page.goto('/app/home');
  await expect(page).toHaveURL(/app\/home/, { timeout: 15_000 });
});

test('take baseline snapshot', async ({ page }) => {
  if (!(await snapshotExists(REPO_NAME, SNAPSHOT_NAME))) {
    await takeSnapshot(REPO_NAME, SNAPSHOT_NAME, [TEST_INDEX]);
  }

  await gotoSnapshots(page);
  await expect(page.getByText(SNAPSHOT_NAME).first()).toBeVisible({ timeout: 30_000 });
});
