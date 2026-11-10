#!/usr/bin/env python3
"""GSJ Seamless Geological Map V2 API audit: ORIGINAL and 1 arcminute ROUNDED points.

NO placeholder geological values; NO invented "0%" if fetch fails.
Pure Python 3.9+ standard library. Usage in README.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = "https://gbank.gsj.jp/seamless/v2/api/1.3.1/legend.json"
ROOT = Path(__file__).resolve().parent.parent
EXPECTED_COLS = ("collection_no", "orig_lat", "orig_lng", "round_lat", "round_lng")
PROBES = (
    ("gsj_official_example", 39.700038, 141.149898),
    ("tokyo_station", 35.6812, 139.7671),
    ("open_pacific", 25.0, 150.0),
)

def utcnow():
    return datetime.now(timezone.utc).isoformat()

def params_for(lat, lng):
    return {"point": f"{float(lat):.10f},{float(lng):.10f}", "type": "original", "z": "13"}

def make_url(lat, lng):
    return ENDPOINT + "?" + urllib.parse.urlencode(params_for(lat, lng))

def cache_path(cache_dir, lat, lng):
    payload = make_url(lat, lng)
    return Path(cache_dir) / (hashlib.sha256(payload.encode("utf-8")).hexdigest() + ".json")

def validate_gsj_response(data):
    if not isinstance(data, dict):
        return "unexpected_response"
    # Legitimate ocean/out-of-coverage responses may not identify a geologic legend.
    if isinstance(data.get("symbol"), str) and data["symbol"].strip():
        return "ok"
    if "error" in data or "message" in data:
        return "error_response"
    return "no_legend"

class ApiClient:
    def __init__(self, cache_dir, delay=.6, retries=3, timeout=20):
        self.cache_dir=Path(cache_dir)
        self.cache_dir.mkdir(parents=True,exist_ok=True)
        self.delay=delay
        self.retries=retries
        self.timeout=timeout
        self.count_network=0
        self.count_cached=0
        self.last_network=0.

    def fetch(self, lat, lng, *, force=False):
        path=cache_path(self.cache_dir,lat,lng)
        if path.is_file() and not force:
            try:
                data=json.loads(path.read_text(encoding="utf-8"))
                if data["status"] in ("ok", "no_legend"):
                    self.count_cached+=1
                    return data
            except (OSError, KeyError, json.JSONDecodeError):
                pass
        url=make_url(lat,lng)
        last_error=""
        for attempt in range(1, self.retries+1):
            if self.count_network:
                time.sleep(self.delay)
            req=urllib.request.Request(url,headers={
                "User-Agent": "FossilOverlayAuditResearch/1.0 (GSJ API research, cached, low-rate)",
                "Accept": "application/json",
            })
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as response:
                    raw=response.read(200_000)
                    http_status=response.status
                    ct=response.headers.get("content-type", "")
                self.count_network+=1
                if "json" not in ct.lower():
                    raise ValueError(f"Unexpected content type: {ct}")
                obj=json.loads(raw.decode("utf-8"))
                status=validate_gsj_response(obj)
                record={
                    "fetched_utc":utcnow(), "request_url":url, "http_status":http_status,
                    "content_type":ct, "sha256_response":hashlib.sha256(raw).hexdigest(),
                    "status":status, "response":obj
                }
                # Cache only valid responses, not any error or malformed result.
                if status in ("ok","no_legend"):
                    path.write_text(json.dumps(record,ensure_ascii=False,indent=2), encoding="utf-8")
                return record
            except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as ex:
                last_error=f"{type(ex).__name__}: {ex}"
                self.count_network+=1
                if attempt<self.retries:
                    time.sleep(min(8,2**attempt))
        return {"fetched_utc":utcnow(),"request_url":url,
                "status":"request_error","error":last_error,"response":None}

def probe(client, output_dir, *, force=False):
    outcomes=[]
    for label,lat,lng in PROBES:
        r=client.fetch(lat,lng,force=force)
        outcomes.append({"label":label,"lat":lat,"lng":lng,**r})
    # Verify the official GSJ example is not accidentally replaced by a fake fallback.
    official=outcomes[0]
    official_data = official.get("response") if isinstance(official.get("response"), dict) else {}
    official_symbol=official_data.get("symbol")
    mapped=[(x["label"], x["response"].get("symbol")) for x in outcomes
            if x["status"]=="ok" and isinstance(x.get("response"),dict)]
    signatures={(o["status"],json.dumps(o.get("response"),sort_keys=True,ensure_ascii=False))
                for o in outcomes}
    valid=(
        official["status"]=="ok"
        and official_symbol=="K12_pim_a"
        and all(o["status"] not in ("request_error","error_response","unexpected_response") for o in outcomes)
        and len(signatures)>=2
    )
    result={
        "probe_utc":utcnow(),
        "official_example_expected_symbol":"K12_pim_a",
        "official_example_observed_symbol":official_symbol,
        "passed":bool(valid),
        "samples":outcomes,
        "warning":"3 points are a sanity check, not proof that all future API results are correct."
    }
    output_dir=Path(output_dir); output_dir.mkdir(parents=True,exist_ok=True)
    (output_dir/"gsj_probe_raw.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"PROBE passed={valid}, expected=K12_pim_a, observed={official_symbol}",flush=True)
    for o in outcomes:
        response=o.get("response") if isinstance(o.get("response"), dict) else {}
        print(f"  {o['label']}: {o['status']} {response.get('symbol')} "
              f"{response.get('formationAge_ja')}",flush=True)
    return valid

def read_input(path, limit):
    with Path(path).open(encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        if not set(EXPECTED_COLS).issubset(set(reader.fieldnames or ())):
            raise ValueError(f"CSV requires {EXPECTED_COLS}; got {reader.fieldnames}")
        rows=list(reader)
    if len({r["collection_no"] for r in rows})!=len(rows):
        raise ValueError("Input contains duplicate collection_no: check dataset.")
    for r in rows:
        for f in ("orig_lat","orig_lng","round_lat","round_lng"):
            r[f]=float(r[f])
        if not (-90<=r["orig_lat"]<=90 and -180<=r["orig_lng"]<=180):
            raise ValueError(f"Invalid original coordinates {r}")
        if not (-90<=r["round_lat"]<=90 and -180<=r["round_lng"]<=180):
            raise ValueError(f"Invalid rounded coordinates {r}")
        # Accept upstream coordinates as-is; this ensures exact comparison to Macrostrat.
    return rows[:limit] if limit else rows, len(rows)

def enrich(record, prefix, result):
    response=result.get("response") if isinstance(result.get("response"),dict) else {}
    record[f"gsj_{prefix}_status"]=result["status"]
    record[f"gsj_{prefix}_symbol"]=response.get("symbol","")
    record[f"gsj_{prefix}_formationAge_ja"]=response.get("formationAge_ja","")
    record[f"gsj_{prefix}_group_ja"]=response.get("group_ja","")
    record[f"gsj_{prefix}_lithology_ja"]=response.get("lithology_ja","")
    record[f"gsj_{prefix}_request_url"]=result.get("request_url","")
    record[f"gsj_{prefix}_fetched_utc"]=result.get("fetched_utc","")

def analyze(input_path, output_dir, limit, client):
    rows, available=read_input(input_path,limit)
    if not rows: raise ValueError("No input records.")
    result_rows=[]
    for i,orig in enumerate(rows,1):
        row=dict(orig)
        a=client.fetch(row["orig_lat"],row["orig_lng"])
        b=client.fetch(row["round_lat"],row["round_lng"])
        enrich(row,"orig",a)
        enrich(row,"round",b)
        both=a["status"]=="ok" and b["status"]=="ok"
        row["gsj_comparable"] = "true" if both else "false"
        if both:
            row["gsj_symbol_changed"] = ("true" if
                a["response"]["symbol"] != b["response"]["symbol"] else "false")
            row["gsj_age_label_changed"] = ("true" if
                a["response"].get("formationAge_ja") != b["response"].get("formationAge_ja") else "false")
        else:
            # Important: UNKNOWN, not false/0.
            row["gsj_symbol_changed"]="unknown"
            row["gsj_age_label_changed"]="unknown"
        result_rows.append(row)
        if i % 20 == 0 or i==len(rows):
            print(f"processed {i}/{len(rows)} records | network requests={client.count_network} | cached={client.count_cached}",flush=True)
    out=Path(output_dir); out.mkdir(parents=True,exist_ok=True)
    fields=list(result_rows[0].keys())
    with (out/"gsj_per_collection.csv").open("w",encoding="utf-8-sig",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=fields)
        writer.writeheader();writer.writerows(result_rows)
    both=[r for r in result_rows if r["gsj_comparable"]=="true"]
    changed=[r for r in both if r["gsj_symbol_changed"]=="true"]
    err=[r for r in result_rows if r["gsj_orig_status"] in ("request_error","unexpected_response","error_response") or r["gsj_round_status"] in ("request_error","unexpected_response","error_response")]
    counters={
        "input_csv":str(input_path), "produced_utc":utcnow(),
        "n_input_available":available, "n_processed":len(rows),
        "n_both_valid_gsj_symbols":len(both),
        "n_gsj_symbol_changed":len(changed),
        "n_gsj_age_label_changed":sum(r["gsj_age_label_changed"]=="true" for r in both),
        "n_uncomparable":len(rows)-len(both), "n_request_errors":len(err),
        "n_unique_original_coordinates":len({(r["orig_lat"],r["orig_lng"]) for r in rows}),
        "n_unique_original_coordinates_with_gsj_change":len({(r["orig_lat"],r["orig_lng"]) for r in changed}),
        "denominator_for_symbol_change_rate":len(both),
        "symbol_change_rate_pct_among_comparable":round(100*len(changed)/len(both),5) if both else None,
        "network_requests_this_run":client.count_network,
        "cache_hits_this_run":client.count_cached,
        "methodology_notes":[
            "GSJ symbol transition is NOT necessarily a change of polygon ID.",
            "A GSJ formationAge_ja label change is NOT a fossil-age concordance flip.",
            "Synthetic rounding is NOT georeferencing accuracy.",
            "If input is the selected 15 Macrostrat-changed collections, its change rate is selection-biased and cannot be reported as Japan-wide GSJ rate.",
            "Full cohort comparison requires all 4,766 Japanese Macrostrat-input collections and correctly handled unmatched GSJ sites."
        ]
    }
    (out/"gsj_summary.json").write_text(json.dumps(counters,ensure_ascii=False,indent=2),encoding="utf-8")
    if len(both)<len(rows):
        print("WARNING: Some sites have no comparable GSJ symbol; do not report failures as unchanged.",file=sys.stderr)
    print("RESULT:",json.dumps({k:v for k,v in counters.items() if k.startswith("n_") or k=="symbol_change_rate_pct_among_comparable"},ensure_ascii=False),flush=True)
    return counters

def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--probe",action="store_true",help="Test 3 real API coordinates, write complete raw responses, then exit.")
    ap.add_argument("--input",default=str(ROOT/"data"/"macrostrat_changed_real15.csv"))
    ap.add_argument("--limit",type=int,default=0,help="First N real input rows; 0=all.")
    ap.add_argument("--output",default=str(ROOT/"research"/"gsj"/"results"))
    ap.add_argument("--delay",type=float,default=.6)
    ap.add_argument("--timeout",type=int,default=20)
    ap.add_argument("--retries",type=int,default=3)
    ap.add_argument("--force-probe",action="store_true")
    args=ap.parse_args(argv)
    if args.limit<0 or args.delay<0 or args.retries<1: ap.error("Invalid options.")
    out=Path(args.output)
    client=ApiClient(out/"response_cache",args.delay,args.retries,args.timeout)
    if not probe(client,out,force=args.force_probe):
        print("STOP: API probe FAILED. No study results created or updated.",file=sys.stderr)
        return 2
    if args.probe:
        return 0
    analyze(Path(args.input),out,args.limit,client)
    return 0
if __name__=="__main__":
    sys.exit(main())
