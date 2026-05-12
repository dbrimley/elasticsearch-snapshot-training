/**
 * SUCCESS PATH: Restore with rename avoids the index-conflict error.
 *
 * Using Kibana's rename fields in the restore wizard, the snapshot index is
 * restored under a new name alongside the original. This serves as a visual
 * contrast to test 01 — the "correct" way to restore without deleting first.
 *
 * Mirrors: notebook 05 — "Rename on Restore" section.
 */
import { test, expect } from '@playwright/test';
import { deleteIndex, indexExists, waitForRestore } from '../helpers/es-api';
import { REPO_NAME, SNAPSHOT_NAME, TEST_INDEX } from '../helpers/es-api';
import { gotoSnapshots, openSnapshotDetail, clickRestoreSnapshot, wizardNext, wizardSubmit } from '../fixtures/kibana-page';

const RENAMED_INDEX = 'ecommerce-restored-copy';

test.beforeAll(async () => {
  await deleteIndex(RENAMED_INDEX);
});

test.afterAll(async () => {
  await deleteIndex(RENAMED_INDEX);
});

test('restore succeeds using rename pattern', async ({ page }) => {
  await openSnapshotDetail(page, SNAPSHOT_NAME);
  await clickRestoreSnapshot(page, REPO_NAME, SNAPSHOT_NAME);

  // Step 1: Logistics — enable rename and configure pattern
  // Kibana exposes a "Rename indices" toggle/section in the Logistics step
  const renameToggle = page
    .getByRole('switch', { name: /rename/i })
    .or(page.getByLabel(/rename/i))
    .or(page.getByText(/rename indices/i));
  await renameToggle.click();

  // Kibana 9.3 labels these fields "Capture pattern" and "Replacement pattern"
  await page.getByLabel(/capture pattern/i).fill(`kibana_sample_data_(.*)`);
  await page.getByLabel(/replacement pattern/i).fill('$1-restored-copy');

  await wizardNext(page);

  // Step 2: Index settings — no changes
  await wizardNext(page);

  // Step 3: Review — submit
  await wizardSubmit(page);

  // Kibana should show a success notification / navigate to Restore Activity
  const successIndicator = page
    .getByText(/successfully started|restore started|restore complete/i)
    .or(page.getByRole('alert').filter({ hasText: /success/i }));

  await expect(successIndicator.or(page.getByText(RENAMED_INDEX)))
    .toBeVisible({ timeout: 20_000 });

  // Wait for the restore to finish and verify the renamed index exists
  await waitForRestore(RENAMED_INDEX);
  const exists = await indexExists(RENAMED_INDEX);
  expect(exists).toBe(true);
});
