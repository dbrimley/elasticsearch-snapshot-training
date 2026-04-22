"""
Shared helpers for all snapshot-training notebooks.
Provides an ES client, pretty-printing, and common wait/poll utilities.
"""
# ---------------------------------------------------------------------------
# IPython display helper (gracefully skipped outside notebook)
# ---------------------------------------------------------------------------
try:
    from IPython.display import display as _ipy_display, HTML as _ipy_HTML
    _HAS_IPY = True
except ImportError:
    _HAS_IPY = False

import json
import os
import time
from pathlib import Path

# Load .env from the project root (one level up from this file) so that
# ES_PORT and other docker-compose settings are picked up automatically.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

import requests
from elasticsearch import Elasticsearch
from rich import print as rprint
from rich.console import Console
from rich.markup import escape
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

console = Console()

# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

_es_port = os.environ.get("ES_PORT", "9200")
ES_HOST = os.environ.get("ES_HOST", f"http://localhost:{_es_port}")
KIBANA_HOST = os.environ.get("KIBANA_HOST", "http://localhost:5601")
ELASTIC_PASSWORD = os.environ.get("ELASTIC_PASSWORD", "training123")
KIBANA_PASSWORD = os.environ.get("KIBANA_PASSWORD", "training123")

# Browser-facing Kibana URL for generating clickable deep links in the notebook.
# API calls go to KIBANA_HOST (may be an internal Docker hostname);
# links shown to the user must resolve in their browser.
KIBANA_BROWSER_HOST = os.environ.get("KIBANA_BROWSER_HOST", "http://localhost:5601")

MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "localhost:9014")
MINIO_INTERNAL_ENDPOINT = os.environ.get("MINIO_INTERNAL_ENDPOINT", "minio:9000")
MINIO_ROOT_USER = os.environ.get("MINIO_ROOT_USER", "minioadmin")
MINIO_ROOT_PASSWORD = os.environ.get("MINIO_ROOT_PASSWORD", "minioadmin")


def get_client() -> Elasticsearch:
    """Return an authenticated Elasticsearch client."""
    return Elasticsearch(
        ES_HOST,
        basic_auth=("elastic", ELASTIC_PASSWORD),
        verify_certs=False,
        ssl_show_warn=False,
        request_timeout=300,
    )


def kibana_get(path: str) -> dict:
    """GET from Kibana REST API."""
    resp = requests.get(
        f"{KIBANA_HOST}{path}",
        auth=("elastic", ELASTIC_PASSWORD),
        headers={"kbn-xsrf": "true"},
    )
    resp.raise_for_status()
    return resp.json()


def kibana_post(path: str, body: dict) -> dict:
    """POST to Kibana REST API."""
    resp = requests.post(
        f"{KIBANA_HOST}{path}",
        auth=("elastic", ELASTIC_PASSWORD),
        headers={"kbn-xsrf": "true", "Content-Type": "application/json"},
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


def kibana_delete(path: str) -> None:
    """DELETE via Kibana REST API."""
    resp = requests.delete(
        f"{KIBANA_HOST}{path}",
        auth=("elastic", ELASTIC_PASSWORD),
        headers={"kbn-xsrf": "true"},
    )
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Pretty printing
# ---------------------------------------------------------------------------


def pp(obj, title: str = "") -> None:
    """Pretty-print a dict / list as JSON with syntax highlighting."""
    text = json.dumps(obj, indent=2, default=str)
    syntax = Syntax(text, "json", theme="monokai", line_numbers=False)
    if title:
        console.print(Panel(syntax, title=f"[bold cyan]{title}[/bold cyan]", expand=False))
    else:
        console.print(syntax)


def heading(text: str) -> None:
    """Print a section heading."""
    console.rule(f"[bold yellow]{text}[/bold yellow]")


def success(text: str) -> None:
    console.print(f"[bold green]✓[/bold green] {text}")


def info(text: str) -> None:
    console.print(f"[bold blue]ℹ[/bold blue] {escape(text)}", highlight=False)


def warn(text: str) -> None:
    console.print(f"[bold yellow]⚠[/bold yellow] {text}")


# ---------------------------------------------------------------------------
# Wait / poll helpers
# ---------------------------------------------------------------------------


def wait_for_green(client: Elasticsearch = None, timeout: int = 60) -> None:
    """Block until cluster health is green or yellow."""
    client = client or get_client()
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            health = client.cluster.health(wait_for_status="yellow", timeout="5s")
            status = health["status"]
            if status in ("green", "yellow"):
                success(f"Cluster health: {status}")
                return
        except Exception:
            pass
        time.sleep(2)
    raise TimeoutError(f"Cluster did not reach green/yellow within {timeout}s")


def wait_for_snapshot(
    client: Elasticsearch,
    repository: str,
    snapshot: str,
    timeout: int = 120,
) -> dict:
    """Poll until a snapshot is SUCCESS or FAILED, then return the snapshot info."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.snapshot.get(repository=repository, snapshot=snapshot)
        snap = resp["snapshots"][0]
        state = snap["state"]
        if state in ("SUCCESS", "FAILED", "PARTIAL"):
            return snap
        info(f"Snapshot state: {state} — waiting...")
        time.sleep(3)
    raise TimeoutError(f"Snapshot {snapshot} did not finish within {timeout}s")


def wait_for_restore(client: Elasticsearch, index: str, timeout: int = 120) -> None:
    """Block until all shards of an index have finished recovering."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            recovery = client.indices.recovery(index=index)
            shards = recovery.get(index, {}).get("shards", [])
            if shards and all(s["stage"] == "DONE" for s in shards):
                success(f"Restore of '{index}' complete.")
                return
        except Exception:
            pass
        time.sleep(3)
    raise TimeoutError(f"Restore of '{index}' did not complete within {timeout}s")


# ---------------------------------------------------------------------------
# Repository helpers
# ---------------------------------------------------------------------------

FS_REPO_NAME = "training-fs-repo"
FS_REPO_PATH = "/usr/share/elasticsearch/snapshots"


def register_fs_repo(client: Elasticsearch = None, name: str = FS_REPO_NAME) -> None:
    """Register (or re-register) the shared filesystem snapshot repository."""
    client = client or get_client()
    client.snapshot.create_repository(
        name=name,
        body={
            "type": "fs",
            "settings": {
                "location": FS_REPO_PATH,
                "compress": True,
            },
        },
    )
    success(f"Repository '{name}' registered at {FS_REPO_PATH}")


def delete_snapshot_if_exists(
    client: Elasticsearch, repository: str, snapshot: str
) -> None:
    """Delete a snapshot without raising if it doesn't exist."""
    try:
        client.snapshot.delete(repository=repository, snapshot=snapshot)
        info(f"Deleted existing snapshot '{snapshot}'")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Kibana saved-objects helpers
# ---------------------------------------------------------------------------


def find_saved_objects(type_: str, space: str = "default") -> list:
    """Return all saved objects of a given type in a Kibana space."""
    path = f"/s/{space}/api/saved_objects/_find?type={type_}&per_page=100"
    return kibana_get(path).get("saved_objects", [])


def delete_saved_object(type_: str, id_: str, space: str = "default") -> None:
    kibana_delete(f"/s/{space}/api/saved_objects/{type_}/{id_}")


def load_sample_data(dataset: str = "ecommerce") -> None:
    """
    Load one of Kibana's built-in sample datasets.
    dataset: 'ecommerce' | 'flights' | 'logs'
    """
    resp = requests.post(
        f"{KIBANA_HOST}/api/sample_data/{dataset}",
        auth=("elastic", ELASTIC_PASSWORD),
        headers={"kbn-xsrf": "true", "x-elastic-internal-origin": "Kibana"},
    )
    resp.raise_for_status()
    success(f"Sample dataset '{dataset}' loaded.")


def remove_sample_data(dataset: str = "ecommerce") -> None:
    resp = requests.delete(
        f"{KIBANA_HOST}/api/sample_data/{dataset}",
        auth=("elastic", ELASTIC_PASSWORD),
        headers={"kbn-xsrf": "true", "x-elastic-internal-origin": "Kibana"},
    )
    resp.raise_for_status()
    info(f"Sample dataset '{dataset}' removed.")


# ---------------------------------------------------------------------------
# Snapshot feature-state helpers
# ---------------------------------------------------------------------------


def snapshot_kibana_state(
    client: Elasticsearch,
    repository: str,
    snapshot_name: str,
) -> dict:
    """Take a snapshot that captures only the Kibana feature state."""
    delete_snapshot_if_exists(client, repository, snapshot_name)
    client.snapshot.create(
        repository=repository,
        snapshot=snapshot_name,
        body={
            "indices": [],
            "include_global_state": False,
            "feature_states": ["kibana"],
        },
        wait_for_completion=False,
    )
    return wait_for_snapshot(client, repository, snapshot_name)


def restore_kibana_state(
    client: Elasticsearch,
    repository: str,
    snapshot_name: str,
) -> None:
    """Restore only the Kibana feature state from a snapshot.

    In ES 9.x the kibana feature state owns a large set of system indices
    (alerting, SLO, APM, ML, security-solution, etc.).  ES refuses to restore
    any of them while they are open, so we resolve the exact index list from
    the snapshot and close each one before restoring.
    """
    # Resolve the exact index names stored in this snapshot.
    snap_info = client.snapshot.get(repository=repository, snapshot=snapshot_name)
    snap_indices = snap_info["snapshots"][0].get("indices", [])

    # ES 8+ blocks wildcard closes by default — disable that restriction
    # transiently so we can close system indices by exact name.
    client.cluster.put_settings(body={"transient": {"action.destructive_requires_name": False}})

    if snap_indices:
        client.indices.close(
            index=",".join(snap_indices),
            ignore_unavailable=True,
            allow_no_indices=True,
        )
        info(f"Closed {len(snap_indices)} snapshot indices for restore.")

    client.snapshot.restore(
        repository=repository,
        snapshot=snapshot_name,
        body={
            "indices": [],
            "include_global_state": False,
            "feature_states": ["kibana"],
        },
        wait_for_completion=True,
    )
    success(f"Kibana feature state restored from '{snapshot_name}'")


# Convenience alias used throughout notebook 04.
SNAP_REPO = FS_REPO_NAME


def snap_delete_restore_cycle(snapshot_name: str, label: str) -> None:
    """
    Step 1 of the delete-restore exercise pattern: take a Kibana feature-state snapshot.

    Call this at the top of an exercise cell to capture the current Kibana state before
    you manually delete the object under test.  The snapshot name is re-used in the
    subsequent ``restore_kibana_state`` call at the bottom of the same cell.
    """
    heading(f"{label} — snapshot → delete → restore cycle")
    result = snapshot_kibana_state(get_client(), SNAP_REPO, snapshot_name)
    success(f'Snapshot "{snapshot_name}": {result["state"]}')
    feature_names = [fs["feature_name"] for fs in result.get("feature_states", [])]
    info(f"  Feature states captured: {feature_names}")


# ---------------------------------------------------------------------------
# Data stream snapshot / restore helpers
# ---------------------------------------------------------------------------

_FLEET_PREFIXES = ("logs-", "metrics-", "traces-", ".fleet")


def _is_fleet_stream(name: str) -> bool:
    return any(name.startswith(p) for p in _FLEET_PREFIXES)


def _template_exists(client: Elasticsearch, stream_name: str) -> bool:
    """Return True if a composable index template matches the given stream name."""
    try:
        templates = client.indices.get_index_template()
        for t in templates.get("index_templates", []):
            for pattern in t.get("index_template", {}).get("index_patterns", []):
                # Simple glob: replace * with a broad check
                import fnmatch
                if fnmatch.fnmatch(stream_name, pattern):
                    ds_block = t.get("index_template", {}).get("data_stream")
                    if ds_block is not None:
                        return True
        return False
    except Exception:
        return False


def precheck_data_stream_restore(
    client: Elasticsearch,
    repository: str,
    snapshot: str,
    streams: list,
    rename_to: dict = None,
) -> bool:
    """
    Run pre-flight checks before restoring data streams. Never modifies anything.

    Parameters
    ----------
    client      : Elasticsearch client
    repository  : snapshot repository name
    snapshot    : snapshot name
    streams     : list of data stream names to restore
    rename_to   : optional dict mapping original name → new name

    Returns True if all checks pass (no blockers found), False if any blocker exists.
    """
    rename_to = rename_to or {}
    heading("Pre-flight checks")
    blockers = 0
    warnings_ = 0

    # 1. Snapshot exists and is SUCCESS
    try:
        meta = client.snapshot.get(repository=repository, snapshot=snapshot)
        snap = meta["snapshots"][0]
        state = snap["state"]
        if state == "SUCCESS":
            success(f"Snapshot '{snapshot}' found — state: {state}")
        else:
            warn(f"Snapshot '{snapshot}' state is {state} — restore may be incomplete")
            warnings_ += 1
    except Exception as e:
        console.print(f"[bold red]✗[/bold red] Snapshot '{snapshot}' not found in '{repository}': {e}")
        blockers += 1
        return False

    snap_streams = set(snap.get("data_streams", []))
    snap_indices = set(snap.get("indices", []))
    had_global_state = bool(snap.get("feature_states"))

    if not had_global_state:
        warn(
            "Snapshot was taken without include_global_state=True — "
            "composable templates are NOT in the snapshot. "
            "Rollover will fail unless templates already exist on the target."
        )
        warnings_ += 1

    # 2. Per-stream checks
    for stream in streams:
        target_name = rename_to.get(stream, stream)
        console.print(f"\n[bold cyan]Stream:[/bold cyan] {stream}"
                      + (f"  →  [bold cyan]{target_name}[/bold cyan]" if target_name != stream else ""))

        # 2a. Stream is in the snapshot (not just backing indices)
        if stream in snap_streams:
            success(f"  '{stream}' is listed as a data stream in the snapshot")
        else:
            backing = [i for i in snap_indices if i.startswith(f".ds-{stream}")]
            if backing:
                console.print(
                    f"  [bold red]✗[/bold red] '{stream}' is NOT listed as a data stream — "
                    f"only its backing indices are in the snapshot ({len(backing)} found). "
                    "Restoring by backing index name will produce plain indices, not a data stream."
                )
                blockers += 1
            else:
                console.print(f"  [bold red]✗[/bold red] '{stream}' not found in snapshot at all")
                blockers += 1

        # 2b. Composable template exists for the target name
        if _template_exists(client, target_name):
            success(f"  Composable template found for '{target_name}'")
        else:
            warn(
                f"  No composable index template matches '{target_name}'. "
                "Restore will succeed but rollover will fail until a template is created."
            )
            warnings_ += 1

        # 2c. Stream already exists on target
        try:
            client.indices.get_data_stream(name=target_name)
            warn(
                f"  Data stream '{target_name}' already exists on this cluster. "
                "It must be deleted before restoring under the same name."
            )
            warnings_ += 1
        except Exception:
            success(f"  '{target_name}' does not exist — safe to restore")

        # 2d. Fleet-managed stream warning
        if _is_fleet_stream(target_name):
            warn(
                f"  '{target_name}' looks like a Fleet-managed stream. "
                "Do NOT restore with include_global_state=True — "
                "reinstall Fleet integrations on the target first."
            )
            warnings_ += 1

    # Summary
    console.print()
    if blockers:
        console.print(f"[bold red]Pre-flight FAILED[/bold red] — {blockers} blocker(s), {warnings_} warning(s). Fix blockers before restoring.")
    elif warnings_:
        console.print(f"[bold yellow]Pre-flight PASSED WITH WARNINGS[/bold yellow] — {warnings_} warning(s). Review before proceeding.")
    else:
        console.print("[bold green]Pre-flight PASSED[/bold green] — all checks clean.")

    return blockers == 0


def safe_snapshot_data_stream(
    client: Elasticsearch,
    repository: str,
    snapshot_name: str,
    streams: list,
) -> dict:
    """
    Take a complete, self-contained snapshot of one or more data streams.

    Always uses include_global_state=True so composable templates travel
    with the snapshot.  Warns about Fleet-managed streams.

    Returns the completed snapshot metadata dict.
    """
    import warnings as _warnings
    from elasticsearch import ElasticsearchWarning

    heading(f"Snapshotting data streams: {streams}")

    for stream in streams:
        if _is_fleet_stream(stream):
            warn(
                f"'{stream}' is a Fleet-managed stream. Restoring its templates "
                "via include_global_state=True may overwrite Fleet-owned templates on the target."
            )

    delete_snapshot_if_exists(client, repository, snapshot_name)

    with _warnings.catch_warnings(record=True) as caught:
        _warnings.simplefilter("always", ElasticsearchWarning)
        client.snapshot.create(
            repository=repository,
            snapshot=snapshot_name,
            indices=streams,
            include_global_state=True,
            wait_for_completion=False,
        )
        for w in caught:
            warn(f"ES: {w.message}")

    snap = wait_for_snapshot(client, repository, snapshot_name)
    success(f"Snapshot '{snapshot_name}' — state: {snap['state']}")
    info(f"  Data streams   : {snap.get('data_streams', [])}")
    info(f"  Backing indices: {len(snap.get('indices', []))} index(es)")
    info(f"  Global state   : included (templates travel with snapshot)")
    return snap


def safe_restore_data_stream(
    client: Elasticsearch,
    repository: str,
    snapshot: str,
    streams: list,
    rename_to: dict = None,
    delete_existing: bool = True,
    post_rollover: bool = True,
) -> dict:
    """
    Safely restore one or more data streams from a snapshot.

    Handles all common gotchas automatically:
      - Runs pre-flight checks and aborts on blockers
      - Deletes existing streams before restore (required by ES)
      - Refuses to proceed if the composable template is missing
      - Forces a rollover after restore to establish a clean write boundary
      - Returns a result dict with stream name, doc count, and generation

    Parameters
    ----------
    client          : Elasticsearch client
    repository      : snapshot repository name
    snapshot        : snapshot name
    streams         : list of data stream names to restore
    rename_to       : optional dict mapping original name → new name
    delete_existing : delete the stream if it already exists (default True)
    post_rollover   : force a rollover after restore (default True)
    """
    rename_to = rename_to or {}
    results = {}

    # Pre-flight
    ok = precheck_data_stream_restore(client, repository, snapshot, streams, rename_to)
    if not ok:
        raise RuntimeError("Pre-flight checks failed — aborting restore. Fix blockers and retry.")

    heading("Restoring data streams")

    for stream in streams:
        target = rename_to.get(stream, stream)

        # Template check — hard stop, not just a warning
        if not _template_exists(client, target):
            raise RuntimeError(
                f"No composable index template matches '{target}'. "
                "Create a template with 'data_stream: {{}}' and index_patterns "
                f"covering '{target}' before restoring."
            )

        # Delete existing stream if present
        if delete_existing:
            try:
                client.indices.delete_data_stream(name=target)
                info(f"Deleted existing data stream '{target}'")
            except Exception:
                pass

        # Build restore body
        body = {
            "indices": [stream],
            "include_global_state": False,  # template already verified on target
        }
        if target != stream:
            body["rename_pattern"] = stream
            body["rename_replacement"] = target

        client.snapshot.restore(
            repository=repository,
            snapshot=snapshot,
            body=body,
            wait_for_completion=True,
        )
        client.indices.refresh(index=target)

        doc_count = client.count(index=target)["count"]
        ds_info = client.indices.get_data_stream(name=target)["data_streams"][0]
        generation_after = ds_info["generation"]

        success(f"Restored '{stream}' → '{target}'")
        info(f"  Documents  : {doc_count}")
        info(f"  Generation : {generation_after}")
        info(f"  Backing    : {[i['index_name'] for i in ds_info['indices']]}")

        # Post-restore rollover
        if post_rollover:
            client.indices.rollover(alias=target)
            ds_after = client.indices.get_data_stream(name=target)["data_streams"][0]
            new_write = ds_after["indices"][-1]["index_name"]
            success(f"  Rollover complete — new write index: {new_write}")

        results[stream] = {
            "target": target,
            "doc_count": doc_count,
            "generation": generation_after,
            "write_index": client.indices.get_data_stream(name=target)["data_streams"][0]["indices"][-1]["index_name"],
        }

    heading("Restore complete")
    for original, r in results.items():
        success(f"  {original} → {r['target']}  |  {r['doc_count']} docs  |  write index: {r['write_index']}")

    return results


# ---------------------------------------------------------------------------
# Kibana deep-link helper
# ---------------------------------------------------------------------------

def kibana_link(path: str, label: str = None) -> None:
    """
    Render a clickable Kibana URL in the notebook output.

    Uses IPython HTML when available (Jupyter) and falls back to plain text.
    ``path`` should start with ``/`` and be relative to the Kibana root.
    """
    url = f"{KIBANA_BROWSER_HOST}{path}"
    text = label or path
    if _HAS_IPY:
        _ipy_display(_ipy_HTML(
            f'<p style="margin:4px 0">'
            f'<a href="{url}" target="_blank" '
            f'style="font-size:14px;font-family:monospace;color:#0077cc;">'
            f'&#x1F517; {text}</a></p>'
        ))
    else:
        info(f"Kibana link → {url}  ({text})")
