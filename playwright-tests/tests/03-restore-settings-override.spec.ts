/**
 * FAILURE STATE: Kibana blocks restore when an immutable index setting is supplied.
 *
 * `index.number_of_shards` cannot be changed during a restore. In Kibana 9.3 this is
 * caught client-side: the Index Settings editor turns red and the "Next" button is
 * disabled, preventing the request from ever reaching ES.
 *
 * Mirrors: notebook 05 — "Override Settings on Restore" + note about immutable settings.
 */
import { test, expect } from '@playwright/test';
import { closeIndex, deleteIndex } from '../helpers/es-api';
import { REPO_NAME, SNAPSHOT_NAME, TEST_INDEX } from '../helpers/es-api';
import { gotoSnapshots, openSnapshotDetail, clickRestoreSnapshot, wizardNext, wizardSubmit } from '../fixtures/kibana-page';

const RENAMED_TARGET = 'ecommerce-settings-test';

test.beforeAll(async () => {
  // Use a renamed target so the restore attempt actually reaches ES
  await deleteIndex(RENAMED_TARGET);
});

test.afterAll(async () => {
  await deleteIndex(RENAMED_TARGET);
});

test('restore fails when overriding number_of_shards (immutable setting)', async ({ page }) => {
  await openSnapshotDetail(page, SNAPSHOT_NAME);
  await clickRestoreSnapshot(page, REPO_NAME, SNAPSHOT_NAME);

  // Step 1: Logistics — rename so there is no index-conflict interference
  const renameToggle = page
    .getByRole('switch', { name: /rename/i })
    .or(page.getByLabel(/rename/i))
    .or(page.getByText(/rename indices/i));
  await renameToggle.click();

  // Kibana 9.3 labels these fields "Capture pattern" and "Replacement pattern"
  await page.getByLabel(/capture pattern/i).fill(`kibana_sample_data_(.*)`);
  await page.getByLabel(/replacement pattern/i).fill('$1-settings-test');

  await wizardNext(page);

  // Step 2: Index settings — enable the "Modify index settings" toggle
  await page.getByRole('switch', { name: /modify index settings/i }).click();

  // Kibana 9.3 renders the settings editor as a Monaco code editor.
  // Monaco uses a hidden textarea as its accessible input — click with force to focus it,
  // then select all default content and type the override JSON.
  const monacoTextarea = page.locator('.euiCodeEditorWrapper textarea, .monaco-editor textarea').first();
  await monacoTextarea.click({ force: true });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('{\n  "index.number_of_shards": 10\n}');

  // Kibana 9.3 validates settings client-side: number_of_shards is flagged immediately
  // and the Next button is disabled until the invalid setting is removed.
  await expect(page.getByTestId('nextButton'))
    .toBeDisabled({ timeout: 10_000 });
});
