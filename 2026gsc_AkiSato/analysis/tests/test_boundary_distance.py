"""Known simple shapes -> known distances (metres)."""
import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
import shapely
from pyproj import Transformer
from shapely.geometry import box

import boundary_distance as bd

CRS = "EPSG:6691"  # JGD2011 / UTM 54N, metres


def squares(with_water=False):
    # A(X) | B(Y)        1 km squares
    # C(X) above A      -> A-C edge is same_legend, A-B edge is diff_legend
    geoms = [box(0, 0, 1000, 1000), box(1000, 0, 2000, 1000), box(0, 1000, 1000, 2000)]
    legs = ["X", "Y", "X"]
    if with_water:
        geoms.append(box(2000, 0, 3000, 1000))
        legs.append("W")
    return gpd.GeoDataFrame({"sym": legs}, geometry=geoms, crs=CRS)


def dists(points, lines):
    r = bd.nearest_by_class(np.array(points), lines)
    return {k: v[0] for k, v in r.items()}


def test_classes_and_distances_inside_polygon():
    lines = bd.classify_boundaries(squares(), "sym")
    assert set(lines.cls) == {"diff_legend", "same_legend", "outer_edge"}
    assert lines[lines.cls == "diff_legend"].length.sum() == pytest.approx(1000)
    assert lines[lines.cls == "same_legend"].length.sum() == pytest.approx(1000)
    # perimeter of the L-shape union = 8000 m, minus nothing shared
    # L-shape perimeter 8000 m; the 0.05 m matching tolerance trims < 0.5 m at nodes
    assert lines[lines.cls == "outer_edge"].length.sum() == pytest.approx(8000, abs=0.5)
    p = shapely.points([[900, 500], [500, 950]])
    d = dists(p, lines)
    assert d["diff_legend"][0] == pytest.approx(100)
    assert d["same_legend"][0] == pytest.approx(500)
    assert d["outer_edge"][0] == pytest.approx(500)   # A's bottom edge y=0
    assert d["same_legend"][1] == pytest.approx(50)    # A|C edge y=1000
    assert d["diff_legend"][1] == pytest.approx(500)   # A|B edge x=1000 -> (1000, 950)


def test_point_inside_polygon_has_zero_polygon_distance_but_positive_boundary_distance():
    g = squares()
    p = shapely.Point(500, 500)
    assert g.geometry.iloc[0].distance(p) == 0  # polygon distance is useless
    lines = bd.classify_boundaries(g, "sym")
    d = dists([p], lines)
    assert d["diff_legend"][0] == pytest.approx(500)
    assert d["same_legend"][0] == pytest.approx(500)


def test_water_polygon_gives_coastline_class():
    lines = bd.classify_boundaries(squares(with_water=True), "sym", water_legends={"W"})
    assert "coastline" in set(lines.cls)
    assert lines[lines.cls == "coastline"].length.sum() == pytest.approx(1000)
    d = dists([shapely.Point(1900, 500)], lines)
    assert d["coastline"][0] == pytest.approx(100)
    assert d["diff_legend"][0] == pytest.approx(900)


def test_clip_edges_are_data_extent_not_geology():
    g = squares()
    extent = box(-500, -500, 1500, 1500)
    clipped = gpd.clip(g, extent)
    lines = bd.classify_boundaries(clipped, "sym", extent=extent)
    ext = lines[lines.cls == "data_extent"]
    # clip line x=1500 (y 0..1000) and y=1500 (x 0..1000)
    # (+0.05 m tolerance stubs where 4 outer edges meet the clip line)
    assert ext.length.sum() == pytest.approx(2000, abs=0.5)
    d = dists([shapely.Point(1400, 500)], lines)
    assert d["data_extent"][0] == pytest.approx(100)
    assert d["diff_legend"][0] == pytest.approx(400)


def test_full_pipeline_in_lonlat_uses_metres_not_degrees():
    # Build 1 km squares in UTM 54N near Hokkaido (43N), convert to lon/lat (like a real file)
    g = squares().copy()
    g["geometry"] = g.geometry.translate(500000, 4760000)
    g4326 = g.to_crs("EPSG:4326")
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    lon, lat = to_ll.transform(500000 + 900, 4760000 + 500)  # 100 m west of the X|Y boundary
    pts = pd.DataFrame({"cid": [1], "lon_o": [lon], "lat_o": [lat], "lon_r": [lon], "lat_r": [lat]})
    out = bd.compute_zone(pts, g4326, "sym", 6691, search_radius=5000)
    assert out.d_diff_legend_m_o.iloc[0] == pytest.approx(100, abs=0.5)
    assert out.d_diff_legend_geod_m_o.iloc[0] == pytest.approx(100, abs=0.5)
    assert out.legend_o.iloc[0] == "X"
    # the same separation in raw degrees would be ~0.0012 -> meaningless as metres
    lon_b, _ = to_ll.transform(500000 + 1000, 4760000 + 500)
    assert abs(lon_b - lon) < 0.01


def test_rounded_point_crossing_boundary_changes_vector_legend():
    g = squares()
    g["geometry"] = g.geometry.translate(500000, 4760000)
    g4326 = g.to_crs("EPSG:4326")
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    lo, la = to_ll.transform(500000 + 950, 4760000 + 500)
    lr, lar = to_ll.transform(500000 + 1050, 4760000 + 500)
    pts = pd.DataFrame({"cid": [7], "lon_o": [lo], "lat_o": [la], "lon_r": [lr], "lat_r": [lar]})
    out = bd.compute_zone(pts, g4326, "sym", 6691, search_radius=5000)
    assert out.legend_o.iloc[0] == "X" and out.legend_r.iloc[0] == "Y"
    assert bool(out.vector_legend_changed.iloc[0]) is True
    assert out.d_diff_legend_m_o.iloc[0] == pytest.approx(50, abs=0.5)
    assert out.d_diff_legend_m_r.iloc[0] == pytest.approx(50, abs=0.5)


def test_long_lonlat_edge_matches_ellipsoidal_distance():
    """Two units split along the meridian 139.5E. Distance from (139.49E, 35.5N) to the
    split must equal the ellipsoidal distance along the parallel (known value)."""
    from pyproj import Geod
    g = gpd.GeoDataFrame({"sym": ["A", "B"]}, geometry=[box(139.0, 35.0, 139.5, 36.0), box(139.5, 35.0, 140.0, 36.0)], crs="EPSG:4326")
    pts = pd.DataFrame({"cid": [1], "lon_o": [139.49], "lat_o": [35.5], "lon_r": [139.49], "lat_r": [35.5]})
    out = bd.compute_zone(pts, g, "sym", 6691, search_radius=20000)
    expected = Geod(ellps="GRS80").inv(139.49, 35.5, 139.5, 35.5)[2]   # ~907.29 m
    assert out.d_diff_legend_geod_m_o.iloc[0] == pytest.approx(expected, abs=0.5)
    assert out.d_diff_legend_m_o.iloc[0] == pytest.approx(expected, rel=1e-3)  # UTM scale error < 0.1 %
