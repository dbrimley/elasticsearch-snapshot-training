import { test as base, expect, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

export { expect } from '@playwright/test';

export type KibanaFixtures = {
  snapshotRestorePage: Page;
};

export const test = base.extend<KibanaFixtures>({
  snapshotRestorePage: async ({ page }, use) => {
    await page.goto('/app/management/data/snapshot_restore');
    await page.waitForURL(/snapshot_restore/, { timeout: 30_000 });
    await use(page);
  },
});

/** Navigate directly to the Snapshots tab and wait for it to load. */
export async function gotoSnapshots(page: Page): Promise<void> {
  await page.goto('/app/management/data/snapshot_restore/snapshots');
  await page.waitForURL(/snapshot_restore/, { timeout: 30_000 });
  // Dismiss any "start tour" prompts that Kibana shows on first visit
  const dismissBtn = page.getByRole('button', { name: /dismiss|no thanks|skip/i });
  if (await dismissBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dismissBtn.click();
  }
}

/** Navigate directly to the Repositories tab. */
export async function gotoRepositories(page: Page): Promise<void> {
  await page.goto('/app/management/data/snapshot_restore/repositories');
  await page.waitForURL(/snapshot_restore/, { timeout: 30_000 });
}

/**
 * Open a snapshot's detail flyout by clicking its name in the snapshots table.
 * Returns the locator for the flyout so callers can interact with it.
 */
export async function openSnapshotDetail(page: Page, snapshotName: string): Promise<void> {
  await gotoSnapshots(page);
  // Wait for the table to populate (it starts empty while ES is queried)
  await page.waitForSelector('table', { timeout: 15_000 });
  // The snapshot name is rendered as a link; fall back to any cell text match
  await page.getByRole('link', { name: snapshotName })
    .or(page.getByRole('cell', { name: snapshotName }))
    .first()
    .click();
  // Wait for flyout to appear so the video captures it before navigating to the wizard
  await page.waitForSelector('[class*="euiFlyout"], [class*="flyout"]', { timeout: 10_000 })
    .catch(() => {});
}

/**
 * Navigate directly to the restore wizard for a snapshot.
 * More reliable than clicking through the flyout; the flyout is visible in the video
 * from the preceding openSnapshotDetail call.
 */
export async function clickRestoreSnapshot(
  page: Page,
  repoName: string,
  snapshotName: string,
): Promise<void> {
  await page.goto(
    `/app/management/data/snapshot_restore/restore/${encodeURIComponent(repoName)}/${encodeURIComponent(snapshotName)}`,
  );
  await page.waitForURL(/restore/, { timeout: 20_000 });
}

/** Advance to the next step in the restore wizard. */
export async function wizardNext(page: Page): Promise<void> {
  const nextBtn = page.getByRole('button', { name: /next/i })
    .or(page.getByTestId('nextButton'));
  await nextBtn.click();
}

/** Submit the restore on the final Review step. */
export async function wizardSubmit(page: Page): Promise<void> {
  const submitBtn = page.getByRole('button', { name: /restore snapshot/i })
    .or(page.getByRole('button', { name: /^restore$/i }))
    .last();
  await submitBtn.click();
}

// ─── On-screen overlay ───────────────────────────────────────────────────────

/**
 * Inject a floating banner into the live page so observers watching the video
 * can follow what the test is doing at each step.
 */
export async function showOverlay(page: Page, message: string): Promise<void> {
  await page.evaluate((msg) => {
    const existing = document.getElementById('pw-training-overlay');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'pw-training-overlay';
    el.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,77,153,0.92)',
      'color:#fff',
      'padding:12px 28px',
      'border-radius:8px',
      'font-size:15px',
      'font-family:system-ui,sans-serif',
      'font-weight:500',
      'z-index:2147483647',
      'max-width:640px',
      'text-align:center',
      'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
      'pointer-events:none',
    ].join(';');
    el.textContent = msg;
    document.body.appendChild(el);
  }, message);
}

/** Remove the overlay injected by showOverlay. */
export async function clearOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('pw-training-overlay')?.remove();
  });
}

/** Navigate to Stack Management > Kibana > Tags. */
export async function gotoTags(page: Page): Promise<void> {
  await page.goto('/app/management/kibana/tags');
  await page.waitForURL(/tags/, { timeout: 30_000 });
}

/** Navigate to Stack Management > Kibana > Data Views. */
export async function gotoDataViews(page: Page): Promise<void> {
  await page.goto('/app/management/kibana/dataViews');
  await page.waitForURL(/dataViews/, { timeout: 30_000 });
}

/**
 * Navigate to the Dashboards app listing and wait for the listing to render.
 * Optionally filter by title to isolate a specific dashboard — necessary when
 * sample data has been installed and many dashboards exist.
 */
export async function gotoDashboards(page: Page, searchTitle?: string): Promise<void> {
  await page.goto('/app/dashboards');
  await page.waitForURL(/dashboards/, { timeout: 30_000 });
  // Wait for the search box — it appears once the listing has rendered.
  // Do NOT use waitForLoadState('networkidle'): Kibana polls continuously in the
  // background so networkidle never settles and the test hangs.
  const searchInput = page
    .getByTestId('tableListSearchBox')
    .or(page.getByRole('searchbox'))
    .or(page.getByPlaceholder(/search/i))
    .first();
  await searchInput.waitFor({ state: 'visible', timeout: 15_000 });
  if (searchTitle) {
    await searchInput.clear();
    await searchInput.fill(searchTitle);
    await page.waitForTimeout(800); // debounce the filter
  }
}

/** Navigate to Stack Management > Data > Index Management > Data Streams tab. */
export async function gotoDataStreams(page: Page): Promise<void> {
  await page.goto('/app/management/data/index_management/data_streams');
  await page.waitForURL(/data_streams/, { timeout: 30_000 });
  // Wait for the table or empty-state to appear
  await page.waitForSelector('table, [data-test-subj="sectionLoading"]', { timeout: 15_000 }).catch(() => {});
}

/** Navigate to Stack Management > Security > Roles. */
export async function gotoSecurityRoles(page: Page): Promise<void> {
  await page.goto('/app/management/security/roles');
  await page.waitForURL(/roles/, { timeout: 30_000 });
}

/**
 * Navigate to the home page and re-login if the current session has been
 * invalidated (e.g. after a security feature-state restore that briefly
 * closes the .security* indices).
 */
export async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto('/app/home');
  if (page.url().includes('/login')) {
    const password = process.env.ELASTIC_PASSWORD ?? 'training123';
    await page.fill('[data-test-subj="loginUsername"]', 'elastic');
    await page.fill('[data-test-subj="loginPassword"]', password);
    await page.click('[data-test-subj="loginSubmit"]');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  }
}
