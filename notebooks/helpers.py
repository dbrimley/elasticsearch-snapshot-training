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

ES_HOST = os.environ.get("ES_HOST", "http://localhost:9200")
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
    """Restore only the Kibana feature state from a snapshot."""
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
