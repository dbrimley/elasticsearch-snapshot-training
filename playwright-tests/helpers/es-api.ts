import axios, { AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const ES_PORT = process.env.ES_PORT ?? '9200';
const KIBANA_PORT = process.env.KIBANA_PORT ?? '5601';
const ELASTIC_PASSWORD = process.env.ELASTIC_PASSWORD ?? 'training123';

const es: AxiosInstance = axios.create({
  baseURL: `http://localhost:${ES_PORT}`,
  auth: { username: 'elastic', password: ELASTIC_PASSWORD },
  headers: { 'Content-Type': 'application/json' },
});

const kibana: AxiosInstance = axios.create({
  baseURL: `http://localhost:${KIBANA_PORT}`,
  auth: { username: 'elastic', password: ELASTIC_PASSWORD },
  headers: {
    'Content-Type': 'application/json',
    'kbn-xsrf': 'playwright',
    'x-elastic-internal-origin': 'Kibana',
  },
});

export const REPO_NAME = 'playwright-fs';
export const BROKEN_REPO_NAME = 'playwright-broken';
export const SNAPSHOT_NAME = 'playwright-baseline';
export const SNAPSHOT_PATH = '/usr/share/elasticsearch/snapshots';
export const TEST_INDEX = 'kibana_sample_data_ecommerce';

export async function registerFsRepository(name = REPO_NAME): Promise<void> {
  await es.put(`/_snapshot/${name}`, {
    type: 'fs',
    settings: { location: SNAPSHOT_PATH },
  });
}

export async function registerBrokenRepository(name = BROKEN_REPO_NAME): Promise<void> {
  // Register as a valid fs repo (ES creates the backing directory), then replace that
  // directory with a plain FILE of the same name on the host via the bind mount.
  // ES expects a directory; finding a file causes verification to fail.
  const subdir = `broken-${name}`;
  const hostPath = path.join(__dirname, '..', '..', 'snapshot-repo', subdir);

  // Remove any leftover file/directory from a previous run so ES can register cleanly
  try { await es.delete(`/_snapshot/${name}`); } catch { /* not registered yet */ }
  fs.rmSync(hostPath, { recursive: true, force: true });

  await es.put(`/_snapshot/${name}`, {
    type: 'fs',
    settings: { location: `${SNAPSHOT_PATH}/${subdir}` },
  });

  // Replace the directory with a file — ES finds a file where it expects a directory
  fs.rmSync(hostPath, { recursive: true, force: true });
  fs.writeFileSync(hostPath, 'broken-marker');
}

export async function deleteRepository(name: string): Promise<void> {
  try { await es.delete(`/_snapshot/${name}`); } catch { /* ignore */ }
}

export async function installSampleData(): Promise<void> {
  // Skip if the index already exists (idempotent across test runs)
  if (await indexExists(TEST_INDEX)) return;
  await kibana.post('/api/sample_data/ecommerce');
}

export async function takeSnapshot(
  repo: string,
  snapshot: string,
  indices: string[],
): Promise<void> {
  await es.put(`/_snapshot/${repo}/${snapshot}?wait_for_completion=true`, {
    indices: indices.join(','),
    include_global_state: false,
  });
}

export async function snapshotExists(repo: string, snapshot: string): Promise<boolean> {
  try { await es.get(`/_snapshot/${repo}/${snapshot}`); return true; } catch { return false; }
}

export async function deleteSnapshot(repo: string, snapshot: string): Promise<void> {
  try { await es.delete(`/_snapshot/${repo}/${snapshot}`); } catch { /* ignore */ }
}

export async function indexExists(name: string): Promise<boolean> {
  try { await es.head(`/${name}`); return true; } catch { return false; }
}

export async function closeIndex(name: string): Promise<void> {
  await es.post(`/${name}/_close`);
}

export async function deleteIndex(name: string): Promise<void> {
  try { await es.delete(`/${name}`); } catch { /* ignore */ }
}

// ─── Kibana saved-object helpers ──────────────────────────────────────────────

export async function createTag(name: string, color = '#0077CC'): Promise<string> {
  const { data } = await kibana.post('/api/saved_objects/tag', {
    attributes: { name, description: 'Created by Playwright training test', color },
  });
  return data.id as string;
}

export async function createDataView(title: string, timeFieldName?: string): Promise<string> {
  const dv: Record<string, string> = { title, name: title };
  if (timeFieldName) dv.timeFieldName = timeFieldName;
  const { data } = await kibana.post('/api/data_views/data_view', { data_view: dv });
  return data.data_view.id as string;
}

export async function createDashboard(title: string): Promise<string> {
  const { data } = await kibana.post('/api/saved_objects/dashboard', {
    attributes: {
      title,
      panelsJSON: '[]',
      optionsJSON: '{"useMargins":true,"syncColors":false,"hidePanelTitles":false}',
      timeRestore: false,
      kibanaSavedObjectMeta: { searchSourceJSON: '{"query":{"query":"","language":"kuery"},"filter":[]}' },
    },
  });
  return data.id as string;
}

export async function deleteSavedObject(type: string, id: string): Promise<void> {
  try { await kibana.delete(`/api/saved_objects/${type}/${id}`); } catch { /* ignore */ }
}

/** Delete every saved object of `type` whose title attribute matches `title`. */
export async function deleteSavedObjectsByTitle(type: string, title: string): Promise<void> {
  const objects = await findSavedObjects(type);
  const matches = objects.filter((o: any) => o.attributes?.title === title || o.attributes?.name === title);
  for (const obj of matches) {
    await deleteSavedObject(type, obj.id);
  }
}

export async function deleteDataView(id: string): Promise<void> {
  try { await kibana.delete(`/api/data_views/data_view/${id}`); } catch { /* ignore */ }
}

export async function findSavedObjects(type: string): Promise<any[]> {
  const { data } = await kibana.get(`/api/saved_objects/_find?type=${encodeURIComponent(type)}&per_page=100`);
  return (data.saved_objects as any[]) ?? [];
}

// ─── Security helpers ──────────────────────────────────────────────────────────

export async function createRole(name: string): Promise<void> {
  await es.put(`/_security/role/${name}`, { cluster: ['monitor'], indices: [], applications: [] });
}

export async function deleteRole(name: string): Promise<void> {
  try { await es.delete(`/_security/role/${name}`); } catch { /* ignore */ }
}

// ─── Feature-state snapshot / restore ─────────────────────────────────────────

export async function takeKibanaFeatureSnapshot(repo: string, snapshotName: string): Promise<void> {
  // '-*' excludes all regular data indices; kibana feature state indices are added regardless
  await es.put(`/_snapshot/${repo}/${snapshotName}?wait_for_completion=true`, {
    indices: '-*',
    include_global_state: false,
    feature_states: ['kibana'],
  });
}

export async function takeSecurityFeatureSnapshot(repo: string, snapshotName: string): Promise<void> {
  await es.put(`/_snapshot/${repo}/${snapshotName}?wait_for_completion=true`, {
    indices: '-*',
    include_global_state: false,
    feature_states: ['security'],
  });
}

export async function restoreKibanaFeatureState(repo: string, snapshotName: string): Promise<void> {
  const { data: info } = await es.get(`/_snapshot/${repo}/${snapshotName}`);
  const snap = info.snapshots[0];
  // feature_states[].indices only lists core .kibana* indices; the snapshot also captures
  // .internal.alerts-*, .slo-*, .ml-*, .ds-* etc. Close every system index in the snapshot
  // so the restore doesn't trip over open indices with conflicting names.
  const systemIndices = (snap.indices as string[]).filter((i: string) => i.startsWith('.'));
  if (systemIndices.length > 0) {
    await es.post(`/${systemIndices.join(',')}/_close?ignore_unavailable=true&allow_no_indices=true`);
  }
  await es.post(`/_snapshot/${repo}/${snapshotName}/_restore?wait_for_completion=true`, {
    indices: '-*',
    include_global_state: false,
    feature_states: ['kibana'],
  });
}

export async function restoreSecurityFeatureState(repo: string, snapshotName: string): Promise<void> {
  const { data: info } = await es.get(`/_snapshot/${repo}/${snapshotName}`);
  const feature = info.snapshots[0].feature_states?.find((f: any) => f.feature_name === 'security');
  const indices: string[] = feature?.indices ?? [];
  if (indices.length > 0) {
    await es.post(`/${indices.join(',')}/_close?ignore_unavailable=true`);
  }
  await es.post(`/_snapshot/${repo}/${snapshotName}/_restore?wait_for_completion=true`, {
    indices: '-*',
    include_global_state: false,
    feature_states: ['security'],
  });
}

export async function waitForKibanaReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { data } = await kibana.get('/api/status');
      if ((data as any).status?.overall?.level === 'available') return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('Kibana did not become available within timeout');
}

// ─── Data stream helpers ───────────────────────────────────────────────────────

export const DS_NAME    = 'playwright-training-logs';
export const DS_ALIAS   = 'playwright-logs-current';
export const DS_SNAP    = 'playwright-ds-snap';
export const DS_RESTORED = 'playwright-training-logs-restored';

export async function createDataStreamTemplate(streamName: string): Promise<void> {
  await es.put(`/_index_template/${streamName}-template`, {
    index_patterns: [`${streamName}*`],
    data_stream: {},
    priority: 200,
    template: {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          '@timestamp': { type: 'date' },
          message: { type: 'text' },
          level: { type: 'keyword' },
        },
      },
    },
  });
}

export async function ingestDataStreamDocs(streamName: string, count = 10): Promise<void> {
  for (let i = 0; i < count; i++) {
    await es.post(`/${streamName}/_doc`, {
      '@timestamp': new Date(Date.now() - i * 60_000).toISOString(),
      message: `training log line ${i}`,
      level: i % 3 === 0 ? 'WARN' : 'INFO',
    });
  }
  await es.post(`/${streamName}/_refresh`);
}

export async function deleteDataStream(name: string): Promise<void> {
  try { await es.delete(`/_data_stream/${name}`); } catch { /* ignore */ }
}

export async function deleteDataStreamTemplate(name: string): Promise<void> {
  try { await es.delete(`/_index_template/${name}-template`); } catch { /* ignore */ }
}

export async function docCount(index: string): Promise<number> {
  const { data } = await es.get(`/${index}/_count`);
  return (data as any).count as number;
}

export async function addAlias(index: string, alias: string): Promise<void> {
  await es.post('/_aliases', { actions: [{ add: { index, alias } }] });
}

export async function switchAlias(oldIndex: string, newIndex: string, alias: string): Promise<void> {
  await es.post('/_aliases', {
    actions: [
      { remove: { index: oldIndex, alias } },
      { add:    { index: newIndex, alias } },
    ],
  });
}

/** Returns the index names the alias currently resolves to. */
export async function aliasTargets(alias: string): Promise<string[]> {
  try {
    const { data } = await es.get(`/_alias/${alias}`);
    return Object.keys(data as object);
  } catch { return []; }
}

export async function takeDataStreamSnapshot(repo: string, snapName: string, streamName: string): Promise<void> {
  await es.put(`/_snapshot/${repo}/${snapName}?wait_for_completion=true`, {
    indices: [streamName],
    include_global_state: true,
  });
}

/**
 * Attempt a naive restore (will fail when the data stream already exists).
 * Returns the ES error message rather than throwing so tests can display it.
 */
export async function restoreDataStreamDirect(
  repo: string,
  snapName: string,
  streamName: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await es.post(`/_snapshot/${repo}/${snapName}/_restore?wait_for_completion=true`, {
      indices: [streamName],
      include_global_state: false,
    });
    return { success: true };
  } catch (e: any) {
    const reason: string =
      e.response?.data?.error?.root_cause?.[0]?.reason ?? e.message ?? 'unknown error';
    return { success: false, error: reason };
  }
}

/** Restore a data stream under a new name using rename_pattern / rename_replacement. */
export async function restoreDataStreamRenamed(
  repo: string,
  snapName: string,
  originalName: string,
  newName: string,
): Promise<void> {
  await es.post(`/_snapshot/${repo}/${snapName}/_restore?wait_for_completion=true`, {
    indices: [originalName],
    include_global_state: false,
    rename_pattern: originalName,
    rename_replacement: newName,
  });
}

export async function setRecoveryThrottle(bytesPerSec: string): Promise<void> {
  await es.put('/_cluster/settings', {
    transient: { 'indices.recovery.max_bytes_per_sec': bytesPerSec },
  });
}

export async function clearRecoveryThrottle(): Promise<void> {
  await es.put('/_cluster/settings', {
    transient: { 'indices.recovery.max_bytes_per_sec': null },
  });
}

export async function waitForRestore(index: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await es.get(`/${index}/_recovery`);
    const shards: any[] = Object.values(data).flatMap((idx: any) => idx.shards ?? []);
    const done = shards.every((s: any) => s.stage === 'DONE');
    if (done && shards.length > 0) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Restore of ${index} did not complete within ${timeoutMs}ms`);
}
