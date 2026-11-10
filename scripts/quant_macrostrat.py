import numpy as np, pandas as pd, geopandas as gpd, pyogrio, json, sys

SRC = "map_data.geojson"
REGIONS = {
    "JP": dict(cc=["JP"], bbox=(122.0, 24.0, 154.0, 46.5)),
    "US": dict(cc=["US"], bbox=(-125.5, 24.0, -66.0, 49.5)),
}

fc = pd.read_csv("fossil_collections.csv")

def snap(v, arcmin=1.0):
    step = arcmin / 60.0
    return np.round(v / step) * step

out = {}
for reg, cfg in REGIONS.items():
    print(f"=== {reg} ===", flush=True)
    poly = pyogrio.read_dataframe(SRC, bbox=cfg["bbox"])
    poly = poly.reset_index(drop=True)
    poly["poly_idx"] = poly.index
    print(f"  polygons: {len(poly)}  median area km2: {poly.area_.median() if 'area_' in poly else poly['area'].median():.1f}", flush=True)

    pts = fc[fc.country.isin(cfg["cc"])].copy()
    # bbox内に限定（海外領土などの混入を防ぐ）
    x0, y0, x1, y1 = cfg["bbox"]
    pts = pts[(pts.lon.between(x0, x1)) & (pts.lat.between(y0, y1))].copy()
    print(f"  collections: {len(pts)}", flush=True)

    res = {"region": reg, "n_polygons": int(len(poly)),
           "median_poly_area_km2": float(poly["area"].median()),
           "mean_poly_area_km2": float(poly["area"].mean()),
           "n_collections": int(len(pts))}

    def join(lon, lat, tag):
        g = gpd.GeoDataFrame(
            {"cid": pts.collection_no.values},
            geometry=gpd.points_from_xy(lon, lat), crs="EPSG:4326")
        j = gpd.sjoin(g, poly[["poly_idx", "legend_id", "map_id", "name",
                               "best_age_t", "best_age_b", "lith_class",
                               "geometry"]],
                      how="left", predicate="within")
        j = j.drop_duplicates("cid").set_index("cid")
        return j.add_suffix("_" + tag)

    base = join(pts.lon.values, pts.lat.values, "o")

    for arcmin in [1.0]:
        rl = snap(pts.lon.values, arcmin)
        rb = snap(pts.lat.values, arcmin)
        r = join(rl, rb, "r")
        m = base.join(r)
        both = m[m.poly_idx_o.notna() & m.poly_idx_r.notna()]
        res[f"arcmin{arcmin}_n_both_matched"] = int(len(both))
        res[f"arcmin{arcmin}_poly_change_pct"] = float(
            (both.poly_idx_o != both.poly_idx_r).mean() * 100)
        res[f"arcmin{arcmin}_legend_change_pct"] = float(
            (both.legend_id_o != both.legend_id_r).mean() * 100)
        age_chg = (~np.isclose(both.best_age_b_o.astype(float),
                               both.best_age_b_r.astype(float), equal_nan=True)) | \
                  (~np.isclose(both.best_age_t_o.astype(float),
                               both.best_age_t_r.astype(float), equal_nan=True))
        res[f"arcmin{arcmin}_age_change_pct"] = float(age_chg.mean() * 100)
        res[f"arcmin{arcmin}_lost_match_pct"] = float(
            (m.poly_idx_o.notna() & m.poly_idx_r.isna()).mean() * 100)
        # 年代差の大きさ
        d = (both.best_age_b_o.astype(float) - both.best_age_b_r.astype(float)).abs()
        res[f"arcmin{arcmin}_age_shift_median_Ma"] = float(d[d > 0].median()) if (d > 0).any() else 0.0
        res[f"arcmin{arcmin}_age_shift_p90_Ma"] = float(d[d > 0].quantile(0.9)) if (d > 0).any() else 0.0
        m.to_csv(f"out_{reg}_arcmin{arcmin}.csv")

    out[reg] = res
    print(json.dumps(res, indent=2), flush=True)
    del poly

with open("summary_macrostrat.json", "w") as f:
    json.dump(out, f, indent=2)
print("done")
