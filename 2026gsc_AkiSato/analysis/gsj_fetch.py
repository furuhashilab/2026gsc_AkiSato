#!/usr/bin/env python3
"""Query the GSJ Seamless Digital Geological Map V2 legend API for the original and the
1-arc-minute-rounded coordinates of each Japanese fossil collection.

Based on research/gsj/gsj_quantization_pilot.py (kept unchanged). Additions:
  * input can be the shared Macrostrat result CSV (cid + geometry_o) -> no extra data needed
  * every raw API response body is cached (api_cache.json) for later checking
  * duplicate coordinates are queried only once; successful answers are never re-queried
  * --probe prints raw responses for two test points so the response format can be checked
  * a run log (run_log.json) records how many requests were made and which failed

Output (default research/gsj/results/):
  per_collection.csv   one row per collection (cid, original/rounded symbol & formationAge_ja ...)
  summary.json         counts; NOT an error rate of fossil records
  api_cache.json       raw responses keyed by "lat,lon"
  run_log.json

Examples:
  python analysis/gsj_fetch.py --probe
  python analysis/gsj_fetch.py --limit 30            # 30-collection test (random, seed 42)
  python analysis/gsj_fetch.py --limit 0             # all 4,766 JP collections
  python analysis/gsj_fetch.py --fossil-csv fossil_collections.csv --limit 0

Notes:
  * symbol changed  != fossil record is wrong
  * formationAge_ja is a text label; a label change is not a change in Ma
  * GSJ legend symbols and Macrostrat legend_id are different classification systems;
    never compare them as if they were the same unit.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RESEARCH, parse_point_wkt, snap  # noqa: E402

ENDPOINT = "https://gbank.gsj.jp/seamless/v2/api/1.3.1/legend.json"
FIELDS = ("symbol", "formationAge_ja", "formationAge_en", "group_ja", "lithology_ja")
USER_AGENT = "FossilOverlayAudit/1.0 (research script; python-requests)"
# A point on land in central Tokyo and a point in the open Pacific for --probe.
PROBE_POINTS = [(35.6812, 139.7671, "land (Tokyo Station)"), (30.0, 145.0, "open ocean")]


def key(lat: float, lon: float) -> str:
    return f"{lat:.10f},{lon:.10f}"


def point_param(lat: float, lon: float, order: str) -> str:
    return f"{lat:.10f},{lon:.10f}" if order == "latlon" else f"{lon:.10f},{lat:.10f}"


def parse_response(status_code: int, text: str) -> dict:
    """Classify one HTTP answer. Keeps the raw text so the format can be audited."""
    rec = {"http_status": status_code, "raw": text[:2000]}
    if status_code != 200:
        rec["_status"] = "http_error"
        return rec
    try:
        data = json.loads(text)
    except ValueError:
        rec["_status"] = "not_json"
        return rec
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict):
        data = data[0]
    if not isinstance(data, dict):
        rec["_status"] = "unexpected_response"
        return rec
    for f in FIELDS:
        rec[f] = data.get(f)
    rec["_status"] = "ok" if data.get("symbol") else "no_legend"
    return rec


def query_gsj(session, lat, lon, order="latlon", retries=3, backoff=2.0, timeout=30) -> dict:
    last = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(ENDPOINT, params={"point": point_param(lat, lon, order)}, timeout=timeout)
            rec = parse_response(resp.status_code, resp.text)
            if rec["_status"] == "http_error" and resp.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            return rec
        except requests.RequestException as e:  # DNS, proxy, timeout, TLS ...
            last = {"_status": "request_error", "_error": f"{type(e).__name__}: {e}"[:500]}
            if attempt < retries:
                time.sleep(backoff * (2 ** attempt))
    return last


def load_input(args) -> pd.DataFrame:
    if args.fossil_csv:
        df = pd.read_csv(args.fossil_csv, low_memory=False)
        miss = {"country", "lat", "lon", "collection_no"} - set(df.columns)
        if miss:
            raise SystemExit(f"missing columns in {args.fossil_csv}: {sorted(miss)}")
        df = df[df["country"].astype(str).str.upper().eq("JP")].copy()
        df = df.rename(columns={"collection_no": "cid"})
        for c in ("lat", "lon"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
        # same bbox as quant_macrostrat.py, so the population matches the Macrostrat run
        df = df[df.lon.between(122.0, 154.0) & df.lat.between(24.0, 46.5)]
        return df[["cid", "lat", "lon"]].copy()
    m = pd.read_csv(args.input)
    lon, lat = zip(*m["geometry_o"].map(parse_point_wkt))
    return pd.DataFrame({"cid": m["cid"].astype(int), "lat": lat, "lon": lon})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", default=str(RESEARCH / "macrostrat" / "out_JP_arcmin1.0.csv"),
                    help="CSV with cid and geometry_o (default: shared Macrostrat JP result)")
    ap.add_argument("--fossil-csv", default=None, help="use Dryad fossil_collections.csv instead of --input")
    ap.add_argument("--limit", type=int, default=30, help="random sample size; 0 = all collections")
    ap.add_argument("--ids", default=None, help="comma-separated collection ids to query (overrides --limit)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--delay", type=float, default=1.0, help="pause after each network request (s)")
    ap.add_argument("--point-order", choices=["latlon", "lonlat"], default="latlon",
                    help="order inside ?point= (check with --probe first)")
    ap.add_argument("--output", default=str(RESEARCH / "gsj" / "results"))
    ap.add_argument("--probe", action="store_true", help="print raw responses for 2 test points and exit")
    ap.add_argument("--max-consecutive-errors", type=int, default=10,
                    help="stop early when the API keeps failing (e.g. no network)")
    args = ap.parse_args(argv)

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    if args.probe:
        for lat, lon, label in PROBE_POINTS:
            rec = query_gsj(session, lat, lon, args.point_order, retries=0)
            print(f"--- {label}: point={point_param(lat, lon, args.point_order)}")
            print(json.dumps(rec, ensure_ascii=False, indent=2))
        return

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    df = load_input(args)
    n_all = len(df)
    if args.ids:
        ids = {int(x) for x in args.ids.split(",") if x.strip()}
        df = df[df.cid.isin(ids)].copy()
    elif args.limit and len(df) > args.limit:
        df = df.sample(args.limit, random_state=args.seed).sort_index().copy()
    df["q_lat"] = snap(df["lat"])
    df["q_lon"] = snap(df["lon"])

    cache_path = out / "api_cache.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}

    coords = set()
    for r in df.itertuples(index=False):
        coords.add((float(r.lat), float(r.lon)))
        coords.add((float(r.q_lat), float(r.q_lon)))
    todo = [(la, lo) for la, lo in sorted(coords)
            if key(la, lo) not in cache or cache[key(la, lo)].get("_status") in ("request_error", "http_error")]
    log = {"started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "endpoint": ENDPOINT,
           "point_order": args.point_order, "collections": len(df), "unique_coordinates": len(coords),
           "cached_before": len(coords) - len(todo), "requests": 0, "errors": [], "stopped_early": False}
    consecutive = 0
    print(f"{len(df)} collections -> {len(coords)} unique coordinates, {len(todo)} to query", flush=True)
    for i, (lat, lon) in enumerate(todo, 1):
        rec = query_gsj(session, lat, lon, args.point_order)
        rec["queried_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cache[key(lat, lon)] = rec
        log["requests"] += 1
        if rec["_status"] in ("request_error", "http_error", "not_json", "unexpected_response"):
            consecutive += 1
            log["errors"].append({"point": key(lat, lon), "status": rec["_status"],
                                  "detail": rec.get("_error") or rec.get("raw", "")[:200]})
            print(f"  [{i}/{len(todo)}] {key(lat, lon)} -> {rec['_status']}: {log['errors'][-1]['detail']}", flush=True)
        else:
            consecutive = 0
            print(f"  [{i}/{len(todo)}] {key(lat, lon)} -> {rec['_status']} {rec.get('symbol')} {rec.get('formationAge_ja')}", flush=True)
        if i % 10 == 0:
            cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        if consecutive >= args.max_consecutive_errors:
            log["stopped_early"] = True
            print(f"stopping: {consecutive} consecutive failures (network or API problem)", flush=True)
            break
        time.sleep(args.delay)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")

    for prefix, la, lo in (("original", "lat", "lon"), ("rounded", "q_lat", "q_lon")):
        resp = [cache.get(key(a, b), {"_status": "not_queried"}) for a, b in zip(df[la], df[lo])]
        df[f"{prefix}_status"] = [d.get("_status") for d in resp]
        for f in FIELDS:
            df[f"{prefix}_{f}"] = [d.get(f) for d in resp]
    valid = df.original_status.eq("ok") & df.rounded_status.eq("ok")
    df["comparable"] = valid
    df["symbol_changed"] = pd.Series(pd.NA, index=df.index, dtype="object")
    df.loc[valid, "symbol_changed"] = df.loc[valid, "original_symbol"] != df.loc[valid, "rounded_symbol"]
    age_valid = valid & df.original_formationAge_ja.notna() & df.rounded_formationAge_ja.notna()
    df["age_label_changed"] = pd.Series(pd.NA, index=df.index, dtype="object")
    df.loc[age_valid, "age_label_changed"] = df.loc[age_valid, "original_formationAge_ja"] != df.loc[age_valid, "rounded_formationAge_ja"]
    nvalid = int(valid.sum())
    # A run without a single valid answer must not look like a result in the web app.
    per_name = "per_collection.csv" if nvalid else "per_collection_NO_VALID_RESPONSES.csv"
    df.to_csv(out / per_name, index=False, encoding="utf-8-sig")

    nage = int(age_valid.sum())
    nsym = int(df.symbol_changed.eq(True).sum())
    nagec = int(df.age_label_changed.eq(True).sum())
    summary = {
        "input": args.fossil_csv or args.input,
        "total_JP_collections_in_input": n_all,
        "collections_in_this_run": len(df),
        "quantization": "1 arcminute, round half to even, grid origin (0,0)",
        "gsj_api": ENDPOINT, "point_order": args.point_order,
        "unique_coordinate_queries_needed": len(coords),
        "new_requests_this_run": log["requests"],
        "status_original": df.original_status.value_counts().to_dict(),
        "status_rounded": df.rounded_status.value_counts().to_dict(),
        "both_responses_valid_n": nvalid,
        "symbol_changes_n": nsym,
        "symbol_change_percent_of_comparable": round(100 * nsym / nvalid, 4) if nvalid else None,
        "both_age_labels_valid_n": nage,
        "formation_age_label_changes_n": nagec,
        "formation_age_label_change_percent": round(100 * nagec / nage, 4) if nage else None,
        "important": "Change rates of map look-up results under artificial rounding. Not a fossil error rate.",
    }
    log["finished"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "run_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if nvalid == 0:
        print("WARNING: no comparable responses were obtained. Do not report GSJ results from this run.", flush=True)
        sys.exit(2)


if __name__ == "__main__":
    main()
