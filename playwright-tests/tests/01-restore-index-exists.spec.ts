/**
 * FAILURE STATE: Restore fails because the target index already exists (and is open).
 *
 * Elasticsearch refuses to restore over an open index. The Kibana UI should surface
 * an error notification after the restore is submitted. This test captures that
 * failure state on video without deleting or closing the index first.
 *
 * Mirrors: notebook 05 — "Full Restore" section, before the close-index workaround.
 */
import { test, expect } from '@playwright/test';
import { installSampleData, indexExists, REPO_NAME, SNAPSHOT_NAME, TEST_INDEX } from '../helpers/es-api';
import { gotoSnapshots, openSnapshotDetail, clickRestoreSnapshot, wizardNext, wizardSubmit } from '../fixtures/kibana-page';

test.beforeAll(async () => {
  // Ensure the index exists and is open — this is what causes the conflict
  await installSampleData();
  const exists = await indexExists(TEST_INDEX);
  if (!exists) throw new Error(`${TEST_INDEX} does not exist; run 00-setup first`);
});

test('restore fails with index-already-open error', async ({ page }) => {
  await openSnapshotDetail(page, SNAPSHOT_NAME);
  await clickRestoreSnapshot(page, REPO_NAME, SNAPSHOT_NAME);

  // Step 1: Logistics — keep default selection (includes TEST_INDEX, no rename)
  await wizardNext(page);

  // Step 2: Index settings — no changes
  await wizardNext(page);

  // Step 3: Review — submit the restore
  await wizardSubmit(page);

  // Kibana shows a callout with data-test-subj="restoreSnapshotError" on failure
  await expect(page.locator('[data-test-subj="restoreSnapshotError"]'))
    .toBeVisible({ timeout: 20_000 });
});
