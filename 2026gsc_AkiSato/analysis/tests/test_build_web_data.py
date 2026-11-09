import json

import build_web_data as b


def test_build_reproduces_readme_numbers(tmp_path):
    b.main(["--out", str(tmp_path), "--gsj", str(tmp_path / "none.csv"), "--boundary", str(tmp_path / "none.csv")])
    s = json.loads((tmp_path / "site_summary.json").read_text())
    jp, us = s["macrostrat"]["JP"], s["macrostrat"]["US"]
    assert (jp["poly_changed"], jp["both_matched"]) == (15, 3862)
    assert (us["poly_changed"], us["both_matched"]) == (1965, 52759)
    assert jp["changed_unique_orig_coords"] == 11
    assert s["gsj"]["status"] == "not_analyzed"
    assert s["boundary"]["status"] == "not_analyzed"
    recs = json.loads((tmp_path / "collections_jp.json").read_text())
    assert len(recs) == 4766
    assert sum(r["ms"]["status"] == "changed" for r in recs) == 15
    assert all(r["gsj"] is None and r["bd"] is None for r in recs)
    row = {r["label"]: r for r in s["rounding_widths_coordinate_only"]}
    assert row["1分角丸め"]["new_pairs_vs_original"] == 15464  # README 4.2 value
    assert row["元座標"]["coords_with_2plus"] == 498            # README 4.1 value


def test_gsj_and_boundary_inputs_are_merged(tmp_path):
    """Synthetic files in tmp only (never published) to exercise the 'analyzed' code path."""
    import pandas as pd
    gsj = pd.DataFrame({
        "cid": [129652, 1315], "lat": [36.157001, 33.5], "lon": [138.490005, 131.0],
        "original_status": ["ok", "ok"], "rounded_status": ["ok", "no_legend"],
        "original_symbol": ["A", "B"], "rounded_symbol": ["C", None],
        "original_formationAge_ja": ["x", "y"], "rounded_formationAge_ja": ["z", None],
        "comparable": [True, False], "symbol_changed": [True, None], "age_label_changed": [True, None]})
    gsj.to_csv(tmp_path / "gsj.csv", index=False)
    bd = pd.DataFrame({"cid": [129652, 1315], "d_diff_legend_m_o": [50.0, 3000.0], "d_diff_legend_m_r": [10.0, 2900.0],
                       "legend_o": ["A", "B"], "legend_r": ["C", "B"], "vector_legend_changed": [True, False]})
    bd.to_csv(tmp_path / "bd.csv", index=False)
    out = tmp_path / "out"
    b.main(["--out", str(out), "--gsj", str(tmp_path / "gsj.csv"), "--boundary", str(tmp_path / "bd.csv")])
    s = json.loads((out / "site_summary.json").read_text())
    assert s["gsj"]["status"] == "analyzed" and s["gsj"]["comparable"] == 1 and s["gsj"]["symbol_changed"] == 1
    assert s["gsj"]["is_full_population"] is False
    assert s["boundary"]["status"] == "analyzed"
    t = {r["bin"]: r for r in s["boundary"]["tables"]["gsj_vector_legend_change"]}
    assert t["0–100 m"]["changed"] == 1 and t["2000–5000 m"]["n"] == 1
    recs = {r["cid"]: r for r in json.loads((out / "collections_jp.json").read_text())}
    assert recs[129652]["gsj"]["symbol_changed"] is True
    assert recs[129652]["bd"]["d_diff_legend_m_o"] == 50.0
    assert recs[4871]["gsj"] is None
