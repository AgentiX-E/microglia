#!/usr/bin/env python3
"""Download a workflow run's evidence artefact, in parallel ranges, and unpack it.

Why ranges. The signed blob URL is reachable from here but throttled to about
24 KB/s per connection: a 20 MB evidence archive takes fourteen minutes serially,
which is longer than the readback it feeds is worth. Azure Blob honours `Range`, so
the download is split into fixed-size chunks fetched concurrently and reassembled in
order, with the assembled length checked against the size the API reported. A
mismatch is a failed download, not a smaller archive.

Why not urllib. The API answers 302 to a storage host with its own signature, and a
request that carries the API's `Authorization` header there is answered 401 rather
than ignored. The signature carries its own permission; the token is dropped.

Usage:
  fetch_evidence.py --repo microglia --run 42438746694 --out /tmp/r54-evidence
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import subprocess
import sys
import zipfile

API = "https://api.github.com"
OWNER = "AgentiX-E"
CHUNK = 1 << 20
WORKERS = 16


def token() -> str:
    with open("/root/.gh_pat", encoding="utf-8") as handle:
        return handle.read().strip()


def call(path: str) -> dict:
    result = subprocess.run(
        [
            "curl", "-sS", "--max-time", "60",
            "-H", f"Authorization: Bearer {token()}",
            "-H", "Accept: application/vnd.github+json",
            "-H", "X-GitHub-Api-Version: 2022-11-28",
            f"{API}{path}",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def signed_url(path: str) -> str:
    header = subprocess.run(
        [
            "curl", "-sS", "--max-time", "60", "-o", "/dev/null", "-D", "-",
            "-H", f"Authorization: Bearer {token()}",
            "-H", "Accept: application/vnd.github+json",
            f"{API}{path}",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    for line in header.splitlines():
        if line.lower().startswith("location:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit(f"no redirect from {path}")


def grab(url: str, start: int, end: int, target: str) -> int:
    subprocess.run(
        ["curl", "-sS", "--max-time", "300", "-r", f"{start}-{end}", "-o", target, url],
        check=True,
    )
    return os.path.getsize(target)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--artifact", default="")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    # `--artifact` selects by NAME, and the first version assigned it to `artifact_id`, so passing the
    # name the flag documents looked up `/actions/artifacts/l4-evidence` and died on a missing
    # `size_in_bytes`. A run now carries more than one archive — R61 uploaded both `l4-evidence` and
    # `sota-bird` — which is what makes selection necessary and what made the wrong guess visible.
    listing = call(f"/repos/{OWNER}/{args.repo}/actions/runs/{args.run}/artifacts")
    live = [a for a in listing.get("artifacts", []) if not a.get("expired")]
    if args.artifact:
        chosen = [a for a in live if a.get("name") == args.artifact]
        if len(chosen) != 1:
            names = ", ".join(f"{a['name']}({a['id']})" for a in live) or "none"
            print(
                f"no unexpired artefact named '{args.artifact}' on run {args.run}; "
                f"this run holds: {names}",
                file=sys.stderr,
            )
            return 2
    else:
        if len(live) != 1:
            names = ", ".join(f"{a['name']}({a['id']})" for a in live) or "none"
            print(
                f"expected exactly one artefact on run {args.run}, found: {names}; "
                "name one with --artifact",
                file=sys.stderr,
            )
            return 2
        chosen = live
    artifact_id = str(chosen[0]["id"])
    name = chosen[0]["name"]
    size = chosen[0]["size_in_bytes"]

    url = signed_url(f"/repos/{OWNER}/{args.repo}/actions/artifacts/{artifact_id}/zip")
    os.makedirs(args.out, exist_ok=True)
    pieces = os.path.join(args.out, ".parts")
    os.makedirs(pieces, exist_ok=True)

    ranges = [(start, min(start + CHUNK, size) - 1) for start in range(0, size, CHUNK)]
    targets = [os.path.join(pieces, f"{index:05d}") for index in range(len(ranges))]
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [
            pool.submit(grab, url, start, end, target)
            for (start, end), target in zip(ranges, targets)
        ]
        for future in concurrent.futures.as_completed(futures):
            future.result()

    archive_path = os.path.join(args.out, f"{name}.zip")
    with open(archive_path, "wb") as archive:
        for target in targets:
            with open(target, "rb") as piece:
                archive.write(piece.read())
    assembled = os.path.getsize(archive_path)
    if assembled != size:
        print(f"assembled {assembled} bytes, the API reported {size}", file=sys.stderr)
        return 1
    for target in targets:
        os.remove(target)
    os.rmdir(pieces)

    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(args.out)
        entries = archive.namelist()
    print(f"{name} ({assembled} bytes, {len(entries)} entries) -> {args.out}")
    for entry in entries:
        if entry.endswith(".json") and "poc-l4" in entry:
            print(f"  {entry}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
