import numpy as np
import pandas as pd
import pyproj
import pytest

from common import RESEARCH, parse_point_wkt, snap, utm_epsg_jgd2011


def test_snap_one_arcmin():
    assert snap([33.380001])[0] == pytest.approx(33.38333333333333)
    assert snap([132.679993])[0] == pytest.approx(132.68333333333334)
    assert snap([35.75])[0] == pytest.approx(35.75)


def test_snap_matches_shared_macrostrat_csv():
    m = pd.read_csv(RESEARCH / "macrostrat" / "out_JP_arcmin1.0.csv")
    o = np.array([parse_point_wkt(s) for s in m.geometry_o])
    r = np.array([parse_point_wkt(s) for s in m.geometry_r])
    assert np.allclose(snap(o[:, 0]), r[:, 0], atol=1e-9)
    assert np.allclose(snap(o[:, 1]), r[:, 1], atol=1e-9)


@pytest.mark.parametrize("lon,code,name", [
    (123.0, 6688, "JGD2011 / UTM zone 51N"), (130.9, 6689, "JGD2011 / UTM zone 52N"),
    (135.0, 6690, "JGD2011 / UTM zone 53N"), (139.7, 6691, "JGD2011 / UTM zone 54N"),
    (142.0, 6691, "JGD2011 / UTM zone 54N"), (145.0, 6692, "JGD2011 / UTM zone 55N"), (153.98, 32656, "WGS 84 / UTM zone 56N")])
def test_utm_zone_codes(lon, code, name):
    assert utm_epsg_jgd2011(lon) == code
    assert pyproj.CRS.from_epsg(code).name == name
