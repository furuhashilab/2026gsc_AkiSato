import json

import pandas as pd
import requests

import gsj_fetch as gf


class FakeResp:
    def __init__(self, code, body):
        self.status_code, self.text = code, body


class FakeSession:
    def __init__(self, fn):
        self.fn, self.calls, self.headers = fn, [], {}

    def get(self, url, params=None, timeout=None):
        self.calls.append(params["point"])
        return self.fn(params["point"])


def test_parse_response_variants():
    ok = gf.parse_response(200, json.dumps({"symbol": "A1", "formationAge_ja": "白亜紀"}))
    assert ok["_status"] == "ok" and ok["symbol"] == "A1" and ok["formationAge_ja"] == "白亜紀"
    assert gf.parse_response(200, "{}")["_status"] == "no_legend"
    assert gf.parse_response(200, "<html>")["_status"] == "not_json"
    assert gf.parse_response(404, "nf")["_status"] == "http_error"


def test_request_error_is_reported_not_hidden(monkeypatch):
    def boom(point):
        raise requests.ConnectionError("blocked")
    monkeypatch.setattr(gf.time, "sleep", lambda s: None)
    rec = gf.query_gsj(FakeSession(boom), 35.0, 135.0, retries=1)
    assert rec["_status"] == "request_error" and "blocked" in rec["_error"]


def test_duplicate_coordinates_are_queried_once(tmp_path, monkeypatch):
    csv = tmp_path / "in.csv"
    pd.DataFrame({"cid": [1, 2, 3], "geometry_o": ["POINT (135.0 35.0)", "POINT (135.0 35.0)", "POINT (135.001 35.0)"]}).to_csv(csv, index=False)
    sess = FakeSession(lambda p: FakeResp(200, json.dumps({"symbol": "S" + p[:2], "formationAge_ja": "x"})))
    monkeypatch.setattr(gf.requests, "Session", lambda: sess)
    monkeypatch.setattr(gf.time, "sleep", lambda s: None)
    gf.main(["--input", str(csv), "--limit", "0", "--output", str(tmp_path / "o"), "--delay", "0"])
    # original (35,135), original (35,135.001), rounded of both = (35,135) -> 2 unique points
    assert len(sess.calls) == 2
    out = pd.read_csv(tmp_path / "o" / "per_collection.csv")
    assert out.comparable.all()
    # second run uses the cache only
    sess.calls.clear()
    gf.main(["--input", str(csv), "--limit", "0", "--output", str(tmp_path / "o"), "--delay", "0"])
    assert sess.calls == []
