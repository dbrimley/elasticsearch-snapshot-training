# Elasticsearch Snapshot Training — Implementation Plan

## Overview

A self-contained, hands-on Jupyter notebook training environment for learning Elasticsearch
snapshot-and-restore in depth. The environment runs locally via Docker Compose and walks through
every snapshot concept from first principles, with particular emphasis on **what data is actually
saved** (especially Kibana saved objects).

---

## 1. Infrastructure Scaffolding

### Files to Create

```
snapshot-training/
├── docker-compose.yml          # ES + Kibana + Jupyter
├── .env                        # Version pins & ports
├── es-config/
│   └── elasticsearch.yml       # path.repo, security, cluster settings
├── kibana-config/
│   └── kibana.yml              # ES host, xpack settings
├── snapshot-repo/              # Bind-mount for fs repository
├── notebooks/
│   ├── 00_setup.ipynb
│   ├── 01_repository_types.ipynb
│   ├── 02_what_is_in_a_snapshot.ipynb
│   ├── 03_creating_snapshots.ipynb
│   ├── 04_saved_objects_deep_dive.ipynb
│   ├── 05_restoring_snapshots.ipynb
│   ├── 06_slm_policies.ipynb
│   ├── 07_advanced_topics.ipynb
│   └── helpers.py              # Shared ES client + pretty-print utils
└── PLAN.md                     # This file
```

### Docker Compose Services

| Service | Image | Port |
|---------|-------|------|
| `elasticsearch` | `docker.elastic.co/elasticsearch/elasticsearch:9.3.0` | 9200 |
| `kibana` | `docker.elastic.co/kibana/kibana:9.3.0` | 5601 |
| `jupyter` | `jupyter/scipy-notebook` | 8888 |

**Key configuration decisions:**
- Single-node cluster (`discovery.type=single-node`) — simplicity over realism
- Security enabled with a fixed `elastic` password set via env var (no enrollment tokens)
- `path.repo` set to `/usr/share/elasticsearch/snapshots` — bind-mounted to `./snapshot-repo/`
  on the host so snapshot files are inspectable between exercises
- Jupyter mounts `./notebooks/` and has `elasticsearch-py` pre-installed via `requirements.txt`
- All services on a shared Docker network `esnet`

---

## 2. Notebook Modules

### Module 00 — Setup & Verification (`00_setup.ipynb`)

**Goal:** Confirm the environment is healthy and introduce the ES Python client.

- Health check: `GET /_cluster/health`
- Version info: `GET /`
- Kibana reachability check
- Create sample data: load the Kibana sample datasets (eCommerce, Flights, Logs) via
  the Kibana REST API — these will be the data we snapshot/restore throughout the course
- Register the filesystem snapshot repository (`./snapshot-repo/`) — used in all later modules

---

### Module 01 — Repository Types (`01_repository_types.ipynb`)

**Goal:** Understand every repository type, its configuration surface, and when to use each.

Sections:
1. **Filesystem (`fs`)** — configure, verify, analyse; inspect the raw directory structure
   on disk after creating a snapshot
2. **Read-Only URL (`url`)** — serve the `fs` repo via Python's built-in HTTP server;
   register as a URL repo; show it is read-only
3. **Source-Only (`source`)** — wrap the `fs` repo; show the storage savings;
   demonstrate the read-only / match_all restoration limitation
4. **S3-compatible (`s3`)** — spin up a MinIO container alongside ES; configure the
   S3 repository plugin against MinIO; take and restore a snapshot
5. **Cloud types overview** — GCS, Azure (conceptual walkthrough of settings with no
   live cloud account required; show the config API shapes)
6. **Repository verification & analysis** — `POST /_snapshot/{repo}/_verify`,
   `POST /_snapshot/{repo}/_analyze`, `POST /_snapshot/{repo}/_cleanup`

---

### Module 02 — What Is Actually in a Snapshot? (`02_what_is_in_a_snapshot.ipynb`)

**Goal:** Demystify the snapshot payload — indices, cluster state, feature states — before
teaching how to create one.

Sections:
1. **Shard-level data** — documents, segment files; show file list inside `snapshot-repo/`
2. **Index metadata** — mappings, settings, aliases saved per-index
3. **Cluster state components** — what `include_global_state: true` saves:
   - Persistent cluster settings
   - Index templates (legacy & composable)
   - Ingest pipelines
   - ILM policies
   - Stored scripts
4. **Feature states** — `GET /_features` to list all; explain each Elastic feature that
   participates:
   - `kibana` — all Kibana saved objects (the focus of Module 04)
   - `security` — roles, users, role mappings, API keys, service tokens
   - `watcher` — watches, watch history
   - `machine_learning` — jobs, trained models
   - `fleet` — agent policies, package configs
   - `transforms` — transform configs
   - `tasks` — async task results
5. **What is NOT saved** — registered repositories, transient settings, node config,
   SSL certificates, installation files
6. **Inspecting snapshot metadata** — `GET /_snapshot/{repo}/{snap}` in detail; walk
   through each field (`indices`, `metadata`, `shards`, `feature_states`, `include_global_state`)

---

### Module 03 — Creating Snapshots (`03_creating_snapshots.ipynb`)

**Goal:** Master the `PUT /_snapshot` API and all its options.

Sections:
1. **Minimal snapshot** — all indices, no global state
2. **Selective index snapshots** — patterns, wildcards, exclusions (`-index`)
3. **Data streams** — how backing indices are handled
4. **`include_global_state`** — on vs off; diff the repo on disk before/after
5. **`feature_states`** — snapshot only specific features (e.g. just `kibana`)
6. **`partial`** — allow a snapshot when some shards are unavailable
7. **`ignore_unavailable`** — skip missing indices vs. fail
8. **`metadata`** — attach arbitrary JSON metadata to a snapshot
9. **Async vs wait\_for\_completion** — monitor with `GET /_snapshot/{repo}/{snap}/_status`
10. **Snapshot naming** — date-math patterns (`<snap-{now/d}>`)
11. **Cloning** — `PUT /_snapshot/{repo}/{snap}/_clone/{target}`; use cases

---

### Module 04 — Saved Objects Deep Dive (`04_saved_objects_deep_dive.ipynb`)

**Goal:** Walk through every major Kibana saved object type. For each type:
1. Create it in Kibana (Kibana UI steps described with screenshots/links, then confirmed
   via `GET /api/kibana/saved_objects/_find`)
2. Take a `kibana`-feature-state snapshot
3. Delete the object
4. Restore the snapshot (feature state only)
5. Confirm the object is back

#### 4.1 Data Views (`index-pattern`)
- Create a Data View for the sample eCommerce data
- Show the saved object schema: `title`, `fields`, `fieldFormatMap`, `runtimeFieldMap`

#### 4.2 Saved Searches (`search`)
- Create a Discover search with filters & columns
- Show the saved object: references to data view, `kibanaSavedObjectMeta`

#### 4.3 Visualizations — legacy (`visualization`)
- Create a TSVB or Aggregation-based chart
- Show type-specific `visState` JSON blob

#### 4.4 Lens Visualizations (`lens`)
- Create a Lens bar chart and datatable
- Show the `state` / `references` graph

#### 4.5 Maps (`map`)
- Create a simple choropleth or point map
- Show layer descriptors in the saved object

#### 4.6 Dashboards (`dashboard`)
- Assemble a dashboard from the above visualizations
- Show the `panelsJSON` reference graph linking to child saved objects
- Demonstrate that restoring the dashboard also restores its panel dependencies

#### 4.7 Canvas Workpads (`canvas-workpad`)
- Create a simple Canvas workpad
- Show the self-contained JSON (no external references)

#### 4.8 Tags (`tag`)
- Create tags and apply them to several objects
- Show `references` arrays in tagged objects pointing back to the tag

#### 4.9 Saved Queries (`query`)
- Save a KQL query from Discover
- Show the minimal saved object shape

#### 4.10 Spaces (`space`)
- Create a second Kibana Space
- Show that saved objects are namespace-scoped
- Snapshot and restore across spaces (rename / copy-to-space)

#### 4.11 Alerting Rules (`alert`)
- Create a simple threshold alert using the Kibana Alerting UI
- Show the `alert` saved object: `schedule`, `params`, `actions` references
- Note: `action` (connector) objects are a separate type and are restored together

#### 4.12 Connectors (`action`)
- Create a server log connector
- Show the relationship between `alert` → `action` references

#### 4.13 Cases (`cases`, `cases-comments`, `cases-user-actions`)
- Open a case, add comments and user actions
- Show the three linked saved object types

#### 4.14 Configuration (`config`)
- Show what Kibana persists in `config` (default index, theme, tour state, etc.)
- Explain single-namespace / cluster-wide scope

#### 4.15 Short URLs (`short-url`)
- Generate a short URL for a dashboard
- Show the saved object and its redirect target

#### 4.16 Event Annotations (`event-annotation-group`)
- Create an annotation group in Lens
- Show the saved object and its data view reference

#### 4.17 Object graph: cross-type restore ordering
- Explain and demonstrate the dependency resolution order Kibana uses during restore
  (tags → data views → saved searches / visualizations → dashboards)

---

### Module 05 — Restoring Snapshots (`05_restoring_snapshots.ipynb`)

**Goal:** Master the `POST /_snapshot/{repo}/{snap}/_restore` API.

Sections:
1. **Full restore** — all indices + global state to a clean cluster
2. **Selective index restore** — pattern matching, `ignore_unavailable`
3. **Rename on restore** — `rename_pattern` + `rename_replacement` (regex)
4. **Override settings on restore** — `index_settings` (e.g. set replicas to 0)
5. **`ignore_index_settings`** — strip settings that conflict with the target cluster
6. **Restoring aliases** — `include_aliases: true/false`
7. **Restoring feature states selectively** — `feature_states: ["kibana"]` only
8. **Partial restore** — `partial: true` for snapshots with missing shards
9. **Monitoring restore progress** — `GET /_cat/recovery`, `GET /_recovery`
10. **Restore to a different cluster** — read-only URL repo pattern

---

### Module 06 — Snapshot Lifecycle Management (`06_slm_policies.ipynb`)

**Goal:** Automate snapshots with SLM.

Sections:
1. Create an SLM policy with retention (`expire_after`, `min_count`, `max_count`)
2. `PUT /_slm/policy/{id}/_execute` — trigger manually
3. `GET /_slm/policy/{id}` — inspect `last_success`, `last_failure`
4. `GET /_slm/stats` — cluster-wide stats
5. Start / stop SLM: `POST /_slm/start|stop`
6. `POST /_slm/_execute_retention` — trigger retention manually
7. Cron expression design for snapshot schedules

---

### Module 07 — Advanced Topics (`07_advanced_topics.ipynb`)

**Goal:** Cover edge cases and production patterns.

Sections:
1. **Searchable snapshots** — mount a snapshot index as `full_copy` or `shared_cache`
2. **Snapshot cloning** — efficient copy within a repository
3. **Cross-cluster restore** — restore from a read-only URL repo on a second container
4. **Repository analysis** — `_analyze` API; interpret results
5. **Concurrent snapshot limits** — `max_number_of_snapshots`
6. **Rate limiting** — `max_snapshot_bytes_per_sec` / `max_restore_bytes_per_sec`
7. **Handling failures** — partial snapshots, shard failures, `_status` interpretation
8. **Security snapshots** — backing up and restoring the `security` feature state
   (users, roles, role mappings, API keys)

---

## 3. Technical Decisions & Constraints

| Decision | Rationale |
|----------|-----------|
| Elasticsearch 9.3.x | Latest major; security on by default |
| Single-node cluster | Removes replica complexity; focus on snapshots not cluster ops |
| MinIO for S3 exercises | No AWS account required; identical S3 API |
| Filesystem repo bind-mounted to host | Learner can `ls`/`cat` snapshot files to understand storage layout |
| Python `elasticsearch` client in notebooks | Real-world tooling; avoids curl verbosity |
| Kibana sample datasets | Ready-made, realistic data with no custom ingestion needed |
| All modules independent (after 00) | Learner can jump to any module; each resets state at start |

---

## 4. Execution Order

When approved, implementation will proceed in this order:

1. `docker-compose.yml` + config files + `.env`
2. `notebooks/helpers.py` — shared client, pretty-print, wait-for-green utility
3. `notebooks/00_setup.ipynb` — verified to work end-to-end
4. Modules 01–07 in order, each verified before moving on

---

## 5. Out of Scope (for now)

- HDFS repository (requires a Hadoop cluster)
- Azure / GCS live exercises (require cloud accounts)
- Kibana Reporting saved objects (`report`) — requires a Platinum license feature
- ML trained model snapshots (covered conceptually in Module 02, not exercised)
- Cross-cluster replication (CCR) interaction with snapshots

---

*Awaiting approval before implementation begins.*
