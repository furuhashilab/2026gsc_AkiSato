#!/usr/bin/env python3
"""PBDB Japan fossil collection coordinates vs GSJ Seamless Geological Map V2 API.
Outputs symbol and literal formation-age-label transitions; does NOT infer errors,
numeric geological ages, or actual collection location accuracy.

Usage:
  python gsj_quantization_pilot.py fossil_collections.csv --limit 30
  python gsj_quantization_pilot.py fossil_collections.csv --limit 0
Requires: pip install pandas requests
"""
import argparse
import json
import time
from pathlib import Path
import pandas as pd
import requests

ENDPOINT = "https://gbank.gsj.jp/seamless/v2/api/1.3.1/legend.json"

def key(lat, lon):
    return f"{lat:.10f},{lon:.10f}"

def query_gsj(session, lat, lon):
    try:
        response = session.get(ENDPOINT, params={"point": key(lat, lon)}, timeout=30)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            return {"_status": "unexpected_response"}
        if not data.get("symbol"):
            return {"_status": "no_legend"}
        return {"_status": "ok", "symbol": data.get("symbol"),
                "formationAge_ja": data.get("formationAge_ja"),
                "formationAge_en": data.get("formationAge_en"),
                "group_ja": data.get("group_ja")}
    except (requests.RequestException, ValueError) as e:
        return {"_status": "request_error", "_error": str(e)}

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv", help="Path to Dryad fossil_collections.csv")
    ap.add_argument("--limit", type=int, default=30, help="Sample size; 0 = all JP records")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--delay", type=float, default=0.6, help="Pause after each network query (seconds)")
    ap.add_argument("--output", default="gsj_results")
    args = ap.parse_args()
    if args.limit < 0 or args.delay < 0:
        ap.error("--limit and --delay must be nonnegative")

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(args.csv, low_memory=False)
    needed = {"country", "lat", "lon"}
    missing = needed - set(df.columns)
    if missing:
        raise SystemExit(f"Missing CSV columns: {sorted(missing)}")
    df = df[df["country"].astype(str).str.upper().eq("JP")].copy()
    for c in ("lat", "lon"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[df["lat"].between(-90, 90) & df["lon"].between(-180, 180)].copy()
    n_all = len(df)
    if args.limit and len(df) > args.limit:
        df = df.sample(args.limit, random_state=args.seed).sort_index().copy()

    # Half-to-even, zero-anchored, 1 arcminute = 1/60 degree.
    df["q_lat"] = (df["lat"] * 60).round() / 60
    df["q_lon"] = (df["lon"] * 60).round() / 60

    cache_path = out / "api_cache.json"
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    else:
        cache = {}
    session = requests.Session()

    coordinates = set()
    for r in df.itertuples(index=False):
        coordinates.add((float(r.lat), float(r.lon)))
        coordinates.add((float(r.q_lat), float(r.q_lon)))
    new_calls = 0
    for lat, lon in sorted(coordinates):
        k = key(lat, lon)
        # Do not permanently cache transient errors, allow retry on next run.
        if k not in cache or cache[k].get("_status") == "request_error":
            cache[k] = query_gsj(session, lat, lon)
            new_calls += 1
            # Save progressively; reruns do not repeat successful queries.
            if new_calls % 10 == 0:
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
            time.sleep(args.delay)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2),
                          encoding="utf-8")

    for prefix, latcol, loncol in (("original", "lat", "lon"),
                                   ("rounded", "q_lat", "q_lon")):
        responses = [cache.get(key(lat, lon), {}) for lat, lon in zip(df[latcol], df[loncol])]
        for field in ("_status", "symbol", "formationAge_ja", "formationAge_en", "group_ja"):
            df[f"{prefix}_{field.lstrip('_')}"] = [d.get(field) for d in responses]

    valid = df["original_status"].eq("ok") & df["rounded_status"].eq("ok")
    df["comparable"] = valid
    df["symbol_changed"] = pd.NA
    df["age_label_changed"] = pd.NA
    df.loc[valid, "symbol_changed"] = (
        df.loc[valid, "original_symbol"] != df.loc[valid, "rounded_symbol"]
    )
    age_valid = valid & df["original_formationAge_ja"].notna() & df["rounded_formationAge_ja"].notna()
    df.loc[age_valid, "age_label_changed"] = (
        df.loc[age_valid, "original_formationAge_ja"] != df.loc[age_valid, "rounded_formationAge_ja"]
    )
    df.to_csv(out / "per_collection.csv", index=False, encoding="utf-8-sig")

    nvalid = int(valid.sum())
    n_age = int(age_valid.sum())
    n_symbol_changes = int(df["symbol_changed"].eq(True).sum())
    n_age_changes = int(df["age_label_changed"].eq(True).sum())
    summary = {
        "source": args.csv,
        "total_valid_coordinate_JP_collections_in_input": n_all,
        "sample_collections": len(df),
        "quantization": "1 arcminute round-to-even, grid origin (0,0)",
        "gsj_api": ENDPOINT,
        "unique_coordinate_queries_needed": len(coordinates),
        "new_queries_this_run": new_calls,
        "both_responses_valid_n": nvalid,
        "symbol_changes_n": n_symbol_changes,
        "symbol_change_percent_of_comparable": round(100*n_symbol_changes/nvalid, 4) if nvalid else None,
        "both_age_labels_valid_n": n_age,
        "formation_age_label_changes_n": n_age_changes,
        "formation_age_label_change_percent": round(100*n_age_changes/n_age, 4) if n_age else None,
        "important": "Age *label* change is not numeric Ma change; do not call it a fossil error rate or polygon ID change."
    }
    (out/"summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
