import type { BinRow, SiteSummary } from '../data';
import { dataUrl, fmt, pct } from '../data';
import { HBarChart, NotAnalyzed, Section, Source, StackedBars } from '../components/common';

const DL_LABEL: Record<string, string> = {
  'jp_macrostrat_per_collection.csv': '日本 4,766件：コレクション別の Macrostrat 照合結果（移動距離・状態列つき）',
  'jp_macrostrat_changed_15.csv': '日本：Macrostrat でポリゴンが変わった15件',
  'out_JP_arcmin1.0.csv': '元の結果CSV（日本・共有されたまま）',
  'out_US_arcmin1.0.csv': '元の結果CSV（米国本土・共有されたまま、約13MB）',
  'summary_macrostrat.json': '元の集計JSON（共有されたまま）',
  'gsj_per_collection.csv': 'GSJ API 取得結果（コレクション別）',
  'boundary_distances.csv': '地質境界までの距離（コレクション別）',
};

export default function Results({ s }: { s: SiteSummary }) {
  const jp = s.macrostrat.JP, us = s.macrostrat.US;
  const g = s.gsj;
  return (
    <div className="page">
      <Section title="1. Macrostrat と GSJ の変更率" lead="同じ日本の化石記録・同じ1分角丸めで、地質図だけを替えたときの比較です。比べるのは「それぞれの地図の中で丸め前後に結果が変わった割合」で、凡例コード同士を直接比べることはしません。">
        <div className="table-scroll">
          <table className="num">
            <thead><tr><th>地質図</th><th>比較できた件数（分母）</th><th>変わった件数</th><th>変更率</th><th className="text">何が変わったか</th></tr></thead>
            <tbody>
              <tr><td>Macrostrat（日本）</td><td>{fmt(jp.both_matched)}</td><td>{fmt(jp.poly_changed)}</td><td>{pct(jp.poly_change_pct)}</td><td className="text">含まれるポリゴン（legend_id も同じ15件で変化）</td></tr>
              <tr><td>Macrostrat（米国本土・参考）</td><td>{fmt(us.both_matched)}</td><td>{fmt(us.poly_changed)}</td><td>{pct(us.poly_change_pct)}</td><td className="text">含まれるポリゴン（legend_id の変化は {fmt(us.legend_changed)}件）</td></tr>
              {g.status === 'analyzed' ? (
                <>
                  <tr><td>GSJ V2（日本）凡例</td><td>{fmt(g.comparable)}</td><td>{fmt(g.symbol_changed)}</td><td>{pct(g.symbol_change_pct)}</td><td className="text">凡例記号 symbol{g.is_full_population ? '' : `（${fmt(g.n_collections_queried)}件のサンプル）`}</td></tr>
                  <tr><td>GSJ V2（日本）形成時代</td><td>{fmt(g.age_label_comparable)}</td><td>{fmt(g.age_label_changed)}</td><td>{pct(g.age_label_change_pct)}</td><td className="text">formationAge_ja の文字列（Maの差ではない）</td></tr>
                </>
              ) : (
                <tr><td>GSJ V2（日本）</td><td colSpan={4}><NotAnalyzed>{g.message}</NotAnalyzed></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <HBarChart
          ariaLabel="地質図ごとの1分角丸めによる変更率"
          max={4}
          rows={[
            { label: 'Macrostrat 日本', value: jp.poly_change_pct, color: 'var(--series-1)', note: 'ポリゴン変更' },
            { label: 'GSJ V2 日本', value: g.status === 'analyzed' ? g.symbol_change_pct ?? null : null, color: 'var(--series-3)', note: '凡例記号の変更' },
            { label: 'Macrostrat 米国本土', value: us.poly_change_pct, color: 'var(--series-2)', note: '参考：地域が違うので地質図だけの差ではない' },
          ]}
        />
        <p className="small muted">Macrostrat の「ポリゴン変更」と GSJ の「凡例記号の変更」は同じ定義ではありません（GSJ API はポリゴンIDを返さないため）。数値を並べるときは、この違いを本文で明記します。</p>
      </Section>

      <Section title="2. 丸め幅を変えた場合の結果" lead="実測データがあるものだけを表示します。">
        <h3>(a) README 4.2 の実測値：同一座標に非重複な年代区間を持つ地点数</h3>
        <div className="table-scroll">
          <table className="num">
            <thead><tr><th>座標の扱い</th><th>地点数</th></tr></thead>
            <tbody>{s.readme.rounding_widths_4_2.rows.map((r) => <tr key={r.label}><td>{r.label}</td><td>{fmt(r.value)}</td></tr>)}</tbody>
          </table>
        </div>
        <Source>README.md 4.2（化石年代を含む元データが未収録のため、本サービスでは再計算していません）</Source>

        <h3>(b) 共有CSV（日本 4,766件）の座標から再計算した、座標の集まり方</h3>
        <div className="table-scroll">
          <table className="num">
            <thead><tr><th>座標の扱い</th><th>ユニーク座標</th><th>2件以上が重なる座標</th><th>同一座標ペア</th><th>丸めで新たに生じた同一座標ペア</th><th>移動距離 中央値</th><th>移動距離 最大</th></tr></thead>
            <tbody>
              {s.rounding_widths_coordinate_only.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td><td>{fmt(r.unique_coords)}</td><td>{fmt(r.coords_with_2plus)}</td><td>{fmt(r.same_coord_pairs)}</td>
                  <td>{fmt(r.new_pairs_vs_original)}</td><td>{fmt(r.move_median_m, 1)} m</td><td>{fmt(r.move_max_m, 1)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">1分角丸めで新たに同一座標になったペア数（15,464）は README 4.2 の値と一致しました。移動距離はGRS80楕円体上の測地線距離です。</p>
        <h3>(c) 丸め幅ごとの地質図照合の変更率</h3>
        <NotAnalyzed>Macrostrat・GSJともに、1分角以外の丸め幅での照合は実施していません（Macrostratの元ポリゴンはリポジトリに未収録）。</NotAnalyzed>
      </Section>

      <Section title="3. 地質境界までの距離と凡例変更の関係">
        {s.boundary.status === 'analyzed' && s.boundary.tables ? (
          <>
            {Object.entries(s.boundary.tables).map(([k, rows]) => (
              <BinTable key={k} title={{ macrostrat_poly_change: 'Macrostrat ポリゴン変更', gsj_api_symbol_change: 'GSJ API 凡例変更', gsj_vector_legend_change: 'GSJ ベクトル凡例変更' }[k] ?? k} rows={rows} />
            ))}
            <p className="small">距離は元座標から「異なる凡例の地質境界」までの最短距離（m）。</p>
          </>
        ) : (
          <NotAnalyzed>{s.boundary.message}</NotAnalyzed>
        )}
        <p className="small muted">計算方法：GSJのベクトルポリゴンを日本のUTM座標系（JGD2011、m単位）に変換し、隣り合うポリゴンの共有辺を「異なる凡例の境界」「同じ凡例の境界」「海岸線」「外縁」「切り出し範囲の端」に分類して、元座標と丸め後座標それぞれから線までの最短距離を求めます（analysis/boundary_distance.py）。ポリゴン内部の点からポリゴン本体までの距離は0になるため、必ず境界線までを測ります。</p>
      </Section>

      <Section title="4. 未マッチ件数とその内訳（Macrostrat）">
        <StackedBars
          ariaLabel="丸め前後の照合状態の内訳"
          segments={[
            { label: '変化なし', color: 'var(--series-1)' },
            { label: 'ポリゴン変更', color: 'var(--series-2)' },
            { label: '丸め後に照合不可', color: 'var(--series-3)' },
            { label: '丸め後に照合可', color: 'var(--series-4)' },
            { label: '前後とも照合不可', color: 'var(--neutral)' },
          ]}
          rows={[
            { label: '日本', values: [jp.both_matched - jp.poly_changed, jp.poly_changed, jp.lost, jp.gained, jp.neither] },
            { label: '米国本土', values: [us.both_matched - us.poly_changed, us.poly_changed, us.lost, us.gained, us.neither] },
          ]}
        />
        <div className="table-scroll">
          <table className="num">
            <thead><tr><th>状態</th><th>日本</th><th>米国本土</th></tr></thead>
            <tbody>
              <tr><td>前後とも照合でき、変化なし</td><td>{fmt(jp.both_matched - jp.poly_changed)}</td><td>{fmt(us.both_matched - us.poly_changed)}</td></tr>
              <tr><td>前後とも照合でき、ポリゴン変更</td><td>{fmt(jp.poly_changed)}</td><td>{fmt(us.poly_changed)}</td></tr>
              <tr><td>元座標は照合可 → 丸め後は照合不可</td><td>{fmt(jp.lost)}</td><td>{fmt(us.lost)}</td></tr>
              <tr><td>元座標は照合不可 → 丸め後は照合可</td><td>{fmt(jp.gained)}</td><td>{fmt(us.gained)}</td></tr>
              <tr><td>前後とも照合不可</td><td>{fmt(jp.neither)}</td><td>{fmt(us.neither)}</td></tr>
              <tr><th>合計</th><th>{fmt(jp.n_collections)}</th><th>{fmt(us.n_collections)}</th></tr>
              <tr><td>（再掲）元座標で照合不可 ＝ 照合可へ ＋ 前後とも不可</td><td>{fmt(jp.orig_unmatched)}</td><td>{fmt(us.orig_unmatched)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small">「照合不可」は、その座標を含むポリゴンが抽出データに無かったことを意味します（海上の座標、地質図の収録範囲外、ポリゴンの隙間など。理由別の内訳は元ポリゴンが無いため未解析）。</p>
        {g.status === 'analyzed' && (
          <>
            <h3>GSJ API の応答の内訳</h3>
            <div className="table-scroll">
              <table className="num">
                <thead><tr><th>応答</th><th>元座標</th><th>丸め後</th></tr></thead>
                <tbody>
                  {Array.from(new Set([...Object.keys(g.status_original ?? {}), ...Object.keys(g.status_rounded ?? {})])).map((k) => (
                    <tr key={k}><td>{k}</td><td>{fmt(g.status_original?.[k] ?? 0)}</td><td>{fmt(g.status_rounded?.[k] ?? 0)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section title="5. 結果CSVのダウンロード">
        <ul className="downloads">
          {s.downloads.map((f) => (
            <li key={f}><a href={dataUrl(`downloads/${f}`)} download>{f}</a> <span className="muted small">{DL_LABEL[f] ?? ''}</span></li>
          ))}
        </ul>
        <h3>入力ファイルと検証</h3>
        <ul className="small mono checks">
          {s.checks.map((c) => <li key={c}>✓ {c}</li>)}
        </ul>
        <details className="small"><summary>入力ファイルの SHA-256</summary>
          <ul className="mono">{Object.entries(s.inputs_sha256).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
        </details>
        <p className="small muted">データ生成日時：{s.generated_at}</p>
      </Section>
    </div>
  );
}

function BinTable({ title, rows }: { title: string; rows: BinRow[] }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="table-scroll">
        <table className="num">
          <thead><tr><th>境界までの距離（元座標）</th><th>件数</th><th>変わった件数</th><th>変更率</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.bin}><td>{r.bin}</td><td>{fmt(r.n)}</td><td>{fmt(r.changed)}</td><td>{pct(r.pct)}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
