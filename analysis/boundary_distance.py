#!/usr/bin/env python3
"""Distance from each fossil collection point (original and 1-arcmin-rounded) to the
nearest geological-unit BOUNDARY LINE of the GSJ Seamless Geological Map V2 vector data.

Why boundary lines and not polygons: a point inside a polygon has distance 0 to the
polygon itself, so we measure to the polygon edges, after classifying every edge piece:

  diff_legend   edge shared by two land polygons with DIFFERENT legend values
                (= a boundary between different geological units)
  same_legend   edge shared by two polygons with the SAME legend value
                (e.g. a split line between map sheets; not a geological boundary)
  coastline     edge between a land polygon and a polygon whose legend is listed in
                --water-legends (only if the data contains water polygons)
  outer_edge    edge touching no other polygon: coastline or an area without data
  data_extent   artificial edge created by clipping the data around the points
                (never treated as a geological boundary)

Distances are computed in metres in a projected CRS: each collection is processed in the
JGD2011 / UTM zone of its ORIGINAL longitude (EPSG:6688-6692; EPSG:32656 for zone 56),
and the rounded point of the same collection uses the same zone. For the main metric
(diff_legend) the nearest point is also transformed back and the distance is re-measured
on the GRS80 ellipsoid (pyproj.Geod) as a check. Degrees are never used as distances.

Usage:
  # 1) (optional) convert the downloaded shapefile to GeoParquet once
  python analysis/boundary_distance.py convert PATH/TO/seamless_v2.shp research/boundary/gsj_v2.parquet

  # 2) compute distances (legend column name depends on the GSJ file; check with --list-columns)
  python analysis/boundary_distance.py run research/boundary/gsj_v2.parquet --legend-field symbol
  python analysis/boundary_distance.py run PATH/TO/seamless_v2.shp --list-columns

Outputs (research/boundary/results/):
  boundary_distances.csv      one row per collection, *_o = original, *_r = rounded
  boundary_distances.parquet  same as GeoParquet (point geometry = original coordinate, EPSG:4326)
  boundary_lines_<epsg>.parquet  classified boundary pieces (with --write-lines)
  run_meta.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import Geod, Transformer
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RESEARCH, parse_point_wkt, snap, utm_epsg_jgd2011  # noqa: E402

GEOD = Geod(ellps="GRS80")
CLASSES = ("diff_legend", "same_legend", "coastline", "outer_edge", "data_extent")


# ---------------------------------------------------------------- boundary extraction
def _linear_parts(geoms: np.ndarray) -> np.ndarray:
    """Return only LineString parts (drop points produced by corner contacts)."""
    parts = shapely.get_parts(geoms)
    # GeometryCollections can contain MultiLineStrings -> explode twice
    parts = shapely.get_parts(parts)
    if len(parts) == 0:
        return parts
    t = shapely.get_type_id(parts)
    return parts[(t == 1) | (t == 2)]  # LineString / LinearRing


def classify_boundaries(polys: gpd.GeoDataFrame, legend_field: str, water_legends=frozenset(),
                        extent=None, tol: float = 0.05) -> gpd.GeoDataFrame:
    """Split all polygon edges into classified line pieces.

    polys  : polygons in a METRIC projected CRS
    extent : shapely Polygon of the clip window (same CRS) or None
    tol    : metres; edge pieces within tol of a shared edge / the extent are matched
    """
    p = polys[[legend_field, "geometry"]].explode(index_parts=False).reset_index(drop=True)
    p = p[~p.geometry.is_empty & p.geometry.notna()]
    p = p.reset_index(drop=True)
    leg = p[legend_field].astype(str).to_numpy()
    water = np.isin(leg, list(water_legends))
    bnd = shapely.boundary(p.geometry.to_numpy())

    i, j = p.sindex.query(p.geometry.to_numpy(), predicate="intersects")
    keep = i < j
    i, j = i[keep], j[keep]
    shared = shapely.intersection(bnd[i], bnd[j])

    pieces, labels = [], []
    for a, b, g in zip(i, j, shared):
        lines = _linear_parts(np.array([g]))
        if len(lines) == 0:
            continue
        if water[a] and water[b]:
            cls = "water_internal"
        elif water[a] or water[b]:
            cls = "coastline"
        elif leg[a] == leg[b]:
            cls = "same_legend"
        else:
            cls = "diff_legend"
        pieces.extend(lines)
        labels.extend([cls] * len(lines))

    all_edges = shapely.union_all(bnd)
    if pieces:
        shared_union = shapely.union_all(np.array(pieces))
        unshared = shapely.difference(all_edges, shapely.buffer(shared_union, tol))
    else:
        unshared = all_edges
    un = _linear_parts(np.array([unshared]))
    if extent is not None and len(un):
        ext_zone = shapely.buffer(shapely.boundary(extent), tol)
        on_ext = shapely.intersection(un, ext_zone)
        off_ext = shapely.difference(un, ext_zone)
        for g in _linear_parts(on_ext):
            pieces.append(g)
            labels.append("data_extent")
        for g in _linear_parts(off_ext):
            pieces.append(g)
            labels.append("outer_edge")
    else:
        pieces.extend(un)
        labels.extend(["outer_edge"] * len(un))
    out = gpd.GeoDataFrame({"cls": labels}, geometry=list(pieces), crs=polys.crs)
    return out[out["cls"] != "water_internal"].reset_index(drop=True)


# ---------------------------------------------------------------- distances
def nearest_by_class(points: np.ndarray, lines: gpd.GeoDataFrame, max_distance: float | None = None) -> dict:
    """For each point return the distance (m) to the nearest line of each class (NaN if none)."""
    res = {}
    for cls in CLASSES:
        sub = lines.geometry[lines.cls == cls].to_numpy()
        d = np.full(len(points), np.nan)
        near = np.full(len(points), None, dtype=object)
        if len(sub):
            tree = shapely.STRtree(sub)
            (pi, li), dist = tree.query_nearest(points, max_distance=max_distance, return_distance=True, all_matches=False)
            d[pi] = dist
            near[pi] = sub[li]
        res[cls] = (d, near)
    return res


def legend_at(points: np.ndarray, polys: gpd.GeoDataFrame, legend_field: str) -> np.ndarray:
    """Point-in-polygon legend value (None outside all polygons; first match if overlapping)."""
    out = np.full(len(points), None, dtype=object)
    pi, qi = polys.sindex.query(points, predicate="within")
    seen = set()
    vals = polys[legend_field].astype(str).to_numpy()
    for a, b in zip(pi, qi):
        if a not in seen:
            out[a] = vals[b]
            seen.add(a)
    return out


def geodesic_check(points: np.ndarray, nearest: np.ndarray, crs) -> np.ndarray:
    """Re-measure point -> nearest boundary point on the ellipsoid."""
    d = np.full(len(points), np.nan)
    ok = np.array([g is not None for g in nearest])
    if not ok.any():
        return d
    seg = shapely.shortest_line(points[ok], np.array(list(nearest[ok])))
    c = shapely.get_coordinates(seg).reshape(-1, 2, 2)
    tr = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lon1, lat1 = tr.transform(c[:, 0, 0], c[:, 0, 1])
    lon2, lat2 = tr.transform(c[:, 1, 0], c[:, 1, 1])
    _, _, g = GEOD.inv(lon1, lat1, lon2, lat2)
    d[ok] = g
    return d


def compute_zone(pts: pd.DataFrame, polys_src: gpd.GeoDataFrame, legend_field: str, epsg: int,
                 search_radius: float, water_legends=frozenset(), write_lines: Path | None = None):
    """pts: DataFrame with cid, lon_o, lat_o, lon_r, lat_r (EPSG:4326). polys_src: any CRS."""
    tr = Transformer.from_crs("EPSG:4326", epsg, always_xy=True)
    xo, yo = tr.transform(pts.lon_o.to_numpy(), pts.lat_o.to_numpy())
    xr, yr = tr.transform(pts.lon_r.to_numpy(), pts.lat_r.to_numpy())
    margin = search_radius * 1.5
    extent = box(min(xo.min(), xr.min()) - margin, min(yo.min(), yr.min()) - margin,
                 max(xo.max(), xr.max()) + margin, max(yo.max(), yr.max()) + margin)
    # pre-select in source CRS, then reproject and clip exactly in metres
    ext_src = gpd.GeoSeries([extent], crs=epsg).to_crs(polys_src.crs).buffer(0).iloc[0]
    cand = polys_src.iloc[polys_src.sindex.query(ext_src, predicate="intersects")].copy()
    if cand.crs.is_geographic:
        # densify long straight lon/lat edges (~50 m) so that they bend correctly in UTM
        cand["geometry"] = shapely.segmentize(cand.geometry.to_numpy(), 0.0005)
    polys = cand.to_crs(epsg)
    polys = gpd.clip(polys, extent)
    polys = polys[polys.geom_type.isin(["Polygon", "MultiPolygon"])]
    lines = classify_boundaries(polys, legend_field, water_legends, extent=extent)
    if write_lines is not None:
        lines.to_parquet(write_lines / f"boundary_lines_{epsg}.parquet")

    out = pd.DataFrame({"cid": pts.cid.to_numpy(), "crs_epsg": epsg})
    for sfx, (x, y) in (("o", (xo, yo)), ("r", (xr, yr))):
        p = shapely.points(x, y)
        near = nearest_by_class(p, lines, max_distance=search_radius)
        for cls in CLASSES:
            out[f"d_{cls}_m_{sfx}"] = near[cls][0]
        out[f"d_diff_legend_geod_m_{sfx}"] = geodesic_check(p, near["diff_legend"][1], polys.crs)
        geo = np.vstack([near[c][0] for c in ("diff_legend", "coastline", "outer_edge")])
        out[f"nearest_geo_or_edge_class_{sfx}"] = [
            None if np.all(np.isnan(col)) else ("diff_legend", "coastline", "outer_edge")[int(np.nanargmin(col))]
            for col in geo.T]
        out[f"legend_{sfx}"] = legend_at(p, polys, legend_field)
        out[f"in_water_{sfx}"] = np.isin(out[f"legend_{sfx}"].astype(str), list(water_legends))
    lo, lr = out["legend_o"], out["legend_r"]
    out["vector_legend_changed"] = np.where(lo.notna() & lr.notna(), lo.astype(str) != lr.astype(str), None)
    return out


def load_points(path: Path) -> pd.DataFrame:
    m = pd.read_csv(path)
    if "geometry_o" in m.columns:
        lon, lat = zip(*m["geometry_o"].map(parse_point_wkt))
        df = pd.DataFrame({"cid": m["cid"].astype(int), "lon_o": lon, "lat_o": lat})
    else:
        df = pd.DataFrame({"cid": m["collection_no"].astype(int), "lon_o": m["lon"], "lat_o": m["lat"]})
    df["lon_r"] = snap(df.lon_o)
    df["lat_r"] = snap(df.lat_o)
    return df


def read_polys(path: Path) -> gpd.GeoDataFrame:
    if path.suffix.lower() in (".parquet", ".geoparquet"):
        return gpd.read_parquet(path)
    return gpd.read_file(path)


def cmd_convert(a):
    g = gpd.read_file(a.src)
    if g.crs is None:
        raise SystemExit("source has no CRS (.prj missing?) - set it with --assume-crs")
    Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
    g.to_parquet(a.dst)
    print(f"{len(g)} features, crs={g.crs}, columns={list(g.columns)} -> {a.dst}")


def cmd_run(a):
    polys = read_polys(Path(a.polygons))
    if a.list_columns:
        print(polys.crs)
        print(polys.drop(columns="geometry").head(10).to_string())
        return
    if a.legend_field not in polys.columns:
        raise SystemExit(f"--legend-field {a.legend_field!r} not in {list(polys.columns)}")
    if polys.crs is None:
        raise SystemExit("polygon data has no CRS")
    water = frozenset(x for x in (a.water_legends or "").split(",") if x)
    pts = load_points(Path(a.points))
    if a.limit:
        pts = pts.sample(a.limit, random_state=42) if len(pts) > a.limit else pts
    pts["epsg"] = [utm_epsg_jgd2011(lon) for lon in pts.lon_o]
    outdir = Path(a.output)
    outdir.mkdir(parents=True, exist_ok=True)
    parts = []
    for epsg, grp in pts.groupby("epsg"):
        print(f"zone EPSG:{epsg}: {len(grp)} collections", flush=True)
        parts.append(compute_zone(grp, polys, a.legend_field, int(epsg), a.search_radius, water,
                                  outdir if a.write_lines else None))
    res = pd.concat(parts, ignore_index=True)
    res = pts[["cid", "lon_o", "lat_o", "lon_r", "lat_r"]].merge(res, on="cid")
    res.to_csv(outdir / "boundary_distances.csv", index=False)
    gdf = gpd.GeoDataFrame(res, geometry=gpd.points_from_xy(res.lon_o, res.lat_o), crs="EPSG:4326")
    gdf.to_parquet(outdir / "boundary_distances.parquet")
    meta = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "polygons": str(a.polygons), "polygon_crs": str(polys.crs), "legend_field": a.legend_field,
            "water_legends": sorted(water), "search_radius_m": a.search_radius,
            "n_collections": int(len(res)), "zones": sorted(int(x) for x in pts.epsg.unique()),
            "max_abs_diff_projected_vs_geodesic_m": float(np.nanmax(np.abs(res.d_diff_legend_m_o - res.d_diff_legend_geod_m_o)))
            if res.d_diff_legend_m_o.notna().any() else None}
    (outdir / "run_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(json.dumps(meta, indent=2, ensure_ascii=False))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("convert", help="shapefile -> GeoParquet")
    c.add_argument("src")
    c.add_argument("dst")
    c.set_defaults(func=cmd_convert)
    r = sub.add_parser("run", help="compute boundary distances")
    r.add_argument("polygons", help="GSJ Seamless V2 polygons (.shp / .gpkg / .parquet)")
    r.add_argument("--legend-field", default="symbol")
    r.add_argument("--water-legends", default="", help="comma-separated legend values meaning water/sea")
    r.add_argument("--points", default=str(RESEARCH / "macrostrat" / "out_JP_arcmin1.0.csv"))
    r.add_argument("--search-radius", type=float, default=20000.0, help="metres")
    r.add_argument("--limit", type=int, default=0)
    r.add_argument("--output", default=str(RESEARCH / "boundary" / "results"))
    r.add_argument("--write-lines", action="store_true")
    r.add_argument("--list-columns", action="store_true")
    r.set_defaults(func=cmd_run)
    a = ap.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
