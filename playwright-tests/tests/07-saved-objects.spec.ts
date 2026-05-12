/**
 * SAVED OBJECTS: Demonstrate that individual Kibana saved-object types survive
 * a kibana feature-state snapshot and restore cycle.
 *
 * Each test independently:
 *   1. Creates a saved object via API.
 *   2. Captures a kibana-feature-state snapshot.
 *   3. Navigates to the relevant Kibana UI page — object is visible.
 *   4. Deletes the object via API and reloads the page — object is gone.
 *   5. Restores the kibana feature state.
 *   6. Reloads the page — object is back.
 *
 * Tests run serially to avoid concurrent snapshot/restore conflicts.
 *
 * Mirrors: notebooks 04_01 (data views), 04_06 (dashboards), 04_08 (tags).
 */
import { test, expect } from '@playwright/test';
import {
  registerFsRepository,
  createTag,
  createDataView,
  createDashboard,
  deleteSavedObject,
  deleteSavedObjectsByTitle,
  deleteDataView,
  takeKibanaFeatureSnapshot,
  restoreKibanaFeatureState,
  waitForKibanaReady,
  deleteSnapshot,
  REPO_NAME,
} from '../helpers/es-api';
import {
  gotoTags,
  gotoDataViews,
  gotoDashboards,
  showOverlay,
  clearOverlay,
} from '../fixtures/kibana-page';

test.describe.configure({ mode: 'serial' });

const SNAP_TAG = 'playwright-saved-obj-tag';
const SNAP_DV = 'playwright-saved-obj-data-view';
const SNAP_DASH = 'playwright-saved-obj-dashboard';

const TAG_NAME = 'playwright-training';
const DATA_VIEW_TITLE = 'playwright-training-*';
const DASHBOARD_TITLE = 'Playwright Training Dashboard';

test.beforeAll(async () => {
  await registerFsRepository();
  for (const snap of [SNAP_TAG, SNAP_DV, SNAP_DASH]) {
    await deleteSnapshot(REPO_NAME, snap);
  }
  // Remove leftovers from previous runs so creates and "not visible" assertions are reliable
  await deleteSavedObjectsByTitle('tag', TAG_NAME);
  await deleteSavedObjectsByTitle('index-pattern', DATA_VIEW_TITLE);
  await deleteSavedObjectsByTitle('dashboard', DASHBOARD_TITLE);
});

test.afterAll(async () => {
  for (const snap of [SNAP_TAG, SNAP_DV, SNAP_DASH]) {
    await deleteSnapshot(REPO_NAME, snap);
  }
  await deleteSavedObjectsByTitle('tag', TAG_NAME);
  await deleteSavedObjectsByTitle('index-pattern', DATA_VIEW_TITLE);
  await deleteSavedObjectsByTitle('dashboard', DASHBOARD_TITLE);
});

// ── Tags ──────────────────────────────────────────────────────────────────────

test('tag saved object survives kibana feature-state snapshot and restore', async ({ page }) => {
  test.setTimeout(120_000);

  await showOverlay(page, '⚙️  Creating tag saved object: "playwright-training"…');
  const tagId = await createTag(TAG_NAME);

  await showOverlay(page, '📸  Taking kibana feature-state snapshot — captures all .kibana* indices including tags…');
  await takeKibanaFeatureSnapshot(REPO_NAME, SNAP_TAG);

  await showOverlay(page, '✅  Snapshot done — confirming the tag is visible in the Tags management UI.');
  await gotoTags(page);
  // Use getByTestId('tagsTableRowName') to target only the visible badge, not the screen-reader span
  const tagLocator = page.getByTestId('tagsTableRowName').getByText(TAG_NAME);
  await expect(tagLocator).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_000);

  await showOverlay(page, '🗑️  Deleting the tag via API to simulate data loss…');
  await deleteSavedObject('tag', tagId);
  await gotoTags(page);
  await expect(tagLocator).not.toBeVisible({ timeout: 10_000 });
  await showOverlay(page, '❌  Tag is gone — restoring the kibana feature state will bring it back.');
  await page.waitForTimeout(3_000);

  await showOverlay(page, '🔄  Restoring kibana feature state — closing .kibana* indices and replaying snapshot…');
  await restoreKibanaFeatureState(REPO_NAME, SNAP_TAG);
  await waitForKibanaReady();

  await showOverlay(page, '✅  Restore complete — tag should be back in the Tags management UI.');
  await gotoTags(page);
  await expect(tagLocator).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await clearOverlay(page);
});

// ── Data Views ────────────────────────────────────────────────────────────────

test('data view saved object survives kibana feature-state snapshot and restore', async ({ page }) => {
  test.setTimeout(120_000);

  await showOverlay(page, '⚙️  Creating data view saved object: "playwright-training-*"…');
  const dvId = await createDataView(DATA_VIEW_TITLE);

  await showOverlay(page, '📸  Taking kibana feature-state snapshot — data views live in .kibana* indices…');
  await takeKibanaFeatureSnapshot(REPO_NAME, SNAP_DV);

  await showOverlay(page, '✅  Snapshot done — confirming the data view appears in Data Views management.');
  await gotoDataViews(page);
  await expect(page.getByText(DATA_VIEW_TITLE)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_000);

  await showOverlay(page, '🗑️  Deleting the data view via API to simulate data loss…');
  await deleteDataView(dvId);
  await gotoDataViews(page);
  await expect(page.getByText(DATA_VIEW_TITLE)).not.toBeVisible({ timeout: 10_000 });
  await showOverlay(page, '❌  Data view is gone — restoring the kibana feature state will bring it back.');
  await page.waitForTimeout(3_000);

  await showOverlay(page, '🔄  Restoring kibana feature state — closing .kibana* indices and replaying snapshot…');
  await restoreKibanaFeatureState(REPO_NAME, SNAP_DV);
  await waitForKibanaReady();

  await showOverlay(page, '✅  Restore complete — data view should be back in Data Views management.');
  await gotoDataViews(page);
  await expect(page.getByText(DATA_VIEW_TITLE)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await clearOverlay(page);
});

// ── Dashboards ────────────────────────────────────────────────────────────────

test('dashboard saved object survives kibana feature-state snapshot and restore', async ({ page }) => {
  test.setTimeout(120_000);

  const dashId = await createDashboard(DASHBOARD_TITLE);
  await takeKibanaFeatureSnapshot(REPO_NAME, SNAP_DASH);

  // Kibana stamps data-test-subj="dashboardListingTitleLink-{Title-Kebab-Case}" on the
  // listing link — use that to avoid strict-mode violations from screen-reader spans.
  const titleTestId = 'dashboardListingTitleLink-' + DASHBOARD_TITLE.replace(/\s+/g, '-');
  const dashLocator = page.getByTestId(titleTestId);

  await gotoDashboards(page, DASHBOARD_TITLE);
  await showOverlay(page, '✅  Snapshot done — confirming the dashboard appears in the Dashboards listing.');
  await expect(dashLocator).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_000);

  await showOverlay(page, '🗑️  Deleting the dashboard via API to simulate data loss…');
  await deleteSavedObject('dashboard', dashId);
  await gotoDashboards(page, DASHBOARD_TITLE);
  await showOverlay(page, '❌  Dashboard is gone — restoring the kibana feature state will bring it back.');
  await expect(dashLocator).not.toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3_000);

  await restoreKibanaFeatureState(REPO_NAME, SNAP_DASH);
  await waitForKibanaReady();

  await gotoDashboards(page, DASHBOARD_TITLE);
  await showOverlay(page, '✅  Restore complete — dashboard should be back in the Dashboards listing.');
  await expect(dashLocator).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await clearOverlay(page);
});
