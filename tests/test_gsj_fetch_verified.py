import csv
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("gsj_fetch_verified", ROOT / "scripts" / "gsj_fetch_verified.py")
gsj = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gsj)

class RealInputAuditTest(unittest.TestCase):
    def test_real15_and_all4766(self):
        small, available = gsj.read_input(ROOT / "data" / "macrostrat_changed_real15.csv", 0)
        large, large_total = gsj.read_input(ROOT / "data" / "jp_real_4766.csv", 0)
        self.assertEqual((len(small), available), (15, 15))
        self.assertEqual((len(large), large_total), (4766, 4766))
        self.assertEqual(sum(r["macrostrat_changed"]=="true" for r in large), 15)
        self.assertEqual(sum(r["macrostrat_both_matched"]=="true" for r in large), 3862)
        self.assertEqual(len({(r["orig_lat"],r["orig_lng"]) for r in small}), 11)
        ids={r["collection_no"] for r in large}
        self.assertTrue(all(r["collection_no"] in ids for r in small))
        self.assertTrue(all(r["collection_no"].isdigit() for r in small))
    def test_url_point_lat_lng_order(self):
        url=gsj.make_url(35.6812,139.7671)
        self.assertIn("point=35.6812000000%2C139.7671000000",url)
        self.assertIn("type=original",url)
    def test_no_invalid_data_claimed_as_no_change(self):
        result={
            "status":"request_error",
            "request_url":"https://example.invalid",
            "error":"failed",
            "response":None
        }
        row={}
        gsj.enrich(row,"orig",result)
        self.assertEqual(row["gsj_orig_status"],"request_error")
        self.assertEqual(row["gsj_orig_symbol"],"")
    def test_response_validation(self):
        self.assertEqual(gsj.validate_gsj_response({"symbol":"K12_pim_a"}),"ok")
        self.assertEqual(gsj.validate_gsj_response({"symbol":""}),"no_legend")
        self.assertEqual(gsj.validate_gsj_response("Ca-O_mscpe_hc"),"unexpected_response")
    def test_probe_detects_constant_value(self):
        class MockClient:
            def fetch(self,lat,lng,force=False):
                return {"status":"ok","response":{"symbol":"Ca-O_mscpe_hc","formationAge_ja":"同じ値"}}
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as t:
            self.assertFalse(gsj.probe(MockClient(),Path(t)))
    def test_changed15_is_not_an_all_japan_rate(self):
        all_rows,_ = gsj.read_input(ROOT/"data"/"jp_real_4766.csv",0)
        real15,_ = gsj.read_input(ROOT/"data"/"macrostrat_changed_real15.csv",0)
        self.assertLess(len(real15),len(all_rows))
        self.assertEqual(sum(r["macrostrat_changed"]=="true" for r in real15),15)

if __name__=="__main__":
    unittest.main()
