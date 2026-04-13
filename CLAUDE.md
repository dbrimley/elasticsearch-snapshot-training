# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a hands-on Elasticsearch snapshot-and-restore training environment. It consists of Docker-based services (Elasticsearch, Kibana, MinIO) and a series of Jupyter notebooks that teach snapshot concepts progressively, from setup through advanced topics.

## Environment Setup

### Starting the stack

```bash
docker compose up -d
```

Default credentials (from `.env`):
- Elasticsearch: `elastic` / `training123` at `http://localhost:9200`
- Kibana: `elastic` / `training123` at `http://localhost:5601`
- MinIO console: `minioadmin` / `minioadmin` at `http://localhost:9015`

### Python environment (for running notebooks locally)

```bash
cd notebooks
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
jupyter notebook
```

### Stopping and cleaning up

```bash
docker compose down -v   # removes volumes (full reset)
docker compose down      # keeps volumes
```

## Architecture

### Service topology

- **elasticsearch** — Single-node cluster, security enabled (no TLS for training simplicity), trial license, snapshot repo bind-mounted at `./snapshot-repo`
- **kibana-setup** — One-shot init container that sets the `kibana_system` user password before Kibana starts
- **kibana** — Connects to Elasticsearch with `kibana_system` user; static encryption keys set for reproducibility
- **minio** — S3-compatible object store for S3 repository exercises; eliminates need for AWS account

All services share the `esnet` bridge network. Configuration files live in `es-config/` and `kibana-config/`.

### Notebook structure

Notebooks live in `notebooks/` and follow a numbered module sequence:

| Module | File | Topic |
|--------|------|-------|
| 00 | `00_setup.ipynb` | Cluster verification, sample data, filesystem repo registration |
| 01 | `01_repository_types.ipynb` | fs, url, source-only, S3/MinIO repositories |
| 02 | `02_what_is_in_a_snapshot.ipynb` | Shards, index metadata, cluster state, feature states |
| 03 | `03_creating_snapshots.ipynb` | Snapshot API, partial, cloning, async operations |
| 04 | `04_saved_objects_deep_dive.ipynb` | Entry point for Kibana saved objects coverage |
| 05 | `05_restoring_snapshots.ipynb` | Restore API, rename on restore, settings override |
| 06 | `06_slm_policies.ipynb` | SLM policy creation, scheduling, retention |
| 07 | `07_advanced_topics.ipynb` | Searchable snapshots, cross-cluster restore, security |
| 08 | `08_data_streams.ipynb` | Data stream backup/restore, gotchas, ILM state, Fleet streams |

Module 04 has 17 sub-notebooks in `notebooks/saved_objects/` (04_01 through 04_17), each covering a specific Kibana saved object type (data views, dashboards, alerting rules, etc.).

**Module independence:** Each notebook begins with cleanup/reset steps so learners can run any module independently after completing Module 00.

### Shared helpers

`notebooks/helpers.py` provides all reusable utilities:
- Elasticsearch client initialization (reads from `.env`)
- Kibana REST API wrappers
- Wait/polling utilities for async operations
- Repository and snapshot lifecycle helpers
- Rich-formatted output helpers

All notebooks import from `helpers.py` at the top. When adding new shared functionality, add it to `helpers.py` rather than duplicating across notebooks.

## Key Design Decisions

- **No TLS between services** — Intentional for training; simplifies connection setup in notebooks
- **Bind-mounted snapshot repo** (`./snapshot-repo/`) — Allows learners to inspect raw snapshot files on disk
- **MinIO instead of AWS** — Provides identical S3 API without requiring cloud credentials
- **Kibana sample datasets** (eCommerce, Flights, Logs) — Used throughout for realistic data without custom ingestion
- **Elasticsearch 9.x** — Security is enabled by default; trial license is self-generated

## Elasticsearch and Kibana versions

Controlled via `.env`:
```
ES_VERSION=9.3.0
KIBANA_VERSION=9.3.0
```

To update versions, change these values and run `docker compose pull && docker compose up -d`.
