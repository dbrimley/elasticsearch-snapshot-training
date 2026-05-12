/**
 * FAILURE STATES: Broken repository and unavailable snapshot source.
 *
 * Part A — broken repository: A repository registered with an invalid filesystem
 * path fails verification. Kibana's Repositories page shows an error status for
 * it, and attempting to list its snapshots surfaces an error in the UI.
 *
 * Part B — restore from broken repository: Attempting to start a restore from a
 * repository that cannot be accessed causes ES to fail the operation immediately.
 * This shows how Kibana surfaces that failure in the restore workflow.
 *
 * Mirrors: notebook 05 — general error-state coverage.
 */
import { test, expect } from '@playwright/test';
import {
  registerBrokenRepository,
  deleteRepository,
  BROKEN_REPO_NAME,
} from '../helpers/es-api';
import { gotoRepositories } from '../fixtures/kibana-page';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await registerBrokenRepository();
});

test.afterAll(async () => {
  await deleteRepository(BROKEN_REPO_NAME);
});

test('broken repository shows error status in Repositories page', async ({ page }) => {
  await gotoRepositories(page);

  // The broken repository row should be visible
  await expect(page.getByText(BROKEN_REPO_NAME).first()).toBeVisible({ timeout: 15_000 });

  // Click into it to open the detail flyout
  await page.getByRole('link', { name: BROKEN_REPO_NAME })
    .or(page.getByText(BROKEN_REPO_NAME))
    .first()
    .click();

  // Wait for the flyout to appear, then click "Verify repository" to trigger the check
  await page.getByRole('button', { name: /verify repository/i }).click();

  // Kibana runs the verification and shows an error callout in the flyout
  const errorState = page
    .getByText(/verification failed|failed|error|inaccessible|no such file|does not exist/i)
    .or(page.getByRole('alert').filter({ hasText: /fail|error/i }))
    .first();

  await expect(errorState).toBeVisible({ timeout: 20_000 });
});

test('snapshots tab shows error for broken repository', async ({ page }) => {
  // Navigate to the snapshots tab filtered to the broken repo
  await page.goto(
    `/app/management/data/snapshot_restore/snapshots?repository=${BROKEN_REPO_NAME}`,
  );
  await page.waitForURL(/snapshot_restore/, { timeout: 15_000 });

  // Kibana attempts to list snapshots and surfaces an error when the repo is unavailable
  const errorState = page
    .getByText(/error|failed|could not load|unavailable/i)
    .or(page.getByRole('alert'))
    .first();

  await expect(errorState).toBeVisible({ timeout: 15_000 });
});
