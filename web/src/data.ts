// Types and loaders for files produced by analysis/build_web_data.py

export interface MsSide {
  poly: number; legend: number; map: number; name: string | null;
  age_t: number | null; age_b: number | null; lith: string | null;
}
export type MsStatus = 'same' | 'changed' | 'lost' | 'gained' | 'neither';
export interface GsjSide { status: string | null; symbol: string | null; age_ja: string | null; group_ja: string | null }
export interface CollectionRec {
  cid: number;
  o: [number, number]; // lon, lat (original)
  r: [number, number]; // lon, lat (1-arcmin rounded)
  ko: string; kr: string; // coordinate keys
  move_m: number;
  ms: { status: MsStatus; o: MsSide | null; r: MsSide | null; legend_changed: boolean | null; age_changed: boolean | null };
  age: { max_ma: number | null; min_ma: number | null } | null;
  gsj: { o: GsjSide; r: GsjSide; comparable: boolean; symbol_changed: boolean | null; age_label_changed: boolean | null } | null;
  bd: Record<string, number | string | boolean | null> | null;
}

export interface MsMetrics {
  n_collections: number; both_matched: number; poly_changed: number; legend_changed: number;
  age_endpoint_changed: number; poly_change_pct: number; orig_unmatched: number; lost: number;
  gained: number; neither: number; lost_pct_of_all: number; age_shift_median_Ma: number;
  age_shift_p90_Ma: number; unique_orig_coords: number; unique_rounded_coords: number;
  changed_unique_orig_coords: number; changed_unique_rounded_coords: number;
}
export interface ReadmeRow { label: string; value: number; unit?: string; arcsec?: number }
export interface RoundingRow {
  label: string; arcsec: number; unique_coords: number; coords_with_2plus: number;
  same_coord_pairs: number; new_pairs_vs_original: number; move_median_m: number; move_max_m: number;
}
export interface BinRow { bin: string; n: number; changed: number; pct: number | null }
export interface SiteSummary {
  generated_at: string;
  inputs_sha256: Record<string, string>;
  checks: string[];
  macrostrat: { JP: MsMetrics; US: MsMetrics };
  readme: {
    coordinate_survey_4_1: { source: string; rows: ReadmeRow[] };
    rounding_widths_4_2: { source: string; metric: string; rows: ReadmeRow[] };
    arcmin1_pairs_4_2: { source: string; rows: ReadmeRow[] };
    coordinate_regularity_4_3: { source: string; adjusted_odds_ratio_approx: number; note: string };
    macrostrat_join_check_4_4: { source: string; rows: ReadmeRow[]; note: string };
  };
  rounding_widths_coordinate_only: RoundingRow[];
  jp_unique_coords: { collections: number; unique_orig: number; unique_rounded: number; orig_coords_with_2plus: number };
  move_m_JP: { median: number; max: number; p90: number };
  fossil_ages: 'loaded' | 'not_available';
  gsj: {
    status: 'analyzed' | 'not_analyzed'; message?: string;
    n_collections_queried?: number; is_full_population?: boolean; total_jp_collections?: number;
    comparable?: number; symbol_changed?: number; symbol_change_pct?: number | null;
    age_label_comparable?: number; age_label_changed?: number; age_label_change_pct?: number | null;
    status_original?: Record<string, number>; status_rounded?: Record<string, number>;
    changed_unique_orig_coords?: number;
  };
  boundary: {
    status: 'analyzed' | 'not_analyzed'; message?: string; n?: number;
    tables?: Record<string, BinRow[]>; median_d_diff_legend_m_o?: number | null;
  };
  downloads: string[];
}

const base = import.meta.env.BASE_URL;
export const dataUrl = (p: string) => `${base}data/${p}`;

// The single-file version (scripts/make_standalone.mjs) embeds the data files here,
// so it can be opened by double-click without a web server.
declare global { interface Window { __FOA_DATA__?: Record<string, unknown> } }
export const embedded = (name: string) => (typeof window !== 'undefined' ? window.__FOA_DATA__?.[name] : undefined);

async function getJson<T>(name: string): Promise<T> {
  const e = embedded(name);
  if (e) return e as T;
  const r = await fetch(dataUrl(name));
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}
export const loadSummary = () => getJson<SiteSummary>('site_summary.json');
export const loadCollections = () => getJson<CollectionRec[]>('collections_jp.json');

export const MS_STATUS_LABEL: Record<MsStatus, string> = {
  same: '丸め前後で同じポリゴン',
  changed: '丸め前後でポリゴンが変わった',
  lost: '元座標は照合可 → 丸め後は照合不可',
  gained: '元座標は照合不可 → 丸め後は照合可',
  neither: '丸め前後ともポリゴンなし',
};

export const fmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (n: number | null | undefined, d = 2) => (n == null ? '—' : `${fmt(n, d)}%`);
