/**
 * FEATURE STATES: Demonstrate restoring individual Elasticsearch feature states.
 *
 * Feature states are named bundles of system indices owned by a specific feature.
 * Snapshotting with feature_states: ["kibana"] captures all .kibana* indices;
 * feature_states: ["security"] captures .security* indices. Each test below
 * restores exactly one feature state so the effect is clearly isolated.
 *
 * Tests run serially — each manages its own snapshot and cleans up after itself.
 *
 * Mirrors: notebook 02 (what is in a snapshot — feature states section) and
 * notebook 05 (restoring snapshots — feature state restore section).
 */
import { test, expect } from '@playwright/test';
import {
  registerFsRepository,
  createDashboard,
  deleteSavedObject,
  deleteSavedObjectsByTitle,
  takeKibanaFeatureSnapshot,
  restoreKibanaFeatureState,
  createRole,
  deleteRole,
  takeSecurityFeatureSnapshot,
  restoreSecurityFeatureState,
  waitForKibanaReady,
  deleteSnapshot,
  REPO_NAME,
} from '../helpers/es-api';
import {
  gotoSnapshots,
  gotoDashboards,
  gotoSecurityRoles,
  ensureAuthenticated,
  showOverlay,
  clearOverlay,
} from '../fixtures/kibana-page';

test.describe.configure({ mode: 'serial' });

const KIBANA_SNAP = 'playwright-kibana-feature-state';
const SECURITY_SNAP = 'playwright-security-feature-state';
const DASHBOARD_TITLE = 'Playwright Feature State Demo';
const TEST_ROLE = 'playwright-training-role';

let dashboardId: string;

test.beforeAll(async () => {
  await registerFsRepository();
  await deleteSnapshot(REPO_NAME, KIBANA_SNAP);
  await deleteSnapshot(REPO_NAME, SECURITY_SNAP);
  // Remove any dashboards left over from previous runs so the "not visible" assertion is reliable
  await deleteSavedObjectsByTitle('dashboard', DASHBOARD_TITLE);
});

test.afterAll(async () => {
  await deleteSnapshot(REPO_NAME, KIBANA_SNAP);
  await deleteSnapshot(REPO_NAME, SECURITY_SNAP);
  await deleteRole(TEST_ROLE);
  await deleteSavedObjectsByTitle('dashboard', DASHBOARD_TITLE);
});

// ── Kibana feature state ──────────────────────────────────────────────────────

test('kibana feature state snapshot appears in the Kibana snapshot list', async ({ page }) => {
  test.setTimeout(60_000);

  dashboardId = await createDashboard(DASHBOARD_TITLE);
  await takeKibanaFeatureSnapshot(REPO_NAME, KIBANA_SNAP);

  await gotoSnapshots(page);
  await showOverlay(page, '📸  Snapshot taken with feature_states: ["kibana"] — it captures all .kibana* indices. Here it is in the list.');
  await expect(page.getByText(KIBANA_SNAP).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_000);
  await clearOverlay(page);
});

test('kibana feature state restore recovers a deleted dashboard', async ({ page }) => {
  test.setTimeout(180_000);

  // Kibana stamps data-test-subj="dashboardListingTitleLink-{Title-Kebab-Case}" on the listing link
  const titleTestId = 'dashboardListingTitleLink-' + DASHBOARD_TITLE.replace(/\s+/g, '-');
  const dashboardLocator = page.getByTestId(titleTestId);

  // Step 1 — navigate to dashboards and show it exists
  await gotoDashboards(page, DASHBOARD_TITLE);
  await showOverlay(page, '👀  Step 1 of 4 — The dashboard exists in Kibana. Here it is in the Dashboards listing.');
  await expect(dashboardLocator).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(10_000);

  // Step 2 — delete it and show it is gone
  await showOverlay(page, '🗑️  Step 2 of 4 — Deleting the dashboard via API to simulate accidental data loss…');
  await page.waitForTimeout(3_000);
  await deleteSavedObject('dashboard', dashboardId);
  await gotoDashboards(page, DASHBOARD_TITLE);
  await showOverlay(page, '❌  Step 2 of 4 — Dashboard is gone. The filtered listing shows no matching result.');
  await expect(dashboardLocator).not.toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(10_000);

  // Step 3 — restore the kibana feature state
  await showOverlay(page, '🔄  Step 3 of 4 — Restoring the kibana feature state. ES closes .kibana* indices and replays the snapshot…');
  await page.waitForTimeout(3_000);
  await restoreKibanaFeatureState(REPO_NAME, KIBANA_SNAP);
  await waitForKibanaReady();

  // Step 4 — confirm the dashboard is back
  await gotoDashboards(page, DASHBOARD_TITLE);
  await showOverlay(page, '✅  Step 4 of 4 — Restore complete. Confirming the dashboard is back in the listing.');
  await expect(dashboardLocator).toBeVisible({ timeout: 30_000 });
  await showOverlay(page, '🎉  Step 4 of 4 — Dashboard is back! The kibana feature state restore recovered the deleted object.');
  await page.waitForTimeout(10_000);
  await clearOverlay(page);
});

// ── Security feature state ────────────────────────────────────────────────────

test('security feature state snapshot appears in the Kibana snapshot list', async ({ page }) => {
  test.setTimeout(60_000);

  await showOverlay(page, '⚙️  Creating a test role to include in the security feature state snapshot…');
  await createRole(TEST_ROLE);

  await showOverlay(page, '📸  Taking a snapshot with feature_states: ["security"] — captures .security* indices…');
  await takeSecurityFeatureSnapshot(REPO_NAME, SECURITY_SNAP);

  await showOverlay(page, '✅  Snapshot complete — navigating to Roles to confirm the role exists before deletion.');
  await gotoSecurityRoles(page);
  await expect(page.getByText(TEST_ROLE)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_000);
  await clearOverlay(page);
});

test('security feature state restore recovers a deleted role', async ({ page }) => {
  test.setTimeout(120_000);

  await showOverlay(page, '🗑️  Deleting the role via API to simulate data loss…');
  await deleteRole(TEST_ROLE);
  await gotoSecurityRoles(page);
  await expect(page.getByText(TEST_ROLE)).not.toBeVisible({ timeout: 10_000 });
  await showOverlay(page, '❌  Role is gone — the security feature state needs to be restored.');
  await page.waitForTimeout(3_000);

  await showOverlay(page, '🔄  Restoring security feature state — briefly closes .security* indices (session may reset)…');
  await restoreSecurityFeatureState(REPO_NAME, SECURITY_SNAP);

  await ensureAuthenticated(page);
  await waitForKibanaReady();

  await showOverlay(page, '✅  Restore complete — reloading Roles to confirm the role is back.');
  await gotoSecurityRoles(page);
  await expect(page.getByText(TEST_ROLE)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await clearOverlay(page);
});
