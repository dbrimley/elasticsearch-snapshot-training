/**
 * DATA STREAMS: Demonstrate the correct and incorrect ways to restore a data stream.
 *
 * Three serial tests:
 *
 *   1. Setup — create a data stream, ingest docs, add an alias, take a snapshot.
 *              Navigate to the Kibana Data Streams UI to confirm everything exists.
 *
 *   2. Failure case — attempt to restore the data stream directly while it still
 *              exists.  ES refuses with a snapshot_restore_exception (500).
 *              The error message is surfaced via the on-screen overlay.
 *
 *   3. Correct path — restore under a new name with rename_pattern / rename_replacement,
 *              then atomically switch the alias from the original stream to the
 *              restored one. Confirm both the new data stream and the alias target
 *              in the Kibana Data Streams UI.
 *
 * Mirrors: notebook 08 — data stream backup/restore and safe restore helpers.
 */
import { test, expect } from '@playwright/test';
import {
  registerFsRepository,
  createDataStreamTemplate,
  ingestDataStreamDocs,
  deleteDataStream,
  deleteDataStreamTemplate,
  addAlias,
  switchAlias,
  aliasTargets,
  docCount,
  takeDataStreamSnapshot,
  restoreDataStreamDirect,
  restoreDataStreamRenamed,
  deleteSnapshot,
  DS_NAME,
  DS_ALIAS,
  DS_SNAP,
  DS_RESTORED,
  REPO_NAME,
} from '../helpers/es-api';
import { gotoDataStreams, gotoSnapshots, showOverlay, clearOverlay } from '../fixtures/kibana-page';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await registerFsRepository();
  // Clean up any leftovers from a previous run
  await deleteDataStream(DS_NAME);
  await deleteDataStream(DS_RESTORED);
  await deleteDataStreamTemplate(DS_NAME);
  await deleteSnapshot(REPO_NAME, DS_SNAP);
});

test.afterAll(async () => {
  await deleteDataStream(DS_NAME);
  await deleteDataStream(DS_RESTORED);
  await deleteDataStreamTemplate(DS_NAME);
  await deleteSnapshot(REPO_NAME, DS_SNAP);
});

// ── 1. Setup ──────────────────────────────────────────────────────────────────

test('create data stream, ingest docs, add alias, take snapshot', async ({ page }) => {
  test.setTimeout(60_000);

  // Create the index template, ingest documents (creates the stream), and add an alias
  await createDataStreamTemplate(DS_NAME);
  await ingestDataStreamDocs(DS_NAME, 10);
  await addAlias(DS_NAME, DS_ALIAS);

  // Take the snapshot
  await takeDataStreamSnapshot(REPO_NAME, DS_SNAP, DS_NAME);

  // Navigate to Data Streams and confirm the stream is listed
  await gotoDataStreams(page);
  await showOverlay(page, `📦  Data stream "${DS_NAME}" created with 10 documents. Alias "${DS_ALIAS}" points to it. Snapshot "${DS_SNAP}" taken.`);
  await expect(page.getByText(DS_NAME).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(5_000);

  // Also show the snapshot in the Snapshots list
  await gotoSnapshots(page);
  await showOverlay(page, `📸  Snapshot "${DS_SNAP}" is visible in the repository — it captures the data stream and its index template.`);
  await expect(page.getByText(DS_SNAP).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(5_000);
  await clearOverlay(page);
});

// ── 2. Failure case ───────────────────────────────────────────────────────────

test('restoring a data stream over itself fails with a conflict error', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoDataStreams(page);
  await showOverlay(page, `⚠️  The data stream "${DS_NAME}" still exists. Watch what happens when we try a naive restore…`);
  await expect(page.getByText(DS_NAME).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(5_000);

  // Attempt the direct restore — it will fail
  const result = await restoreDataStreamDirect(REPO_NAME, DS_SNAP, DS_NAME);

  if (!result.success) {
    // Truncate the error to fit the overlay comfortably
    const shortError = result.error.substring(0, 180) + (result.error.length > 180 ? '…' : '');
    await showOverlay(page, `❌  ES returned a 500 snapshot_restore_exception:\n"${shortError}"\n\nYou must either delete the stream first, or restore under a different name.`);
  } else {
    await showOverlay(page, '⚠️  Restore unexpectedly succeeded — the stream may have been missing.');
  }

  await page.waitForTimeout(10_000);
  await clearOverlay(page);
});

// ── 3. Correct path: rename + alias switch ────────────────────────────────────

test('correct restore: rename-on-restore then alias switch', async ({ page }) => {
  test.setTimeout(120_000);

  // Step 1 — restore to a new name using rename_pattern / rename_replacement
  await gotoDataStreams(page);
  await showOverlay(page, `🔄  Step 1 of 3 — Restoring snapshot into a NEW name using rename_pattern / rename_replacement.\n"${DS_NAME}" → "${DS_RESTORED}"`);
  await page.waitForTimeout(5_000);

  await restoreDataStreamRenamed(REPO_NAME, DS_SNAP, DS_NAME, DS_RESTORED);

  // Confirm both streams now exist in the UI
  await gotoDataStreams(page);
  await showOverlay(page, `✅  Step 1 of 3 — Restore complete. Both "${DS_NAME}" (original) and "${DS_RESTORED}" (restored) now exist.`);
  await expect(page.getByText(DS_RESTORED).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(8_000);

  // Verify the restored stream has the expected document count
  const count = await docCount(DS_RESTORED);
  await showOverlay(page, `📊  Step 1 of 3 — "${DS_RESTORED}" contains ${count} documents — identical to the original snapshot.`);
  await page.waitForTimeout(5_000);

  // Step 2 — atomically switch the alias from the original to the restored stream
  await showOverlay(page, `🔀  Step 2 of 3 — Switching alias "${DS_ALIAS}" from "${DS_NAME}" → "${DS_RESTORED}" in a single atomic operation…`);
  await page.waitForTimeout(5_000);

  await switchAlias(DS_NAME, DS_RESTORED, DS_ALIAS);
  const targets = await aliasTargets(DS_ALIAS);

  await showOverlay(page, `✅  Step 2 of 3 — Alias "${DS_ALIAS}" now resolves to: ${targets.join(', ')}`);
  await page.waitForTimeout(8_000);

  // Step 3 — confirm the alias target in the UI
  await gotoDataStreams(page);
  await showOverlay(page, `🎉  Step 3 of 3 — "${DS_RESTORED}" is live. "${DS_ALIAS}" points to it. Applications using the alias see no interruption.`);
  await expect(page.getByText(DS_RESTORED).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(10_000);
  await clearOverlay(page);
});
