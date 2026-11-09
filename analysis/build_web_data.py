#!/usr/bin/env python3
"""Build the static JSON/CSV files that the Fossil Overlay Audit web app reads.

Inputs (all inside this repository):
  research/macrostrat/out_JP_arcmin1.0.csv   Macrostrat point-in-polygon result (JP, per collection)
  research/macrostrat/out_US_arcmin1.0.csv   Same for the contiguous US
  research/macrostrat/summary_macrostrat.json
  research/readme_reported_values.json       Values transcribed from README.md (not recomputed)
Optional inputs (used only if the files exist):
  research/gsj/results/per_collection.csv     output of analysis/gsj_fetch.py
  research/boundary/results/boundary_distances.csv   output of analysis/boundary_distance.py
  --fossil-csv fossil_collections.csv          Dryad fossil table (adds fossil age interval)

This script does NOT re-run the Macrostrat spatial join (the original polygons are not
in the repository). It re-aggregates the shared result CSVs and checks that the numbers
match summary_macrostrat.json and README.md. A mismatch stops the build.

Usage:
  python analysis/build_web_data.py            # writes web/public/data/
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Geod

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPO, RESEARCH, coord_key, parse_point_wkt, sha256_file, snap  # noqa: E402

GEOD = Geod(ellps="GRS80")
MS_COLS = ["poly_idx", "legend_id", "map_id", "name", "best_age_t", "best_age_b", "lith_class"]
ROUNDING_WIDTHS_ARCSEC = [1, 6, 60, 300, 900]


def _none(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, (np.floating,)):
        return None if np.isnan(v) else float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if v is pd.NA:
        return None
    return v


def load_macrostrat(path: Path) -> pd.DataFrame:
    m = pd.read_csv(path)
    if m["cid"].duplicated().any():
        raise SystemExit(f"{path}: duplicated cid")
    lon_o, lat_o = zip(*m["geometry_o"].map(parse_point_wkt))
    lon_r, lat_r = zip(*m["geometry_r"].map(parse_point_wkt))
    m["lon_o"], m["lat_o"] = np.array(lon_o), np.array(lat_o)
    m["lon_r"], m["lat_r"] = np.array(lon_r), np.array(lat_r)
    m["cid"] = m["cid"].astype(int)
    o = m["poly_idx_o"].notna()
    r = m["poly_idx_r"].notna()
    m["ms_status"] = np.select(
        [o & r & (m.poly_idx_o != m.poly_idx_r), o & r, o & ~r, ~o & r],
        ["changed", "same", "lost", "gained"], default="neither")
    both = o & r
    m["ms_legend_changed"] = np.where(both, m.legend_id_o != m.legend_id_r, np.nan)
    age_chg = (~np.isclose(m.best_age_b_o, m.best_age_b_r, equal_nan=True)) | \
              (~np.isclose(m.best_age_t_o, m.best_age_t_r, equal_nan=True))
    m["ms_age_changed"] = np.where(both, age_chg, np.nan)
    return m


def macrostrat_metrics(m: pd.DataFrame) -> dict:
    both = m[m.ms_status.isin(["same", "changed"])]
    d = (both.best_age_b_o - both.best_age_b_r).abs()
    d = d[d > 0]
    changed = m[m.ms_status == "changed"]
    return {
        "n_collections": int(len(m)),
        "both_matched": int(len(both)),
        "poly_changed": int((m.ms_status == "changed").sum()),
        "legend_changed": int((both.ms_legend_changed == 1).sum()),
        "age_endpoint_changed": int((both.ms_age_changed == 1).sum()),
        "poly_change_pct": float((m.ms_status == "changed").sum() / len(both) * 100),
        "orig_unmatched": int(m.poly_idx_o.isna().sum()),
        "lost": int((m.ms_status == "lost").sum()),
        "gained": int((m.ms_status == "gained").sum()),
        "neither": int((m.ms_status == "neither").sum()),
        "lost_pct_of_all": float((m.ms_status == "lost").mean() * 100),
        "age_shift_median_Ma": float(d.median()) if len(d) else 0.0,
        "age_shift_p90_Ma": float(d.quantile(0.9)) if len(d) else 0.0,
        "unique_orig_coords": int(m.groupby(["lat_o", "lon_o"]).ngroups),
        "unique_rounded_coords": int(m.groupby([m.lat_r.round(9), m.lon_r.round(9)]).ngroups),
        "changed_unique_orig_coords": int(changed.groupby(["lat_o", "lon_o"]).ngroups),
        "changed_unique_rounded_coords": int(changed.groupby([changed.lat_r.round(9), changed.lon_r.round(9)]).ngroups),
    }


def check_against(metrics: dict, summary: dict, readme: dict, region: str) -> list[str]:
    """Return a list of human-readable check results; raise on mismatch."""
    out = []
    pref = "arcmin1.0_"
    pairs = [
        ("n_collections", summary["n_collections"]),
        ("both_matched", summary[pref + "n_both_matched"]),
    ]
    for k, v in pairs:
        if metrics[k] != v:
            raise SystemExit(f"[{region}] {k}: recomputed {metrics[k]} != summary_macrostrat.json {v}")
        out.append(f"{region} {k} = {v} (summary_macrostrat.json と一致)")
    if not math.isclose(metrics["poly_change_pct"], summary[pref + "poly_change_pct"], rel_tol=1e-9):
        raise SystemExit(f"[{region}] poly_change_pct mismatch")
    out.append(f"{region} poly_change_pct = {metrics['poly_change_pct']:.4f}% (summary_macrostrat.json と一致)")
    if not math.isclose(metrics["lost_pct_of_all"], summary[pref + "lost_match_pct"], rel_tol=1e-9):
        raise SystemExit(f"[{region}] lost_match_pct mismatch")
    if not math.isclose(metrics["age_shift_median_Ma"], summary[pref + "age_shift_median_Ma"], rel_tol=1e-9):
        raise SystemExit(f"[{region}] age_shift_median mismatch")
    for k in ["n_collections", "both_matched", "poly_changed", "age_endpoint_changed",
              "orig_unmatched", "lost", "gained"]:
        if metrics[k] != readme[k]:
            raise SystemExit(f"[{region}] {k}: recomputed {metrics[k]} != README.md {readme[k]}")
        out.append(f"{region} {k} = {readme[k]} (README.md 4.5 と一致)")
    return out


def rounding_width_table(m: pd.DataFrame) -> list[dict]:
    """Coordinate-only statistics for several rounding widths (computed from the JP CSV).

    Needs only coordinates, so it is fully reproducible from the shared CSV.
    Fossil ages are not in the CSV, so age-based counts are NOT computed here.
    """
    lat, lon = m.lat_o.to_numpy(), m.lon_o.to_numpy()
    orig_groups = m.groupby(["lat_o", "lon_o"]).size()
    orig_pairs = int((orig_groups * (orig_groups - 1) // 2).sum())
    rows = [{
        "label": "元座標", "arcsec": 0, "unique_coords": int(len(orig_groups)),
        "coords_with_2plus": int((orig_groups >= 2).sum()),
        "same_coord_pairs": orig_pairs, "new_pairs_vs_original": 0,
        "move_median_m": 0.0, "move_max_m": 0.0,
    }]
    labels = {1: "1秒角丸め", 6: "6秒角丸め", 60: "1分角丸め", 300: "5分角丸め", 900: "15分角丸め"}
    for sec in ROUNDING_WIDTHS_ARCSEC:
        rl, rb = snap(lon, sec / 60.0), snap(lat, sec / 60.0)
        g = pd.Series(1, index=pd.MultiIndex.from_arrays([np.round(rb, 9), np.round(rl, 9)])).groupby(level=[0, 1]).size()
        pairs = int((g * (g - 1) // 2).sum())
        _, _, dist = GEOD.inv(lon, lat, rl, rb)
        rows.append({
            "label": labels[sec], "arcsec": sec, "unique_coords": int(len(g)),
            "coords_with_2plus": int((g >= 2).sum()),
            "same_coord_pairs": pairs, "new_pairs_vs_original": pairs - orig_pairs,
            "move_median_m": float(np.median(dist)), "move_max_m": float(np.max(dist)),
        })
    return rows


def load_fossil_ages(path: Path | None, age_cols: str | None) -> pd.DataFrame | None:
    if path is None:
        return None
    fc = pd.read_csv(path, low_memory=False)
    id_col = "collection_no" if "collection_no" in fc.columns else "cid"
    candidates = [tuple(age_cols.split(","))] if age_cols else [
        ("max_ma", "min_ma"), ("early_age", "late_age"), ("b_age", "t_age"), ("age_max", "age_min")]
    for hi, lo in candidates:
        if hi in fc.columns and lo in fc.columns:
            out = fc[[id_col, hi, lo]].rename(columns={id_col: "cid", hi: "fossil_max_ma", lo: "fossil_min_ma"})
            out["cid"] = pd.to_numeric(out["cid"], errors="coerce")
            return out.dropna(subset=["cid"]).astype({"cid": int}).drop_duplicates("cid")
    raise SystemExit(f"fossil csv: age columns not found. Columns: {list(fc.columns)[:40]} ... use --age-cols HI,LO")


def load_gsj(path: Path) -> pd.DataFrame | None:
    if not path.exists():
        return None
    g = pd.read_csv(path, encoding="utf-8-sig")
    if "cid" not in g.columns:
        raise SystemExit(f"{path}: 'cid' column missing")
    return g.drop_duplicates("cid")


def load_boundary(path: Path) -> pd.DataFrame | None:
    if not path.exists():
        return None
    return pd.read_csv(path).drop_duplicates("cid")


def gsj_summary(g: pd.DataFrame | None, total_jp: int) -> dict:
    if g is None:
        return {"status": "not_analyzed", "message": "GSJ APIの取得結果（research/gsj/results/per_collection.csv）がまだありません。"}
    comp = g["comparable"].astype(str).str.lower().eq("true")
    sym = g["symbol_changed"].astype(str).str.lower().eq("true")
    age_valid = comp & g["original_formationAge_ja"].notna() & g["rounded_formationAge_ja"].notna()
    age = g["age_label_changed"].astype(str).str.lower().eq("true")
    changed = g[sym]
    status_o = g["original_status"].fillna("missing").value_counts().to_dict()
    status_r = g["rounded_status"].fillna("missing").value_counts().to_dict()
    return {
        "status": "analyzed",
        "n_collections_queried": int(len(g)),
        "is_full_population": bool(len(g) >= total_jp),
        "total_jp_collections": total_jp,
        "comparable": int(comp.sum()),
        "symbol_changed": int(sym.sum()),
        "symbol_change_pct": float(sym.sum() / comp.sum() * 100) if comp.sum() else None,
        "age_label_comparable": int(age_valid.sum()),
        "age_label_changed": int(age.sum()),
        "age_label_change_pct": float(age.sum() / age_valid.sum() * 100) if age_valid.sum() else None,
        "status_original": {str(k): int(v) for k, v in status_o.items()},
        "status_rounded": {str(k): int(v) for k, v in status_r.items()},
        "changed_unique_orig_coords": int(changed.groupby(["lat", "lon"]).ngroups) if len(changed) else 0,
    }


DIST_BINS = [0, 100, 250, 500, 1000, 2000, 5000, float("inf")]


def boundary_summary(b: pd.DataFrame | None, g: pd.DataFrame | None, m: pd.DataFrame) -> dict:
    if b is None:
        return {"status": "not_analyzed", "message": "地質境界までの距離（research/boundary/results/boundary_distances.csv）はまだ計算されていません。GSJのベクトルデータが必要です。"}
    out = {"status": "analyzed", "n": int(len(b)), "bins_m": [x if x != float("inf") else None for x in DIST_BINS]}
    col = "d_diff_legend_m_o"
    if col not in b.columns:
        return out
    labels = []
    for lo, hi in zip(DIST_BINS[:-1], DIST_BINS[1:]):
        labels.append(f"{int(lo)}–{int(hi)} m" if hi != float("inf") else f"{int(lo)} m以上")
    b = b.copy()
    b["bin"] = pd.cut(b[col], DIST_BINS, right=False, labels=labels)
    tables = {}
    # (a) vs Macrostrat polygon change (both matched only)
    mm = b.merge(m[["cid", "ms_status"]], on="cid", how="left")
    mm = mm[mm.ms_status.isin(["same", "changed"])]
    tables["macrostrat_poly_change"] = _bin_table(mm, mm.ms_status.eq("changed"))
    # (b) vs GSJ API symbol change
    if g is not None and "symbol_changed" in g.columns:
        gg = b.merge(g[["cid", "comparable", "symbol_changed"]], on="cid", how="inner")
        gg = gg[gg["comparable"].astype(str).str.lower().eq("true")]
        tables["gsj_api_symbol_change"] = _bin_table(gg, gg["symbol_changed"].astype(str).str.lower().eq("true"))
    # (c) vs GSJ vector point-in-polygon legend change
    if "vector_legend_changed" in b.columns:
        vv = b[b["vector_legend_changed"].notna()]
        tables["gsj_vector_legend_change"] = _bin_table(vv, vv["vector_legend_changed"].astype(str).str.lower().eq("true"))
    out["tables"] = tables
    out["median_d_diff_legend_m_o"] = float(b[col].median()) if b[col].notna().any() else None
    return out


def _bin_table(df: pd.DataFrame, changed: pd.Series) -> list[dict]:
    rows = []
    for lab in df["bin"].cat.categories:
        sel = df["bin"] == lab
        n = int(sel.sum())
        c = int((changed & sel).sum())
        rows.append({"bin": str(lab), "n": n, "changed": c, "pct": (c / n * 100) if n else None})
    na = df["bin"].isna()
    rows.append({"bin": "距離なし（探索半径外など）", "n": int(na.sum()), "changed": int((changed & na).sum()), "pct": None})
    return rows


def ms_side(row, sfx):
    if pd.isna(row[f"poly_idx_{sfx}"]):
        return None
    return {
        "poly": int(row[f"poly_idx_{sfx}"]), "legend": int(row[f"legend_id_{sfx}"]),
        "map": int(row[f"map_id_{sfx}"]), "name": _none(row[f"name_{sfx}"]),
        "age_t": _none(row[f"best_age_t_{sfx}"]), "age_b": _none(row[f"best_age_b_{sfx}"]),
        "lith": _none(row[f"lith_class_{sfx}"]),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(REPO / "web" / "public" / "data"))
    ap.add_argument("--fossil-csv", default=None, help="optional Dryad fossil_collections.csv (adds fossil ages)")
    ap.add_argument("--age-cols", default=None, help="HI,LO column names for fossil age interval in --fossil-csv")
    ap.add_argument("--gsj", default=str(RESEARCH / "gsj" / "results" / "per_collection.csv"))
    ap.add_argument("--boundary", default=str(RESEARCH / "boundary" / "results" / "boundary_distances.csv"))
    args = ap.parse_args(argv)

    out = Path(args.out)
    (out / "downloads").mkdir(parents=True, exist_ok=True)
    msdir = RESEARCH / "macrostrat"
    summary = json.loads((msdir / "summary_macrostrat.json").read_text())
    readme = json.loads((RESEARCH / "readme_reported_values.json").read_text())

    jp = load_macrostrat(msdir / "out_JP_arcmin1.0.csv")
    us = load_macrostrat(msdir / "out_US_arcmin1.0.csv")

    # The rounded coordinates in the CSV must equal our own 1-arcmin rounding.
    for name, df in (("JP", jp), ("US", us)):
        ok = np.allclose(snap(df.lon_o), df.lon_r, atol=1e-9) and np.allclose(snap(df.lat_o), df.lat_r, atol=1e-9)
        if not ok:
            raise SystemExit(f"{name}: rounded coordinates in CSV differ from 1-arcmin snap()")

    met = {"JP": macrostrat_metrics(jp), "US": macrostrat_metrics(us)}
    checks = ["JP/US: CSVの丸め後座標 = analysis/common.py の snap(1分角) と一致"]
    for reg in ("JP", "US"):
        checks += check_against(met[reg], summary[reg], readme["macrostrat_jp_us_4_5"][reg], reg)
    if met["JP"]["changed_unique_orig_coords"] != readme["macrostrat_jp_us_4_5"]["jp_changed_unique_original_coords"]:
        raise SystemExit("JP changed unique original coordinates != README (11)")
    checks.append("JP 変更15件の元座標の種類 = 11 (README.md 4.5 と一致)")

    # --- per-collection records (JP) ---
    _, _, move = GEOD.inv(jp.lon_o.to_numpy(), jp.lat_o.to_numpy(), jp.lon_r.to_numpy(), jp.lat_r.to_numpy())
    jp["move_m"] = move
    jp["key_o"] = [coord_key(a, b) for a, b in zip(jp.lat_o, jp.lon_o)]
    jp["key_r"] = [coord_key(a, b) for a, b in zip(jp.lat_r, jp.lon_r)]

    ages = load_fossil_ages(Path(args.fossil_csv) if args.fossil_csv else None, args.age_cols)
    if ages is not None:
        jp = jp.merge(ages, on="cid", how="left")
    gsj = load_gsj(Path(args.gsj))
    bnd = load_boundary(Path(args.boundary))
    gsj_idx = gsj.set_index("cid") if gsj is not None else None
    bnd_idx = bnd.set_index("cid") if bnd is not None else None

    records = []
    for _, row in jp.iterrows():
        cid = int(row.cid)
        rec = {
            "cid": cid,
            "o": [round(row.lon_o, 7), round(row.lat_o, 7)],
            "r": [round(row.lon_r, 9), round(row.lat_r, 9)],
            "ko": row.key_o, "kr": row.key_r,
            "move_m": round(float(row.move_m), 2),
            "ms": {"status": row.ms_status, "o": ms_side(row, "o"), "r": ms_side(row, "r"),
                   "legend_changed": None if pd.isna(row.ms_legend_changed) else bool(row.ms_legend_changed),
                   "age_changed": None if pd.isna(row.ms_age_changed) else bool(row.ms_age_changed)},
            "age": None, "gsj": None, "bd": None,
        }
        if ages is not None and not pd.isna(row.get("fossil_max_ma")):
            rec["age"] = {"max_ma": _none(row.fossil_max_ma), "min_ma": _none(row.fossil_min_ma)}
        if gsj_idx is not None and cid in gsj_idx.index:
            gr = gsj_idx.loc[cid]
            rec["gsj"] = {
                "o": {"status": _none(gr.get("original_status")), "symbol": _none(gr.get("original_symbol")),
                      "age_ja": _none(gr.get("original_formationAge_ja")), "group_ja": _none(gr.get("original_group_ja"))},
                "r": {"status": _none(gr.get("rounded_status")), "symbol": _none(gr.get("rounded_symbol")),
                      "age_ja": _none(gr.get("rounded_formationAge_ja")), "group_ja": _none(gr.get("rounded_group_ja"))},
                "comparable": str(gr.get("comparable")).lower() == "true",
                "symbol_changed": None if pd.isna(gr.get("symbol_changed")) else str(gr.get("symbol_changed")).lower() == "true",
                "age_label_changed": None if pd.isna(gr.get("age_label_changed")) else str(gr.get("age_label_changed")).lower() == "true",
            }
        if bnd_idx is not None and cid in bnd_idx.index:
            br = bnd_idx.loc[cid]
            rec["bd"] = {k: _none(br[k]) for k in bnd_idx.columns if k.startswith(("d_", "nearest_", "vector_", "legend_", "in_"))}
        records.append(rec)

    (out / "collections_jp.json").write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")))

    # --- downloads ---
    flat = jp[["cid", "lat_o", "lon_o", "lat_r", "lon_r", "move_m", "ms_status", "ms_legend_changed", "ms_age_changed"]
              + [f"{c}_{s}" for s in ("o", "r") for c in MS_COLS]].copy()
    flat = flat.rename(columns={"ms_status": "macrostrat_status"})
    flat.to_csv(out / "downloads" / "jp_macrostrat_per_collection.csv", index=False, encoding="utf-8-sig")
    flat[flat.macrostrat_status == "changed"].to_csv(out / "downloads" / "jp_macrostrat_changed_15.csv", index=False, encoding="utf-8-sig")
    for f in ("out_JP_arcmin1.0.csv", "out_US_arcmin1.0.csv", "summary_macrostrat.json"):
        shutil.copy(msdir / f, out / "downloads" / f)
    if gsj is not None:
        shutil.copy(Path(args.gsj), out / "downloads" / "gsj_per_collection.csv")
    if bnd is not None:
        shutil.copy(Path(args.boundary), out / "downloads" / "boundary_distances.csv")

    inputs = {str(p.relative_to(REPO)): sha256_file(p) for p in sorted(msdir.iterdir()) if p.is_file()}
    site = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "inputs_sha256": inputs,
        "checks": checks,
        "macrostrat": met,
        "macrostrat_summary_json": summary,
        "readme": readme,
        "rounding_widths_coordinate_only": rounding_width_table(jp),
        "jp_unique_coords": {
            "collections": int(len(jp)),
            "unique_orig": met["JP"]["unique_orig_coords"],
            "unique_rounded": met["JP"]["unique_rounded_coords"],
            "orig_coords_with_2plus": int((jp.groupby("key_o").size() >= 2).sum()),
        },
        "move_m_JP": {"median": float(np.median(move)), "max": float(np.max(move)), "p90": float(np.quantile(move, 0.9))},
        "fossil_ages": "loaded" if ages is not None else "not_available",
        "gsj": gsj_summary(gsj, len(jp)),
        "boundary": boundary_summary(bnd, gsj, jp),
        "downloads": sorted(p.name for p in (out / "downloads").iterdir()),
    }
    (out / "site_summary.json").write_text(json.dumps(site, ensure_ascii=False, indent=1))
    for c in checks:
        print("OK", c)
    print(f"wrote {out}/collections_jp.json ({len(records)} records), site_summary.json, downloads/")


if __name__ == "__main__":
    main()
