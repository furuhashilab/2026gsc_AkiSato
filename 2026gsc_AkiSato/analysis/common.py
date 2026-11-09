"""Shared helpers for the Fossil Overlay Audit analysis scripts.

Rounding rule (same as research/macrostrat/quant_macrostrat.py and
research/gsj/gsj_quantization_pilot.py):
    value -> round(value / step) * step,  step = arcmin / 60 degrees
numpy's round() is "round half to even" and the grid is anchored at (0, 0).
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
RESEARCH = REPO / "research"

_POINT_RE = re.compile(r"POINT\s*\(\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\)")


def snap(values, arcmin: float = 1.0):
    """Round degrees to an arc-minute grid exactly as quant_macrostrat.py does."""
    step = arcmin / 60.0
    return np.round(np.asarray(values, dtype=float) / step) * step


def parse_point_wkt(text) -> tuple[float, float]:
    """'POINT (lon lat)' -> (lon, lat). Returns (nan, nan) for empty values."""
    if not isinstance(text, str):
        return (float("nan"), float("nan"))
    m = _POINT_RE.search(text)
    if not m:
        return (float("nan"), float("nan"))
    return float(m.group(1)), float(m.group(2))


def coord_key(lat: float, lon: float, ndigits: int = 9) -> str:
    """Stable string key for 'the same numeric coordinate'."""
    return f"{round(float(lat), ndigits):.{ndigits}f},{round(float(lon), ndigits):.{ndigits}f}"


def utm_epsg_jgd2011(lon: float) -> int:
    """JGD2011 / UTM zone EPSG code for a longitude in/around Japan.

    JGD2011 / UTM zone 51N..55N = EPSG:6688..6692 (checked with pyproj in tests).
    EPSG has no JGD2011 code for zone 56N (east of 150°E, e.g. Minamitorishima), so
    WGS 84 / UTM zone 56N (EPSG:32656) is used there; JGD2011 and WGS 84 differ by
    far less than 1 m, which is negligible for boundary distances.
    """
    zone = int(np.floor((float(lon) + 180.0) / 6.0)) + 1
    if zone == 56:
        return 32656
    if not 51 <= zone <= 55:
        raise ValueError(f"longitude {lon} is outside UTM zones 51-56 (Japan)")
    return 6688 + (zone - 51)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
