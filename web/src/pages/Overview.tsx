import type { SiteSummary } from '../data';
import { fmt, pct } from '../data';
import { Cautions, HBarChart, NotAnalyzed, Section, Source } from '../components/common';

const REPO = 'https://github.com/furuhashilab/2026gsc_AkiSato';
const C_JP = 'var(--series-1)';
const C_US = 'var(--series-2)';

export default function Overview({ s }: { s: SiteSummary }) {
  const jp = s.macrostrat.JP, us = s.macrostrat.US;
  return (
    <div className="page">
      <section className="hero card">
        <p className="eyebrow">卒業研究 Webサービス｜Fossil Overlay Audit</p>
        <h1>化石産出記録の座標丸めは、地質図との照合結果をどれだけ変えるのか</h1>
        <p>化石の報告座標を<strong>人工的に1分角へ丸めたとき</strong>、地質図から取得される地質情報がどれだけ変わるかを、<strong>コレクションごとに</strong>確かめるためのサービスです。</p>
        <div className="hero-grid">
          <div className="stat"><span className="stat-n">{fmt(jp.poly_changed)}<small> / {fmt(jp.both_matched)}件</small></span><span className="stat-l">日本：Macrostratで対応ポリゴンが変わった（{pct(jp.poly_change_pct)}）</span></div>
          <div className="stat"><span className="stat-n">{fmt(us.poly_changed)}<small> / {fmt(us.both_matched)}件</small></span><span className="stat-l">米国本土：同じ条件（{pct(us.poly_change_pct)}）</span></div>
          <div className="stat"><span className="stat-n na">未解析</span><span className="stat-l">日本：GSJシームレス地質図V2での変化</span></div>
        </div>
        <p className="callout"><strong>調べないこと：</strong>化石の「正しい採集地点」や「誤登録率」を自動的に求めることではありません。ここでいう「変更率」は<strong>照合結果の変更率</strong>で、実際の位置誤差率や誤登録率ではありません。</p>
        <p><a className="btn" href="#/explore?filter=changed">変更があった15件を調べる →</a> <a className="btn ghost" href="#/results">実験結果の比較 →</a></p>
      </section>

      <Section title="1. なぜこの研究が必要なのか">
        <p>PBDBなどの化石データには、化石が採集されたと報告された緯度・経度や年代が登録されています。Ye & Peters（2023）は、PBDBの化石記録をMacrostratの地質図と対応付け、化石の採集状況と地表の地質記録を比較しました。</p>
        <p>ただし、<strong>化石の座標と地質図を重ねれば、必ず採集された地層が分かるわけではありません。</strong></p>
        <ul>
          <li><strong>報告座標は実際の採集地点そのものとは限らない。</strong>地名からの代表点や、丸められた座標のことがある。小数の桁数だけでは本当の位置精度は分からない。</li>
          <li><strong>地質図は、その縮尺で整理された地表付近の地質の分布図。</strong>崖・採石場・河床・工事現場・下位の層準などから採れた化石の層とは一致しないことがある。</li>
          <li><strong>地質図そのものにも限界がある。</strong>縮尺・収録範囲・境界の描き方・凡例の分類が地図ごとに違い、境界の位置にも不確かさがある。</li>
        </ul>
        <p>日本では付加体・断層・褶曲などで短い距離で地質が変わる場所があります。しかし「日本は必ず変わりやすい」「北米は変わらない」と決めつけることはできないため、<strong>実際のデータで測ります</strong>。</p>
      </Section>

      <Section title="2. 既存研究・既存ツールと、この研究の違い">
        <div className="table-scroll">
          <table>
            <thead><tr><th>既存研究・ツール</th><th>すでにできること</th><th>本研究で追加して確かめること</th></tr></thead>
            <tbody>
              <tr><td>Ye & Peters（2023）</td><td>化石記録と全球地質図の対応付けを用いた分析</td><td><strong>同じ記録の座標を丸めたとき、取得結果がどれほど変わるか</strong></td></tr>
              <tr><td>CoordinateCleaner（Zizka et al., 2019）</td><td>疑わしい位置情報の検査</td><td>地質図の種類と座標処理による照合結果の変化</td></tr>
              <tr><td>fossilbrush（Flannery-Sutherland et al., 2022）</td><td>化石の年代・層序の異常候補の検査</td><td>地質図上の地質凡例と座標処理の関係</td></tr>
              <tr><td>GSJ 日本シームレス地質図V2</td><td>指定地点の地質図・凡例を閲覧</td><td><strong>多数の化石記録を丸め前後で比較し、変更件数・条件を集計・検証</strong></td></tr>
              <tr><td>Lark et al.（2015）などのGIS研究</td><td>地質境界の不確かさを扱う</td><td>化石データと地質図の照合における位置依存性を実測</td></tr>
            </tbody>
          </table>
        </div>
        <p>この研究の差分は、<strong>同じ化石記録・同じ丸め条件で、地質図を変えたときの照合結果の感度を比べる</strong>点です。新しい地質図を作ること、座標を自動修正すること、位置の不確かさを初めて発見することは目的ではありません。類似研究が世界に存在しないと断定するものでもありません。</p>
        <p className="muted">このサービス自体の違い：GSJのビューアは「地図を見る・1地点の凡例を調べる」ためのもの。本サービスは、<strong>化石コレクションという別のデータについて、座標を変える前後・地質図を変えた場合の結果を並べて検証する</strong>ためのものです。</p>
      </Section>

      <Section title="3. 実施済みの実験と結果" lead="以下の数値は README.md に記録された実測値と、共有された結果CSVからの再集計値です。値ごとに出典を示します。">
        <h3>3.1 日本の化石コレクションの座標調査（README 4.1）</h3>
        <ReadmeTable rows={s.readme.coordinate_survey_4_1.rows} />
        <p className="small"><strong>分かったこと：</strong>同じ数値座標が、同じ年代・単一の採集層準を意味するとは限らない。<strong>まだ分からないこと：</strong>同じ露頭か、代表点への集約か、別の層準か。<strong>122地点は誤登録地点の数ではありません。</strong></p>
        <Source>README.md 4.1（元データ fossil_collections.csv はこのリポジトリに未収録のため、本サービスでは再計算していません）</Source>

        <h3>3.2 座標をさまざまな幅に丸めた（README 4.2）</h3>
        <p className="small">指標：{s.readme.rounding_widths_4_2.metric}</p>
        <ReadmeTable rows={s.readme.rounding_widths_4_2.rows} unit="地点" />
        <ReadmeTable rows={s.readme.arcmin1_pairs_4_2.rows} />
        <p className="small">丸め幅を大きくしても単調には増えません（格子への集約位置が変わるため）。<strong>3,848は誤りの件数ではなく、記録ペアの数です。</strong></p>
        <Source>README.md 4.2。なお「新たに同一座標になったペア 15,464」は、共有CSV（4,766件）の座標から本サービスでも再計算し、同じ値になることを確認しました（実験結果ページ参照）。</Source>

        <h3>3.3 座標の規則性と年代の違い（README 4.3）</h3>
        <p>規則的な緯度経度表記と、同一座標に非重複な年代区間が含まれることの関連：調整オッズ比 約{s.readme.coordinate_regularity_4_3.adjusted_odds_ratio_approx}（探索的分析）。<strong>関連を示す結果で、因果関係の証明ではありません。</strong></p>
        <Source>README.md 4.3</Source>

        <h3>3.4 Macrostratの既存の対応付け方法の点検（README 4.4）</h3>
        <ReadmeTable rows={s.readme.macrostrat_join_check_4_4.rows} />
        <p className="small">{s.readme.macrostrat_join_check_4_4.note} この点検から、<strong>正誤判定ではなく、元座標と丸め座標の単純な照合を同じ方法で比較する</strong>ことに決めました。年代を入れ替えた対照分析は、影響を十分に分けられないため主な結論には採用していません。</p>
        <Source>README.md 4.4</Source>

        <h3>3.5 Macrostratで日本と米国本土を比較（README 4.5・再集計で一致を確認）</h3>
        <HBarChart
          ariaLabel="Macrostratでの1分角丸めによる対応ポリゴン変更率 日本と米国本土"
          max={4}
          rows={[
            { label: '日本 ポリゴン変更率', value: jp.poly_change_pct, color: C_JP, note: `${jp.poly_changed} / ${jp.both_matched}件（丸め前後ともに照合できた記録が分母）` },
            { label: '米国本土 ポリゴン変更率', value: us.poly_change_pct, color: C_US, note: `${us.poly_changed} / ${us.both_matched}件` },
            { label: '日本 年代端点の変更率', value: (jp.age_endpoint_changed / jp.both_matched) * 100, color: C_JP, note: `${jp.age_endpoint_changed}件` },
            { label: '米国本土 年代端点の変更率', value: (us.age_endpoint_changed / us.both_matched) * 100, color: C_US, note: `${us.age_endpoint_changed}件` },
          ]}
        />
        <div className="table-scroll">
          <table className="num">
            <thead><tr><th>指標</th><th>日本</th><th>米国本土</th></tr></thead>
            <tbody>
              <tr><td>対象コレクション</td><td>{fmt(jp.n_collections)}</td><td>{fmt(us.n_collections)}</td></tr>
              <tr><td>元座標・丸め後ともに照合できた件数</td><td>{fmt(jp.both_matched)}</td><td>{fmt(us.both_matched)}</td></tr>
              <tr><td>対応ポリゴンが変更された件数</td><td>{fmt(jp.poly_changed)}</td><td>{fmt(us.poly_changed)}</td></tr>
              <tr><td>対応ポリゴンの変更率</td><td>{pct(jp.poly_change_pct)}</td><td>{pct(us.poly_change_pct)}</td></tr>
              <tr><td>凡例（legend_id）が変更された件数</td><td>{fmt(jp.legend_changed)}</td><td>{fmt(us.legend_changed)}</td></tr>
              <tr><td>年代区間の端点が変更された件数</td><td>{fmt(jp.age_endpoint_changed)}</td><td>{fmt(us.age_endpoint_changed)}</td></tr>
              <tr><td>元座標でポリゴンに照合できなかった件数</td><td>{fmt(jp.orig_unmatched)}</td><td>{fmt(us.orig_unmatched)}</td></tr>
              <tr><td>元座標では照合可、丸め後は照合不可</td><td>{fmt(jp.lost)}</td><td>{fmt(us.lost)}</td></tr>
              <tr><td>元座標では照合不可、丸め後は照合可</td><td>{fmt(jp.gained)}</td><td>{fmt(us.gained)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small">変更率の分母は、丸め前後ともにポリゴンと照合できたコレクションです。年代整合性の反転率ではありません。共有された結果CSVの再集計であり、元の巨大GeoJSONから空間結合を再実行した結果ではありません。抽出ポリゴン数は日本190・米国本土10,233、面積中央値は日本 約2,863 km²・米国本土 約137 km²（約21倍の差）。</p>
        <p className="small"><strong>分かったこと：</strong>同じ1分角の丸めでも、このMacrostratデータでは日米の結果に大きな差があった。<strong>まだ分からないこと：</strong>その差が地質図の粗さだけで生じたか。<strong>0.39%は「日本の地質は安全」の証拠でも、「地図が粗すぎる」の証明でもありません。</strong>日本の変更事例の年代端点差の中央値 {fmt(jp.age_shift_median_Ma, 1)} Ma は地質図側の端点の差で、化石年代の誤差や被害の大きさではありません。</p>
        <Source>research/macrostrat/out_JP_arcmin1.0.csv, out_US_arcmin1.0.csv, summary_macrostrat.json（Ye & Peters 2023 Dryad データ由来）。ビルド時に README 4.5 と summary_macrostrat.json の値と自動照合済み。</Source>
      </Section>

      <Section title="4. コレクション単位とユニーク座標単位の区別" lead="同じ座標に複数のコレクションが登録されているため、「件数」と「地点数」は一致しません。">
        <div className="table-scroll">
          <table className="num">
            <thead><tr><th>集計対象（日本・Macrostrat結果CSV）</th><th>コレクション単位</th><th>ユニーク座標単位</th></tr></thead>
            <tbody>
              <tr><td>全体</td><td>{fmt(s.jp_unique_coords.collections)}件</td><td>元座標 {fmt(s.jp_unique_coords.unique_orig)}地点／丸め後 {fmt(s.jp_unique_coords.unique_rounded)}地点</td></tr>
              <tr><td>ポリゴンが変わった記録</td><td>{fmt(jp.poly_changed)}件</td><td>元座標 {fmt(jp.changed_unique_orig_coords)}地点／丸め後 {fmt(jp.changed_unique_rounded_coords)}地点</td></tr>
              <tr><td>2件以上が同じ元座標にある地点</td><td>—</td><td>{fmt(s.jp_unique_coords.orig_coords_with_2plus)}地点</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small">変更された15コレクションは11種類の元座標に由来します。<strong>15件を15個の独立した地質境界の事例とは扱いません。</strong>なお README 4.1 の「4,770件・2,484地点」は座標調査の対象、ここでの「4,766件・2,480地点」は Macrostrat 実験の対象（quant_macrostrat.py で緯度経度の枠 122–154°E, 24–46.5°N により絞り込み）で、対象集合が4件異なります。</p>
      </Section>

      <Section title="5. まだ検証していないこと">
        <ul>
          <li><strong>GSJ日本シームレス地質図V2での丸め前後の比較：</strong><NotAnalyzed>取得スクリプト（analysis/gsj_fetch.py）は完成。開発環境からGSJ APIへ接続できなかったため、結果はまだありません。</NotAnalyzed></li>
          <li><strong>地質境界までの距離：</strong><NotAnalyzed>計算スクリプト（analysis/boundary_distance.py）と単純図形でのテストは完成。GSJのベクトルデータを使った実計算はまだです。</NotAnalyzed></li>
          <li>化石の登録年代と地質図年代の整合性が、丸めで何件反転するか（凡例の変化とは別の指標として集計予定）。</li>
          <li>日米の変更率の差が、地質図の詳細度・化石の分布・地質構造のどれによるか。</li>
          <li>同一座標の記録が同じ露頭か、代表点への集約か、別の採集層準か。</li>
        </ul>
      </Section>

      <Section title="6. 地質学上の注意（必ずお読みください）" lead="このサービスは、化石の誤登録を自動判定・修正するものではありません。">
        <Cautions />
        <h3>研究上の重要な区別</h3>
        <ul>
          <li>「地質凡例が変わった」≠「化石の登録が誤っていた」</li>
          <li>「地質図の形成年代が変わった」≠「化石年代が間違っていた」</li>
          <li>「1分角に人工的に丸めた」≠「実際に1分角の位置誤差があった」</li>
          <li>「ポリゴンが変更されなかった」≠「地質図の照合が正しいと確認できた」</li>
          <li>「今回調べた主要先行研究に同じ数値がない」≠「世界中に先行研究が存在しない」</li>
          <li>Macrostratの <code>legend_id</code> とGSJの <code>symbol</code> は別の分類体系です。<strong>異なる地質図の凡例コードを同じ地質単元として比較しません。</strong>比較するのは「それぞれの地図の中で、丸め前後に変わったかどうか」だけです。</li>
        </ul>
      </Section>

      <Section title="7. 研究の過程">
        <ol className="timeline">
          <li><strong>座標の重複調査</strong>：同一座標に年代の異なる記録があることを確認（4.1）</li>
          <li><strong>丸め幅を変える実験</strong>：丸めで記録の集まり方が変わることを確認（4.2）</li>
          <li><strong>規則的な座標表記との関連</strong>：探索的に関連を確認、因果は未確定（4.3）</li>
          <li><strong>既存の対応付けの点検</strong>：join_id を正解として使えないと判断し、単純照合の比較に方針転換（4.4）</li>
          <li><strong>Macrostrat 日米比較</strong>：変更率 0.39% と 3.72%（4.5）</li>
          <li><strong>次：</strong>同じ日本の記録・同じ丸めで、地質図だけをGSJ V2に替える（4.6）／境界距離との関係（6）</li>
        </ol>
        <p>研究の全文は <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">README.md</a> を参照してください。</p>
      </Section>
    </div>
  );
}

function ReadmeTable({ rows, unit }: { rows: { label: string; value: number; unit?: string }[]; unit?: string }) {
  return (
    <div className="table-scroll">
      <table className="num">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}><td>{r.label}</td><td>{fmt(r.value)}{r.unit ?? unit ?? ''}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
