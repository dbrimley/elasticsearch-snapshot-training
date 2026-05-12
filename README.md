# Elasticsearch Snapshot Training

A hands-on Jupyter notebook training environment for learning Elasticsearch snapshot-and-restore in depth. The environment runs locally via Docker Compose and walks through every snapshot concept from first principles, with particular emphasis on what data is actually saved — especially Kibana saved objects.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Python 3.9+

---

## Setup

### 1. Clone and configure environment variables

```bash
cp .env.example .env
```

The defaults in `.env` work out of the box. Adjust ports or passwords if needed:

| Variable | Default | Description |
|---|---|---|
| `ES_VERSION` | `9.3.0` | Elasticsearch version |
| `KIBANA_VERSION` | `9.3.0` | Kibana version |
| `ELASTIC_PASSWORD` | `training123` | `elastic` superuser password |
| `KIBANA_PASSWORD` | `training123` | `kibana_system` internal password |
| `ES_PORT` | `9200` | Elasticsearch port |
| `KIBANA_PORT` | `5601` | Kibana port |
| `MINIO_PORT` | `9014` | MinIO S3 API port |
| `MINIO_CONSOLE_PORT` | `9015` | MinIO web console port |

### 2. Start the Docker stack

```bash
docker compose up -d
```

This starts four services:

| Service | URL | Description |
|---|---|---|
| Elasticsearch | http://localhost:9200 | Single-node cluster with security enabled |
| Kibana | http://localhost:5601 | Kibana connected to Elasticsearch |
| MinIO | http://localhost:9014 | S3-compatible object store (for Module 01) |
| MinIO console | http://localhost:9015 | MinIO web UI |

Kibana takes a minute or two to fully start. You can check readiness with:

```bash
docker compose ps
```

Wait until all services show as healthy.

### 3. Set up the Python environment

```bash
cd notebooks
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Start Jupyter

```bash
jupyter notebook
```

Open the browser URL that Jupyter prints, then start with `00_setup.ipynb`.

---

## Running the Notebooks

Work through the notebooks in order, starting with `00_setup.ipynb`. Each module after 00 is independent and resets its own state at the start, so you can jump to any module once the setup notebook has been run.

---

## Notebook Modules

### 00 — Setup & Verification
Verifies the environment is healthy and prepares it for all subsequent modules. Checks Elasticsearch cluster health and version, verifies Kibana is reachable, loads the three Kibana sample datasets (eCommerce, Flights, Logs), registers the shared filesystem snapshot repository, and takes a full baseline snapshot used as a known-good restore point throughout the course.

### 01 — Repository Types
Covers every snapshot repository type available in Elasticsearch 9.x and when to use each:
- **Filesystem (`fs`)** — registers a repo, takes a snapshot, and inspects the raw files written to disk
- **Read-Only URL (`url`)** — serves the `fs` repo via a `file://` URL and demonstrates write enforcement
- **Source-Only (`source`)** — wraps the `fs` repo, shows storage savings, and demonstrates the `match_all`-only query limitation on restored indices
- **S3-compatible (`s3`)** — creates a MinIO bucket, registers an S3 repo, and round-trips a snapshot
- **GCS & Azure** — conceptual walkthrough of configuration shapes (no cloud account required)
- **Repository management** — `_verify`, `_analyze`, and `_cleanup` APIs

### 02 — What Is Actually in a Snapshot?
Demystifies the snapshot payload before teaching how to create one:
- **Shard-level data** — Lucene segment files and incremental deduplication
- **Index metadata** — mappings, settings, and aliases stored per index
- **Cluster state** — what `include_global_state: true` captures: persistent cluster settings, index templates, ingest pipelines, ILM policies, and stored scripts
- **Feature states** — lists all Elastic Stack features that participate (`kibana`, `security`, `watcher`, `machine_learning`, `fleet`, `transforms`, `tasks`) and what each saves
- **What is NOT saved** — registered repositories, transient settings, node config, SSL certificates
- **Snapshot metadata inspection** — walks through every field in `GET /_snapshot/{repo}/{snap}`

### 03 — Creating Snapshots
Covers the full `PUT /_snapshot` API surface:
- Minimal snapshot, selective index patterns and wildcards, data streams
- `include_global_state`, `feature_states`, `partial`, `ignore_unavailable`
- Attaching arbitrary metadata to a snapshot
- Async snapshots and monitoring with `_status`
- Date-math snapshot naming (`<snap-{now/d}>`)
- Cloning snapshots within a repository

### 04 — Saved Objects Deep Dive
Walks through every major Kibana saved object type. For each type the notebook creates the object, takes a Kibana-feature-state snapshot, deletes the object, restores from the snapshot, and confirms recovery. Types covered:
- Data Views, Saved Searches, Legacy Visualizations, Lens Visualizations, Maps
- Dashboards (including cross-object reference graphs and panel dependency restoration)
- Canvas Workpads, Tags, Saved Queries
- Spaces (namespace scoping and cross-space restore)
- Alerting Rules and Connectors, Cases, Configuration, Short URLs, Event Annotations
- Cross-type restore ordering (dependency resolution: tags → data views → visualizations → dashboards)

Sub-notebooks in [notebooks/saved_objects/](notebooks/saved_objects/) cover each type in detail.

### 05 — Restoring Snapshots
Masters the `POST /_snapshot/{repo}/{snap}/_restore` API:
- Full restore and selective index restore with patterns
- Rename on restore (`rename_pattern` + `rename_replacement`)
- Overriding index settings and stripping conflicting settings during restore
- Controlling alias restoration
- Restoring specific feature states (e.g. Kibana only)
- Restoring global cluster state
- Monitoring restore progress with `_cat/recovery` and `_recovery`
- Restoring to a different cluster via a read-only URL repository

### 06 — Snapshot Lifecycle Management (SLM)
Automates snapshots with SLM policies:
- Creating a policy with retention rules (`expire_after`, `min_count`, `max_count`)
- Manual policy execution and inspecting `last_success` / `last_failure`
- Cluster-wide SLM statistics
- Starting and stopping SLM
- Triggering retention manually
- Designing multi-policy strategies (hourly, daily, weekly)
- Quartz cron expression reference for scheduling

### 07 — Advanced Topics
Production patterns and edge cases:
- **Searchable snapshots** — mounting snapshot indices as `full_copy` or `shared_cache` without a full restore
- **Snapshot cloning** — efficient in-repository copy without network transfer
- **Cross-cluster restore** — the read-only URL repository pattern for multi-cluster setups
- **Repository analysis** — interpreting `_analyze` results for consistency and throughput
- **Concurrent snapshot limits** and rate limiting (`max_snapshot_bytes_per_sec`)
- **Failure handling** — partial snapshots, shard failures, and `_status` interpretation
- **Security feature state** — backing up and restoring users, roles, role mappings, and API keys

### 10 — Snapshot Storage Growth: Why Repo Size Can Exceed Ingested Data
Proves with measurable before/after numbers why a snapshot repository on disk can grow larger than the data ingested — beyond what compression and dedup explain. Runs seven scenarios against a dedicated `growth_demo` repo, each followed by a snapshot, disk-walk, and segment-level measurement:
- **A. Updates** — Lucene's delete-and-reinsert semantics; old segments stay pinned by earlier snapshots
- **B. Deletes** — tombstones, not space reclamation, until merge
- **C. Background segment merge** — merged segments are new files; pre-merge segments still pinned
- **D. Force-merge to 1 segment** — the operational footgun where the repo roughly doubles
- **E. High refresh rate** — many small segments amplify snapshot file counts (side-by-side comparison)
- **F. Reindex** — entirely new segment files; old index still pinned by old snapshots
- **G. Retention is the multiplier** — proof by deletion: pruning older snapshots actually shrinks the repo

Ends with a rich summary table, matplotlib charts of repo-disk-over-time, and a mitigation cheat sheet (snapshot-before-merge ordering, retention tuning, source-only repos, searchable snapshots, data streams + ILM).

---

## Playwright UI Tests (Kibana Snapshot/Restore)

The `playwright-tests/` directory contains a Playwright test suite that drives the Kibana Snapshot and Restore UI through the same scenarios covered in Module 05. Every test records a video, making it easy to share how the UI behaves — especially under failure conditions — without needing a live demo.

### Prerequisites

- Node.js 18+
- The Docker stack must be running and healthy (`docker compose ps`)

### Install

```bash
cd playwright-tests
npm install
npx playwright install chromium
```

### Run

The recommended way is the **Playwright Test for VSCode** extension (`ms-playwright.playwright`). Install it from the Extensions panel, then open any file under `playwright-tests/` — a Testing icon appears in the Activity Bar with per-test run buttons, inline pass/fail status, a live browser view, and a built-in Trace Viewer that replays recordings step by step. The "Pick locator" tool is also useful for updating selectors against the live Kibana UI.

To run from the terminal instead:

```bash
npx playwright test
```

Videos, screenshots, and traces are written to `playwright-tests/test-results/`. Open the HTML report with:

```bash
npx playwright show-report
```

### Test scenarios

| File | What it demonstrates |
|---|---|
| `00-setup` | Registers the filesystem repository and takes the baseline snapshot used by all other tests |
| `01-restore-index-exists` | **Failure:** restore rejected because the target index is already open |
| `02-restore-with-rename` | **Success path:** rename on restore avoids the index-conflict error |
| `03-restore-settings-override` | **Failure:** restore rejected when attempting to change `number_of_shards` (immutable) |
| `04-restore-failure-states` | **Failure:** broken repository — Kibana surfaces the verification error |
| `05-restore-progress` | **In-progress state:** Restore Activity tab showing active shard recovery |

> **Note:** The tests use a mix of `data-test-subj` attributes and role/text selectors. If Kibana's wizard button labels differ in your version, the selectors in [`fixtures/kibana-page.ts`](playwright-tests/fixtures/kibana-page.ts) are the single place to update them.

---

## Stopping the Environment

```bash
docker compose down
```

To also remove all stored data (Elasticsearch indices, snapshot files, MinIO data):

```bash
docker compose down -v
rm -rf snapshot-repo minio-data
```
