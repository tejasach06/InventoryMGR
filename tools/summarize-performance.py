#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Any

MAX_CV = 0.05
TIMING_IMPROVEMENT = -10.0
TIMING_REGRESSION = 5.0
EXPECTED_BACKEND = {"backend_warmups": 5, "backend_samples": 30, "vm_count": 200}
EXPECTED_FRONTEND = {"frontend_warmups": 3, "frontend_samples": 15}
EXPECTED_ENDPOINTS = {"dashboard", "reports_summary", "vm_list"}
EXPECTED_ROUTES = {"/dashboard", "/reports", "/inventory"}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def median(values: list[float | int]) -> float:
    return float(statistics.median(values))


def coefficient_of_variation(values: list[float | int]) -> float:
    if len(values) < 2:
        return 0.0
    mean = statistics.mean(values)
    return 0.0 if mean == 0 else float(statistics.stdev(values) / mean)


def current_commit() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def summarize_backend(data: dict[str, Any]) -> dict[str, Any]:
    metadata = data.get("metadata", {})
    for key, expected in EXPECTED_BACKEND.items():
        require(metadata.get(key) == expected, f"backend metadata {key}={metadata.get(key)!r}, expected {expected!r}")
    endpoints = data.get("endpoints", {})
    require(set(endpoints) == EXPECTED_ENDPOINTS, f"backend endpoints differ: {sorted(endpoints)}")
    result: dict[str, Any] = {}
    for name, values in endpoints.items():
        durations = values.get("durations_ms", [])
        queries = values.get("query_counts", [])
        require(len(durations) == 30, f"{name} duration sample count is {len(durations)}")
        require(len(queries) == 30, f"{name} query sample count is {len(queries)}")
        cv = coefficient_of_variation(durations)
        if cv > MAX_CV:
            print(f"warning: {name} backend timing CV {cv:.4f} exceeds {MAX_CV:.2f}; timing candidates must be rejected", file=sys.stderr)
        result[name] = {
            "median_duration_ms": median(durations),
            "duration_cv": cv,
            "timing_stable": cv <= MAX_CV,
            "median_queries": median(queries),
        }
    return {"metadata": metadata, "endpoints": result}


def summarize_frontend(data: dict[str, Any], bundle: dict[str, Any]) -> dict[str, Any]:
    metadata = data.get("metadata", {})
    for key, expected in EXPECTED_FRONTEND.items():
        require(metadata.get(key) == expected, f"frontend metadata {key}={metadata.get(key)!r}, expected {expected!r}")
    routes = data.get("routes", {})
    require(set(routes) == EXPECTED_ROUTES, f"frontend routes differ: {sorted(routes)}")
    result: dict[str, Any] = {}
    for route, values in routes.items():
        durations = values.get("durations_ms", [])
        transfers = values.get("transfer_bytes", [])
        require(len(durations) == 15, f"{route} duration sample count is {len(durations)}")
        require(len(transfers) == 15, f"{route} transfer sample count is {len(transfers)}")
        cv = coefficient_of_variation(durations)
        if cv > MAX_CV:
            print(f"warning: {route} frontend timing CV {cv:.4f} exceeds {MAX_CV:.2f}; timing candidates must be rejected", file=sys.stderr)
        result[route] = {
            "median_duration_ms": median(durations),
            "duration_cv": cv,
            "timing_stable": cv <= MAX_CV,
            "median_transfer_bytes": median(transfers),
        }
    total = bundle.get("bundle_gzip_bytes")
    require(isinstance(total, int) and total > 0, "bundle_gzip_bytes must be a positive integer")
    chunks = bundle.get("chunks")
    require(isinstance(chunks, dict) and chunks, "bundle chunks must be present")
    return {"metadata": metadata, "routes": result, "bundle_gzip_bytes": total, "chunks": chunks}


def build_baseline(args: argparse.Namespace) -> int:
    backend_raw = read_json(args.backend)
    frontend_raw = read_json(args.frontend)
    bundle_raw = read_json(args.bundle)
    output = {
        "metadata": {
            "source_commit": current_commit(),
            "backend_raw_commit": backend_raw.get("metadata", {}).get("git_commit"),
            "backend_warmups": 5,
            "backend_samples": 30,
            "frontend_warmups": 3,
            "frontend_samples": 15,
            "vm_count": 200,
        },
        "backend": summarize_backend(backend_raw),
        "frontend": summarize_frontend(frontend_raw, bundle_raw),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(f"wrote {args.output}")
    return 0


def pct_change(before: float, after: float) -> float:
    if before == 0:
        return 0.0 if after == 0 else float("inf")
    return ((after - before) / before) * 100.0


def compare(args: argparse.Namespace) -> int:
    baseline = read_json(args.baseline)
    candidate = read_json(args.candidate)
    failed = False
    claimed = candidate.get("metadata", {}).get("claimed_benefit")

    for name, base in baseline["backend"]["endpoints"].items():
        cand = candidate["backend"]["endpoints"][name]
        duration_delta = pct_change(base["median_duration_ms"], cand["median_duration_ms"])
        query_delta = cand["median_queries"] - base["median_queries"]
        print(f"backend {name}: duration {duration_delta:+.2f}%, queries {query_delta:+.0f}")
        timing_comparable = base.get("timing_stable", True) and cand.get("timing_stable", True)
        if (timing_comparable and duration_delta >= TIMING_REGRESSION) or query_delta > 0:
            failed = True
        if claimed == "timing" and (not timing_comparable or duration_delta > TIMING_IMPROVEMENT):
            failed = True

    bundle_delta = candidate["frontend"]["bundle_gzip_bytes"] - baseline["frontend"]["bundle_gzip_bytes"]
    bundle_pct = pct_change(baseline["frontend"]["bundle_gzip_bytes"], candidate["frontend"]["bundle_gzip_bytes"])
    print(f"frontend bundle_gzip_bytes: {bundle_pct:+.2f}%, bytes {bundle_delta:+.0f}")
    if bundle_delta > 0:
        failed = True
    for route, base in baseline["frontend"]["routes"].items():
        cand = candidate["frontend"]["routes"][route]
        duration_delta = pct_change(base["median_duration_ms"], cand["median_duration_ms"])
        transfer_delta = cand["median_transfer_bytes"] - base["median_transfer_bytes"]
        print(f"frontend {route}: duration {duration_delta:+.2f}%, transfer_bytes {transfer_delta:+.0f}")
        timing_comparable = base.get("timing_stable", True) and cand.get("timing_stable", True)
        if (timing_comparable and duration_delta >= TIMING_REGRESSION) or transfer_delta > 0:
            failed = True
        if claimed == "timing" and (not timing_comparable or duration_delta > TIMING_IMPROVEMENT):
            failed = True
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    baseline = sub.add_parser("baseline")
    baseline.add_argument("--backend", type=Path, required=True)
    baseline.add_argument("--frontend", type=Path, required=True)
    baseline.add_argument("--bundle", type=Path, required=True)
    baseline.add_argument("--output", type=Path, required=True)
    baseline.set_defaults(func=build_baseline)
    compare_parser = sub.add_parser("compare")
    compare_parser.add_argument("--baseline", type=Path, required=True)
    compare_parser.add_argument("--candidate", type=Path, required=True)
    compare_parser.set_defaults(func=compare)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
