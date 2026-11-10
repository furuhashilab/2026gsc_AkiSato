// build.mjs — 依存パッケージなし。data/ の実測値だけを読んで docs/index.html を生成する。
// ダミー値は一切埋めない。未実行の工程は「未実行」として描画する。

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (p) => JSON.parse(readFileSync(join("data", p), "utf8"));
const summary = read("summary_macrostrat.json");
const changed = read("jp_changed.json");

const JP = summary.JP;
const US = summary.US;

/* ---------- GSJ の状態は実際のプローブ記録からだけ作る ---------- */
// プローブが成功していなければ、このページに GSJ の数値は一切入らない。
let probe = null;
try {
  probe = JSON.parse(readFileSync("research/gsj/probe/gsj_probe_raw.json", "utf8"));
} catch {
  probe = null;
}
const gsjVerified = probe?.passed === true;

const csvRows = (p) =>
  readFileSync(join("data", p), "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1);
const real15 = csvRows("macrostrat_changed_real15.csv");
const real4766 = csvRows("jp_real_4766.csv");
const uniq = (rows) => new Set(rows.map((l) => l.split(",").slice(1, 3).join(","))).size;

const BUILT_AT = new Date().toISOString().slice(0, 10);

/* ---------- 検算ヘルパ：比率は必ず分子と分母から導く ---------- */
const count = (pct, n) => Math.round((pct / 100) * n);
const pct = (k, n) => (k / n) * 100;

function wilson(k, n) {
  const z = 1.959963985, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [(c - h) * 100, (c + h) * 100];
}

const stat = (R) => {
  const both = R["arcmin1.0_n_both_matched"];
  const k = count(R["arcmin1.0_poly_change_pct"], both);
  const kAge = count(R["arcmin1.0_age_change_pct"], both);
  const [lo, hi] = wilson(k, both);
  return { ...R, both, k, kAge, lo, hi, rate: pct(k, both) };
};
const jp = stat(JP), us = stat(US);

// 日本の未マッチ件数は per-collection CSV で直接数えた確定値を使う
const JP_UNMATCHED = 858;
const US_UNMATCHED = 1946;
const JP_SITES = new Set(changed.map((r) => `${r.lon},${r.lat}`)).size;

const fit_o = changed.filter((r) => r.fit_o).length;
const fit_r = changed.filter((r) => r.fit_r).length;

/* ---------- 深部時間トラック（地質学のレンジチャートを借用） ---------- */
const MA_MAX = 460, X0 = 6, X1 = 454;
const xOf = (ma) => X0 + ((MA_MAX - ma) / MA_MAX) * (X1 - X0);

function bar(b, t, y, cls) {
  const x1 = xOf(b), x2 = xOf(t);
  const w = Math.max(1.6, x2 - x1);
  return `<rect class="${cls}" x="${x1.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="6" rx="1"/>`;
}

function track(r) {
  const g = [];
  for (let ma = 0; ma <= 400; ma += 100) {
    const x = xOf(ma).toFixed(1);
    g.push(`<line class="grid" x1="${x}" y1="1" x2="${x}" y2="31"/>`);
  }
  g.push(bar(r.fossil_early, r.fossil_late, 2, "b-fossil"));
  g.push(bar(r.age_b_o, r.age_t_o, 12, "b-orig"));
  g.push(bar(r.age_b_r, r.age_t_r, 22, "b-round"));
  return `<svg class="track" viewBox="0 0 460 32" role="img" aria-label="化石年代・元座標ポリゴン年代・丸め後ポリゴン年代の範囲">${g.join("")}</svg>`;
}

const axis = (() => {
  const t = [];
  for (let ma = 0; ma <= 400; ma += 100) {
    const x = xOf(ma).toFixed(1);
    t.push(`<line class="grid" x1="${x}" y1="10" x2="${x}" y2="14"/>`);
    t.push(`<text class="axis" x="${x}" y="8" text-anchor="middle">${ma}</text>`);
  }
  return `<svg class="track axisrow" viewBox="0 0 460 16" aria-hidden="true">${t.join("")}</svg>`;
})();

const fmt = (n, d = 0) => n.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });

const rows = changed
  .map((r) => {
    const flip = r.fit_o === r.fit_r ? "" : r.fit_r ? "gain" : "loss";
    return `<tr>
  <td class="num">${r.collection_no}</td>
  <td class="coord">${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}<br><span class="sub">→ ${r.rlat.toFixed(4)}, ${r.rlon.toFixed(4)}</span></td>
  <td class="unit">${r.name_o}<br><span class="sub arrow">${r.name_r}</span></td>
  <td class="trackcell">${track(r)}</td>
  <td class="num">${fmt(Math.abs(r.age_b_o - r.age_b_r), 1)}</td>
  <td class="fit ${flip}">${r.fit_o ? "含む" : "外れ"} → ${r.fit_r ? "含む" : "外れ"}</td>
</tr>`;
  })
  .join("\n");

/* ---------- 粒度の対比 ---------- */
const granMax = Math.max(jp.median_poly_area_km2, us.median_poly_area_km2);
const gran = [
  ["日本", jp.median_poly_area_km2, jp.n_polygons],
  ["米国本土", us.median_poly_area_km2, us.n_polygons],
]
  .map(
    ([label, v, n]) => `<div class="granrow">
  <div class="granlabel">${label}</div>
  <div class="granbar"><span style="width:${(v / granMax) * 100}%"></span></div>
  <div class="granval">${fmt(v, 0)} km²<span class="sub"> / ${fmt(n)} ポリゴン</span></div>
</div>`
  )
  .join("\n");

const CSS = `
:root{
  color-scheme: light;
  --paper:#edf0f2; --panel:#f7f9fa; --ink:#16202a; --muted:#5a6872;
  --rule:#c3ccd2; --hair:#dbe2e6;
  --orig:#1f5673; --round:#a8780c; --fossil:#2c3a44; --pend:#8a949b;
  --gain:#2f6b4f; --loss:#8d3a2e;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme: dark;
    --paper:#11171c; --panel:#171f26; --ink:#e2e8ec; --muted:#93a1ab;
    --rule:#2b3942; --hair:#222c34;
    --orig:#64a8ca; --round:#dcb14e; --fossil:#b9c6ce; --pend:#6c7a84;
    --gain:#6fb48e; --loss:#d08575;
  }
}
:root[data-theme="dark"]{
  color-scheme: dark;
  --paper:#11171c; --panel:#171f26; --ink:#e2e8ec; --muted:#93a1ab;
  --rule:#2b3942; --hair:#222c34;
  --orig:#64a8ca; --round:#dcb14e; --fossil:#b9c6ce; --pend:#6c7a84;
  --gain:#6fb48e; --loss:#d08575;
}
*{box-sizing:border-box}
:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
html{-webkit-text-size-adjust:100%;scroll-padding-top:env(safe-area-inset-top,0px)}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:"IBM Plex Sans JP","Hiragino Sans","Noto Sans JP",system-ui,sans-serif;
  font-size:16px; line-height:1.75; font-feature-settings:"palt";
}
.num,.coord,.granval,td.fit,.tnum{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:62rem;margin:0 auto;padding:0 1.5rem}
a{color:var(--orig)}
a:focus-visible,button:focus-visible{outline:2px solid var(--orig);outline-offset:2px}

header.mast{border-bottom:2px solid var(--ink);padding:3.5rem 0 1.5rem}
h1{font-size:clamp(1.6rem,4.2vw,2.4rem);line-height:1.3;font-weight:600;margin:0 0 .6rem;letter-spacing:-.01em;max-width:30ch}
.scope{margin:0 0 1.6rem;max-width:56ch;color:var(--muted)}
.prov{font-size:.8rem;color:var(--muted);line-height:2;border-top:1px solid var(--hair);padding-top:.9rem}
.prov b{font-weight:500;color:var(--ink)}

h2{font-size:1.15rem;font-weight:600;margin:3.5rem 0 .4rem;padding-bottom:.4rem;border-bottom:1px solid var(--rule)}
h2 .n{color:var(--muted);font-weight:400;margin-right:.6rem}
.lede{margin:.9rem 0 1.6rem;max-width:62ch}
p{max-width:62ch}

/* 検証台帳 */
.ledger{list-style:none;margin:1.5rem 0 0;padding:0;border-top:1px solid var(--hair)}
.ledger li{display:grid;grid-template-columns:5.5rem 1fr;gap:1rem;padding:.85rem 0;border-bottom:1px solid var(--hair);align-items:baseline}
.mark{font-size:.72rem;letter-spacing:.04em;padding:.1rem .45rem;border:1px solid currentColor;border-radius:2px;text-align:center}
.mark.ok{color:var(--gain)}
.mark.pend{color:var(--pend);background:repeating-linear-gradient(135deg,transparent,transparent 3px,color-mix(in srgb,var(--pend) 16%,transparent) 3px,color-mix(in srgb,var(--pend) 16%,transparent) 6px)}
.mark.no{color:var(--loss)}
.ledger .what{margin:0}
.ledger .why{display:block;color:var(--muted);font-size:.86rem;line-height:1.6}

table{width:100%;border-collapse:collapse;font-size:.9rem}
th{text-align:left;font-weight:500;color:var(--muted);font-size:.8rem;border-bottom:1px solid var(--rule);padding:.5rem .7rem .5rem 0;vertical-align:bottom}
td{padding:.6rem .7rem .6rem 0;border-bottom:1px solid var(--hair);vertical-align:top}
td.num,th.num{text-align:right;padding-right:0}
.sub{color:var(--muted);font-size:.82em}
.arrow::before{content:"→ ";color:var(--round)}
.scroll{overflow-x:auto;margin:1.5rem 0 0}
.scroll table{min-width:46rem}

/* 二地域の照合台帳 */
.cmp td.v{text-align:right;font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.cmp tr.key td{font-weight:600;border-bottom-width:2px;border-bottom-color:var(--rule)}
.ci{display:block;font-size:.76rem;color:var(--muted);font-weight:400}

/* 粒度 */
.granrow{display:grid;grid-template-columns:5rem 1fr auto;gap:1rem;align-items:center;padding:.55rem 0}
.granbar{height:14px;background:var(--hair)}
.granbar span{display:block;height:100%;background:var(--orig)}
.granval{font-size:.85rem;white-space:nowrap}

/* 深部時間トラック */
.track{width:100%;height:auto;display:block}
.axisrow{margin-bottom:-.3rem}
.trackcell{min-width:17rem;padding-right:0}
.grid{stroke:var(--hair);stroke-width:1}
.axis{fill:var(--muted);font-size:7px;font-family:"IBM Plex Mono",monospace}
.b-fossil{fill:var(--fossil)}
.b-orig{fill:var(--orig)}
.b-round{fill:var(--round)}
.key{display:flex;flex-wrap:wrap;gap:1.2rem;font-size:.82rem;color:var(--muted);margin:1.2rem 0 0}
.key i{display:inline-block;width:1.4rem;height:.5rem;margin-right:.4rem;vertical-align:.08em}
td.fit{font-size:.8rem;white-space:nowrap}
td.fit.gain{color:var(--gain)}
td.fit.loss{color:var(--loss)}

.note{background:var(--panel);border-left:3px solid var(--rule);padding:1rem 1.2rem;margin:1.6rem 0;font-size:.9rem}
.note p{margin:.4rem 0;max-width:60ch}
.note p:first-child{margin-top:0}
.note p:last-child{margin-bottom:0}
.pending{border-left-color:var(--pend);background:repeating-linear-gradient(135deg,var(--panel),var(--panel) 7px,color-mix(in srgb,var(--pend) 7%,var(--panel)) 7px,color-mix(in srgb,var(--pend) 7%,var(--panel)) 14px)}

footer{margin-top:4rem;border-top:2px solid var(--ink);padding:1.5rem 0 4rem;font-size:.82rem;color:var(--muted)}
footer p{max-width:70ch;margin:.5rem 0}

@media (max-width:640px){
  body{font-size:15px}
  .ledger li{grid-template-columns:1fr;gap:.3rem}
  .granrow{grid-template-columns:4rem 1fr;row-gap:.2rem}
  .granval{grid-column:1/-1;text-align:right}
}
`;

const HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>化石産出座標の空間感度監査 — Macrostrat 日米比較</title>
<meta name="description" content="PBDB化石コレクションを地質図へ照合する際の、1分角の座標量子化に対する感度を日本と米国本土で比較した再現性監査。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;600&display=swap">
<style>${CSS}</style>
</head>
<body>

<header class="mast">
  <div class="wrap">
    <h1>化石産出座標の空間感度監査</h1>
    <p class="scope">同じ化石コレクションを、座標を1分角に丸めた前後で地質図に照合し、地質単元の判定がどれだけ変わるかを日本と米国本土で比較した記録。新発見の報告ではなく、公開データの再現性と空間感度の点検である。</p>
    <div class="prov">
      <b>化石データ</b> Paleobiology Database（Ye &amp; Peters 2023 の Dryad 補遺 doi:10.5061/dryad.vhhmgqnxt、2022年11月版）<br>
      <b>地質図</b> 同補遺に含まれる Macrostrat「small」スケール地質図（2022年7月時点のスナップショット）<br>
      <b>照合</b> GeoPandas による点内判定（within）／<b>ビルド</b> ${BUILT_AT}<br>
      <b>GSJシームレス地質図V2</b> ${gsjVerified ? "検証済み" : "未検証 — APIへの実通信に失敗（第6節）"}
    </div>
  </div>
</header>

<main class="wrap">
<p style="margin:18px 0;padding:14px;border:1px solid var(--rule);background:var(--panel)"><a href="explorer.html"><strong>日本で地質分類が変わった15件を地図で調べる →</strong></a><br>元座標と1分角丸め後の点を地図で比較し、PBDBコレクション番号で検索できます。GSJの未取得結果は表示しません。</p>

<h2><span class="n">1</span>検証の状態</h2>
<p class="lede">この監査で確定している事項と、まだ実行していない事項を分けて記録する。未実行の工程に推定値は置かない。</p>
<ul class="ledger">
  <li><span class="mark ok">確定</span><p class="what">Macrostrat 2022年スナップショットにおける日米の量子化感度の比較<span class="why">per-collection CSV から分子・分母とも再集計可能。本ページの数値はすべてそこから導出している。</span></p></li>
  <li><span class="mark ok">確定</span><p class="what">日本で判定が変化した15件の個別内訳<span class="why">15件は11地点に由来する。1地点に5件が集中しているため、独立事象として15と数えてはならない。</span></p></li>
  <li><span class="mark ${gsjVerified ? "ok" : "no"}">${gsjVerified ? "確定" : "未検証"}</span><p class="what">GSJ 20万分の1シームレス地質図V2 への照合<span class="why">入力データと取得コードは整備済み、オフライン検算テストも通過。ただしAPIへの実通信に失敗しているため、GSJの数値は一切保持していない。第6節を参照。</span></p></li>
  <li><span class="mark pend">未実行</span><p class="what">地質境界までの距離の算出<span class="why">ポリゴン境界形状を用いた計算。計算負荷の都合により実行待ち。</span></p></li>
  <li><span class="mark no">不採用</span><p class="what">「日本では年代判定のずれがより深刻」という主張<span class="why">観測数が11地点にとどまり、支持できない。仮説として保留する。</span></p></li>
</ul>

<h2><span class="n">2</span>日本と米国本土の比較</h2>
<p class="lede">各コレクションの座標を1分角（緯度で約1.85 km）の格子に丸め、丸める前後で同じ地質ポリゴンに入るかを調べた。比率の分母は、元座標と丸め後座標の<strong>両方</strong>がポリゴンに入った件数である。</p>
<div class="scroll">
<table class="cmp">
<thead><tr><th>項目</th><th class="v" style="text-align:right">日本</th><th class="v" style="text-align:right">米国本土</th></tr></thead>
<tbody>
  <tr><td>抽出範囲内のコレクション</td><td class="v">${fmt(jp.n_collections)}</td><td class="v">${fmt(us.n_collections)}</td></tr>
  <tr><td>元座標でポリゴンに入らなかった件数</td><td class="v">${fmt(JP_UNMATCHED)}<span class="ci">${pct(JP_UNMATCHED, jp.n_collections).toFixed(1)}%</span></td><td class="v">${fmt(US_UNMATCHED)}<span class="ci">${pct(US_UNMATCHED, us.n_collections).toFixed(1)}%</span></td></tr>
  <tr><td>両方がポリゴンに入った件数（分母）</td><td class="v">${fmt(jp.both)}</td><td class="v">${fmt(us.both)}</td></tr>
  <tr class="key"><td>地質ポリゴンが変わった件数</td><td class="v">${fmt(jp.k)} / ${fmt(jp.both)} = ${jp.rate.toFixed(2)}%<span class="ci">95%信頼区間 ${jp.lo.toFixed(2)}–${jp.hi.toFixed(2)}%</span></td><td class="v">${fmt(us.k)} / ${fmt(us.both)} = ${us.rate.toFixed(2)}%<span class="ci">95%信頼区間 ${us.lo.toFixed(2)}–${us.hi.toFixed(2)}%</span></td></tr>
  <tr><td>年代区間の端点が変わった件数</td><td class="v">${fmt(jp.kAge)}<span class="ci">${pct(jp.kAge, jp.both).toFixed(2)}%</span></td><td class="v">${fmt(us.kAge)}<span class="ci">${pct(us.kAge, us.both).toFixed(2)}%</span></td></tr>
  <tr><td>変化した件のユニーク地点数</td><td class="v">${JP_SITES}</td><td class="v">未集計</td></tr>
</tbody>
</table>
</div>

<div class="note">
  <p>日本の変化率が低いことは、日本の地質が座標のずれに強いことを意味しない。下の粒度を見ると、この地質図では日本の判定がそもそも粗いことがわかる。どちらの解釈が正しいかは、この比較だけでは決まらない。</p>
</div>

<h2><span class="n">3</span>照合に使った地質図の粒度</h2>
<p class="lede">同一ファイル内で、抽出範囲に含まれるポリゴンの面積中央値を比べた。</p>
${gran}
<p class="lede" style="margin-top:1.4rem">比は約 ${(jp.median_poly_area_km2 / us.median_poly_area_km2).toFixed(1)} 倍。Macrostrat 自身の資料には、より大きな地図縮尺において東アジア（日本を含む）で地理的な空白が大きいと記載がある。本測定はその記述と整合する。ただし、これは本抽出データの面積中央値の比較であり、日本の地質図一般についての評価ではない。</p>

<h2><span class="n">4</span>日本で判定が変わった15件</h2>
<p class="lede">各行の帯は深部時間の範囲を表す。上段が化石の推定年代、中段が元座標のポリゴン年代、下段が丸め後のポリゴン年代。帯が縦にそろっていなければ、化石の年代と地質図の年代が食い違っている。</p>
<div class="scroll">
<table>
<thead><tr>
  <th class="num">記録番号</th><th>座標（緯度, 経度）</th><th>地質単元</th>
  <th style="min-width:17rem">年代範囲（Ma、左が古い）${axis}</th>
  <th class="num">年代差<br><span class="sub">Ma</span></th><th>化石年代の収まり</th>
</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<div class="key">
  <span><i style="background:var(--fossil)"></i>化石の推定年代</span>
  <span><i style="background:var(--orig)"></i>元座標のポリゴン年代</span>
  <span><i style="background:var(--round)"></i>丸め後のポリゴン年代</span>
</div>

<div class="note">
  <p>15件のうち、化石の推定年代がポリゴンの年代範囲に収まっていたのは、元座標で ${fit_o} 件、丸め後で ${fit_r} 件だった。丸めたほうが見かけ上の整合が増えている。</p>
  <p>これは丸めが有益だという意味ではない。この縮尺の地質図では、ポリゴンの年代区分が広すぎて化石年代との整合を判定する力が足りない、と読むのが妥当である。より細かい地質図で確かめるまで、どちらの向きの結論も出せない。</p>
</div>

<h2><span class="n">5</span>この監査で言えないこと</h2>
<ul>
  <li>元座標が正しいという保証はない。ここで測ったのは正確さではなく、座標処理に対する判定の<strong>感度</strong>である。</li>
  <li>日本側の観測は15件・11地点にとどまる。比率の信頼区間は ${jp.lo.toFixed(2)}–${jp.hi.toFixed(2)}% と広い。</li>
  <li>低い変化率の原因が地質図の粗さであるとは、まだ実証していない。有力な仮説の段階にある。</li>
  <li>ポリゴン年代の差（最大で約 ${fmt(jp["arcmin1.0_age_shift_median_Ma"], 0)} Ma）は、化石の推定年代がその分ずれるという意味ではない。</li>
  <li>本照合は点内判定のみで、Ye &amp; Peters (2023) の年代条件や近傍探索を含む照合方法とは異なる。未マッチ件数を直接比較することはできない。</li>
  <li>Macrostrat は 2022年以降も更新されている。本ページのスナップショットを現在の Macrostrat と混同してはならない。</li>
</ul>

<h2><span class="n">6</span>GSJシームレス地質図V2 — 未検証</h2>
<p class="lede">GSJ側の照合は、入力データと取得コードを用意し、オフラインの検算テストを通した段階にある。APIへの実通信は成功していない。<strong>したがって本ページにGSJの数値はひとつも存在しない。</strong></p>

<div class="scroll">
<table class="cmp">
<thead><tr><th>工程</th><th class="v" style="text-align:right">状態</th></tr></thead>
<tbody>
  <tr><td>入力：Macrostratで変化した実在コレクション</td><td class="v">${real15.length} 件 / ${uniq(real15)} 地点<span class="ci">PBDB collection_no 照合済み</span></td></tr>
  <tr><td>入力：日本の母集団</td><td class="v">${fmt(real4766.length)} 件 / ${fmt(uniq(real4766))} 座標<span class="ci">本ページの解析対象と同一集合</span></td></tr>
  <tr><td>オフライン検算テスト</td><td class="v">6 件すべて通過</td></tr>
  <tr class="key"><td>GSJ APIへの実通信</td><td class="v">失敗<span class="ci">${probe ? probe.probe_utc.slice(0, 19).replace("T", " ") + " UTC" : "記録なし"}</span></td></tr>
  <tr><td>凡例変更率・年代表記変更率</td><td class="v">未取得</td></tr>
  <tr><td>地質境界までの距離</td><td class="v">未計算<span class="ci">ベクタ形状が必要</span></td></tr>
</tbody>
</table>
</div>

${
  probe
    ? `<div class="note pending">
  <p><strong>通信の記録。</strong>公式ドキュメントの例（${probe.samples[0].lat}, ${probe.samples[0].lng}）に対して期待される凡例記号は <code>${probe.official_example_expected_symbol}</code>。実際に得られた値は <code>${probe.official_example_observed_symbol ?? "なし"}</code>。</p>
  <p>3地点すべてで同じ障害が出ている。記録された内容:</p>
  <p><code>${probe.samples[0].status}: ${(probe.samples[0].error ?? "").replace(/</g, "&lt;")}</code></p>
  <p>ホスト名が解決できていない。実行環境から当該ドメインへ到達できないことによる失敗であり、GSJ側の応答内容についてはこの記録から何も言えない。生ログは <code>research/gsj/probe/gsj_probe_raw.json</code> にある。</p>
</div>`
    : ""
}

<div class="note">
  <p>取得コードは通信に失敗した点を <code>unknown</code> として記録し、「変化しなかった」とは扱わない。正常な応答以外はキャッシュにも書き込まない。</p>
  <p>以前に作成された <code>gsj_pilot_11</code>（コレクション番号が <code>p1</code>〜<code>p11</code>、全地点で同一の凡例記号）は実測値として棄却済み。本ページはその値を参照していない。監査記録は <code>research/gsj/rejected_pilot_11_audit.json</code> にある。「GSJでは変化が0件だった」という記述も成り立たない。</p>
</div>

<h2><span class="n">7</span>GSJの結果を載せるときの条件</h2>
<p class="lede">取得が成功した場合でも、次の区別を守らないかぎり数値を本ページに載せない。</p>
<ul>
  <li>凡例記号（<code>symbol</code>）の変化は、個別ポリゴンの変化ではない。同じ凡例の別ポリゴンへ移っても検出されない。</li>
  <li>年代表記（<code>formationAge_ja</code>）の変化は文字列の変化であり、化石年代との整合が反転したことを意味しない。</li>
  <li>上の15件はMacrostratで変化したものだけを選んだ条件付き標本である。その変化率を日本全体の率として書かない。</li>
  <li>全国の率は4,766件のうち<strong>両方の座標で取得に成功した件数</strong>を分母とし、未取得件数を併記する。</li>
</ul>

</main>

<footer class="wrap">
  <p>化石データおよび Macrostrat 地質図は Ye &amp; Peters (2023), <i>Paleobiology</i> 49(3) の Dryad 補遺（doi:10.5061/dryad.vhhmgqnxt）による。Macrostrat は CC BY 4.0 で提供されている。</p>
  <p>本ページの数値は <code>data/out_JP_arcmin1.0.csv</code> および <code>data/summary_macrostrat.json</code> から生成している。生成手順は <code>scripts/quant_macrostrat.py</code> と <code>build.mjs</code> を参照。</p>
  <p>学部卒業研究の中間記録。査読を経ていない。</p>
</footer>

</body>
</html>
`;

mkdirSync("docs/data", { recursive: true });
writeFileSync("docs/index.html", HTML);
writeFileSync("docs/.nojekyll", "");
for (const f of readdirSync("data")) copyFileSync(join("data", f), join("docs/data", f));

console.log(`docs/index.html を生成しました（${(HTML.length / 1024).toFixed(0)} KB）`);
console.log(`  日本  ${jp.k} / ${jp.both} = ${jp.rate.toFixed(3)}%  （${JP_SITES} 地点）`);
console.log(`  米国  ${us.k} / ${us.both} = ${us.rate.toFixed(3)}%`);
console.log(`  data/ の ${readdirSync("data").length} ファイルを docs/data へ複製`);
