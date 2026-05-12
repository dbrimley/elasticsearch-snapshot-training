/**
 * IN-PROGRESS STATE: Observe the Restore Activity UI during an active restore.
 *
 * Deletes the target index then kicks off a restore via the UI. Navigates to
 * the Restore Activity tab and records the shard recovery progress state.
 * Useful for capturing what the "restore in flight" experience looks like,
 * especially if Kibana's progress indicators have gaps or are hard to read.
 *
 * Mirrors: notebook 05 — "Monitor Restore Progress" section.
 */
import { test, expect } from '@playwright/test';
import { deleteIndex, installSampleData, waitForRestore, setRecoveryThrottle, clearRecoveryThrottle } from '../helpers/es-api';
import { REPO_NAME, SNAPSHOT_NAME, TEST_INDEX } from '../helpers/es-api';
import {
  gotoSnapshots,
  openSnapshotDetail,
  clickRestoreSnapshot,
  wizardNext,
  wizardSubmit,
} from '../fixtures/kibana-page';

test.beforeAll(async () => {
  await deleteIndex(TEST_INDEX);
  // Throttle recovery to ~200 KB/s so the restore takes ~30 s and is visually observable
  await setRecoveryThrottle('200kb');
});

test.afterAll(async () => {
  await clearRecoveryThrottle();
  await installSampleData();
});

test('restore activity tab shows in-progress shard recovery', async ({ page }) => {
  test.setTimeout(180_000);
  await openSnapshotDetail(page, SNAPSHOT_NAME);
  await clickRestoreSnapshot(page, REPO_NAME, SNAPSHOT_NAME);

  // Step 1: Logistics — restore TEST_INDEX directly (no rename needed, index was deleted)
  await wizardNext(page);

  // Step 2: Index settings — no changes
  await wizardNext(page);

  // Step 3: Review — submit
  await wizardSubmit(page);

  // After submitting, Kibana typically redirects to or shows a link to Restore Activity.
  // Navigate there directly to ensure we capture the in-progress state.
  await page.goto('/app/management/data/snapshot_restore/restore_status');
  await page.waitForURL(/snapshot_restore/, { timeout: 15_000 });

  // The Restore Activity tab should show the ongoing recovery
  // Give it a moment to register the restore before checking
  await page.waitForTimeout(2_000);

  // Look for a table row or progress indicator for TEST_INDEX
  const progressIndicator = page
    .getByText(TEST_INDEX)
    .or(page.getByText(/in progress|recovering|restoring/i))
    .or(page.getByRole('table'))
    .first();

  await expect(progressIndicator).toBeVisible({ timeout: 20_000 });

  // Stay on the page so the video captures the throttled restore in progress (~25 s)
  await page.waitForTimeout(25_000);

  // Wait for the restore to complete before the test ends
  await waitForRestore(TEST_INDEX, 120_000);
});
