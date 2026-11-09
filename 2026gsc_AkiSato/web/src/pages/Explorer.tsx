import { useEffect, useMemo, useState } from 'react';
import type { CollectionRec, MsSide, SiteSummary } from '../data';
import { MS_STATUS_LABEL, fmt } from '../data';
import MapView from '../components/MapView';
import { Cautions, NotAnalyzed } from '../components/common';

type FilterKey = 'all' | 'changed' | 'lost' | 'gained' | 'neither' | 'same' | 'sharedcoord' | 'newcolocated'
  | 'gsj_symbol' | 'gsj_age' | 'vector_legend';

export function navigate(params: Record<string, string | number | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  window.location.hash = `#/explore?${q.toString()}`;
}

export default function Explorer({ s, data, params }: { s: SiteSummary; data: CollectionRec[]; params: URLSearchParams }) {
  const filter = (params.get('filter') as FilterKey) || 'all';
  const id = params.get('id') ? Number(params.get('id')) : null;
  const qParam = params.get('q') ?? '';
  const [query, setQuery] = useState(qParam);
  useEffect(() => setQuery(qParam), [qParam]); // keep the box in sync with the URL

  const byO = useMemo(() => group(data, (r) => r.ko), [data]);
  const byR = useMemo(() => group(data, (r) => r.kr), [data]);
  const byId = useMemo(() => new Map(data.map((r) => [r.cid, r])), [data]);

  const gsjReady = s.gsj.status === 'analyzed';
  const vecReady = s.boundary.status === 'analyzed';
  const filters: { key: FilterKey; label: string; test: (r: CollectionRec) => boolean; disabled?: boolean }[] = [
    { key: 'all', label: '全件', test: () => true },
    { key: 'changed', label: 'Macrostrat：ポリゴンが変わった', test: (r) => r.ms.status === 'changed' },
    { key: 'lost', label: 'Macrostrat：丸め後に照合不可になった', test: (r) => r.ms.status === 'lost' },
    { key: 'gained', label: 'Macrostrat：丸め後に照合可になった', test: (r) => r.ms.status === 'gained' },
    { key: 'neither', label: 'Macrostrat：丸め前後とも照合不可', test: (r) => r.ms.status === 'neither' },
    { key: 'same', label: 'Macrostrat：変化なし', test: (r) => r.ms.status === 'same' },
    { key: 'sharedcoord', label: '同じ元座標に他のコレクションがある', test: (r) => (byO.get(r.ko)?.length ?? 0) > 1 },
    { key: 'newcolocated', label: '丸めで別座標の記録と同一座標になった', test: (r) => (byR.get(r.kr)?.length ?? 0) > (byO.get(r.ko)?.filter((x) => x.kr === r.kr).length ?? 0) },
    { key: 'gsj_symbol', label: 'GSJ：凡例（symbol）が変わった', test: (r) => r.gsj?.symbol_changed === true, disabled: !gsjReady },
    { key: 'gsj_age', label: 'GSJ：形成年代ラベルが変わった', test: (r) => r.gsj?.age_label_changed === true, disabled: !gsjReady },
    { key: 'vector_legend', label: 'GSJベクトル：凡例が変わった', test: (r) => r.bd?.vector_legend_changed === true, disabled: !vecReady },
  ];
  const f = filters.find((x) => x.key === filter) ?? filters[0];
  const results = useMemo(() => {
    const q = query.trim();
    return data.filter((r) => f.test(r) && (q === '' || String(r.cid).includes(q)));
  }, [data, f, query]);
  const rec = id != null ? byId.get(id) ?? null : null;
  const LIMIT = 300;

  return (
    <div className="page explorer">
      <aside className="card side">
        <h2>個別コレクションの比較</h2>
        <form onSubmit={(e) => { e.preventDefault(); const n = Number(query.trim()); if (byId.has(n)) navigate({ filter, id: n, q: query }); }}>
          <label htmlFor="q">コレクションID（PBDB collection_no）で検索</label>
          <div className="search-row">
            <input id="q" inputMode="numeric" value={query} placeholder="例：129652" onChange={(e) => setQuery(e.target.value)} />
            <button type="submit">表示</button>
          </div>
        </form>
        <label htmlFor="flt">絞り込み</label>
        <select id="flt" value={f.key} onChange={(e) => navigate({ filter: e.target.value, id, q: query })}>
          {filters.map((x) => (
            <option key={x.key} value={x.key} disabled={x.disabled}>
              {x.label}{x.disabled ? '（未解析）' : `（${data.filter(x.test).length.toLocaleString('ja-JP')}件）`}
            </option>
          ))}
        </select>
        <p className="muted small" data-testid="result-count">{results.length.toLocaleString('ja-JP')}件{results.length > LIMIT ? `（先頭${LIMIT}件を表示。IDで絞り込めます）` : ''}</p>
        <ul className="result-list">
          {results.slice(0, LIMIT).map((r) => (
            <li key={r.cid}>
              <button className={r.cid === id ? 'active' : ''} onClick={() => navigate({ filter, id: r.cid, q: query })}>
                <span className="mono">#{r.cid}</span>
                <span className={`chip chip-${r.ms.status}`}>{shortStatus(r.ms.status)}</span>
                {r.gsj?.symbol_changed && <span className="chip chip-changed">GSJ変更</span>}
              </button>
            </li>
          ))}
        </ul>
        {f.key === 'changed' && <p className="small muted">15件は11種類の元座標に由来します（同じ座標の記録はまとめて動きます）。</p>}
      </aside>

      <div className="main-col">
        <MapView rec={rec} all={data} onPick={(cid) => navigate({ filter, id: cid, q: query })} />
        {rec ? <Detail rec={rec} s={s} byO={byO} byR={byR} onPick={(cid) => navigate({ filter, id: cid, q: query })} />
          : <div className="card"><p>左の一覧からコレクションを選ぶか、IDを入力してください。地図上の点をクリックしても選べます。</p></div>}
      </div>
    </div>
  );
}

function shortStatus(st: CollectionRec['ms']['status']) {
  return { same: '変化なし', changed: 'ポリゴン変更', lost: '照合不可へ', gained: '照合可へ', neither: '照合なし' }[st];
}

function group(data: CollectionRec[], key: (r: CollectionRec) => string) {
  const m = new Map<string, CollectionRec[]>();
  for (const r of data) {
    const k = key(r);
    const a = m.get(k);
    if (a) a.push(r); else m.set(k, [r]);
  }
  return m;
}

function Yes({ v }: { v: boolean | null | undefined }) {
  if (v == null) return <span className="muted">判定不可</span>;
  return v ? <span className="flag flag-yes">変わった</span> : <span className="flag flag-no">変わらない</span>;
}

function msCell(side: MsSide | null) {
  if (!side) return <span className="muted">ポリゴンなし（照合不可）</span>;
  return (
    <>
      <div>{side.name}</div>
      <div className="small muted">legend_id {side.legend} ／ map_id {side.map} ／ poly_idx {side.poly}</div>
      <div className="small">地質図側の年代：{fmt(side.age_b, 1)}–{fmt(side.age_t, 1)} Ma（{side.lith ?? '—'}）</div>
    </>
  );
}

function Detail({ rec, s, byO, byR, onPick }: {
  rec: CollectionRec; s: SiteSummary; byO: Map<string, CollectionRec[]>; byR: Map<string, CollectionRec[]>; onPick: (cid: number) => void;
}) {
  const sameO = (byO.get(rec.ko) ?? []).filter((x) => x.cid !== rec.cid);
  const sameR = (byR.get(rec.kr) ?? []).filter((x) => x.cid !== rec.cid);
  const newly = sameR.filter((x) => x.ko !== rec.ko);
  const bd = rec.bd;
  return (
    <div className="card detail" data-testid="detail">
      <h2>コレクション <span className="mono">#{rec.cid}</span></h2>
      <p><span className={`chip chip-${rec.ms.status}`}>Macrostrat：{MS_STATUS_LABEL[rec.ms.status]}</span></p>

      <h3>座標</h3>
      <table className="kv">
        <tbody>
          <tr><th>元座標（報告座標）</th><td className="mono">緯度 {rec.o[1].toFixed(6)}　経度 {rec.o[0].toFixed(6)}</td></tr>
          <tr><th>1分角丸め後の座標</th><td className="mono">緯度 {rec.r[1].toFixed(6)}　経度 {rec.r[0].toFixed(6)}<div className="small muted">（{dms(rec.r[1])} N, {dms(rec.r[0])} E）</div></td></tr>
          <tr><th>両座標間の移動距離</th><td><strong>{fmt(rec.move_m, 1)} m</strong><div className="small muted">GRS80楕円体上の測地線距離（度のまま計算していません）</div></td></tr>
          <tr><th>化石の登録年代</th><td>{rec.age ? `${fmt(rec.age.max_ma, 2)}–${fmt(rec.age.min_ma, 2)} Ma` : <NotAnalyzed>共有された結果CSVには化石年代の列がありません。fossil_collections.csv を入れて再生成すると表示されます。</NotAnalyzed>}</td></tr>
        </tbody>
      </table>

      <h3>Macrostrat（Ye & Peters 2023 Dryad 当時のスナップショット）での照合</h3>
      <div className="table-scroll">
        <table className="cmp">
          <thead><tr><th></th><th>元座標</th><th>1分角丸め後</th></tr></thead>
          <tbody>
            <tr><th>含まれるポリゴン</th><td>{msCell(rec.ms.o)}</td><td>{msCell(rec.ms.r)}</td></tr>
            <tr><th>ポリゴン</th><td colSpan={2}><Yes v={rec.ms.o && rec.ms.r ? rec.ms.o.poly !== rec.ms.r.poly : null} /></td></tr>
            <tr><th>凡例（legend_id）</th><td colSpan={2}><Yes v={rec.ms.legend_changed} /></td></tr>
            <tr><th>地質図側の年代端点</th><td colSpan={2}><Yes v={rec.ms.age_changed} /></td></tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">単純な point-in-polygon の結果です。Ye & Peters の年代条件付き対応付け（join_id）とは別物です。</p>

      <h3>GSJ 日本シームレス地質図V2 での照合</h3>
      {rec.gsj ? (
        <div className="table-scroll">
          <table className="cmp">
            <thead><tr><th></th><th>元座標</th><th>1分角丸め後</th></tr></thead>
            <tbody>
              <tr><th>API応答</th><td>{rec.gsj.o.status}</td><td>{rec.gsj.r.status}</td></tr>
              <tr><th>凡例記号 symbol</th><td className="mono">{rec.gsj.o.symbol ?? '—'}</td><td className="mono">{rec.gsj.r.symbol ?? '—'}</td></tr>
              <tr><th>形成時代 formationAge_ja</th><td>{rec.gsj.o.age_ja ?? '—'}</td><td>{rec.gsj.r.age_ja ?? '—'}</td></tr>
              <tr><th>凡例は変わったか</th><td colSpan={2}><Yes v={rec.gsj.symbol_changed} /></td></tr>
              <tr><th>形成時代ラベルは変わったか</th><td colSpan={2}><Yes v={rec.gsj.age_label_changed} /></td></tr>
            </tbody>
          </table>
        </div>
      ) : (
        <NotAnalyzed>{s.gsj.status === 'analyzed' ? 'このコレクションはGSJ APIの取得対象（サンプル）に含まれていません。' : 'GSJ APIの取得結果がまだありません（取得スクリプトは完成済み）。'}</NotAnalyzed>
      )}
      <p className="small muted">GSJの symbol と Macrostrat の legend_id は別の分類です。両者を同じ地質単元として比べることはしません。</p>

      <h3>地質境界までの距離（GSJベクトルデータ）</h3>
      {bd ? (
        <div className="table-scroll">
          <table className="cmp num">
            <thead><tr><th>最寄りの線の種類</th><th>元座標</th><th>丸め後</th></tr></thead>
            <tbody>
              <tr><th>異なる凡例の地質境界</th><td>{m(bd.d_diff_legend_m_o)}</td><td>{m(bd.d_diff_legend_m_r)}</td></tr>
              <tr><th>同じ凡例のポリゴン間の線</th><td>{m(bd.d_same_legend_m_o)}</td><td>{m(bd.d_same_legend_m_r)}</td></tr>
              <tr><th>海岸線（水域ポリゴンとの境）</th><td>{m(bd.d_coastline_m_o)}</td><td>{m(bd.d_coastline_m_r)}</td></tr>
              <tr><th>外縁（海岸線またはデータなし）</th><td>{m(bd.d_outer_edge_m_o)}</td><td>{m(bd.d_outer_edge_m_r)}</td></tr>
              <tr><th>ベクトルでの凡例</th><td className="mono">{String(bd.legend_o ?? '—')}</td><td className="mono">{String(bd.legend_r ?? '—')}</td></tr>
            </tbody>
          </table>
        </div>
      ) : (
        <NotAnalyzed>{s.boundary.status === 'analyzed' ? 'このコレクションの距離は計算されていません。' : 'まだ計算していません（計算スクリプトとテストは完成済み。GSJのベクトルデータが必要）。'}</NotAnalyzed>
      )}

      <h3>同じ座標に登録された他のコレクション</h3>
      <p className="small">元座標が完全に同じ：{sameO.length ? '' : 'なし'}</p>
      {sameO.length > 0 && <IdList list={sameO} onPick={onPick} />}
      <p className="small">丸め後に同じ座標になる：{sameR.length}件（うち、元は別の座標だった記録 {newly.length}件）</p>
      {newly.length > 0 && <IdList list={newly} onPick={onPick} />}
      <p className="small muted">同じ数値座標でも、同じ露頭・同じ採集層準とは限りません。</p>

      <h3>データの出典</h3>
      <ul className="small">
        <li>化石コレクションと座標：PBDB由来、<a href="https://doi.org/10.5061/dryad.vhhmgqnxt" target="_blank" rel="noreferrer">Ye & Peters（2023）Dryad公開データ</a>（公開当時のスナップショット）。 <a href={`https://paleobiodb.org/classic/displayCollResults?collection_no=${rec.cid}`} target="_blank" rel="noreferrer">PBDBの現在のページ</a>（現在の登録内容は解析時と異なる場合があります）</li>
        <li>Macrostrat照合：同Dryadデータに含まれる当時のMacrostrat由来地質図への point-in-polygon（research/macrostrat/out_JP_arcmin1.0.csv）</li>
        <li>GSJ：<a href="https://gbank.gsj.jp/seamless/v2/api/1.3.1/" target="_blank" rel="noreferrer">地質図Web API 1.3.1</a>（取得後に表示）</li>
        <li>丸め：1/60度格子、原点(0,0)、偶数丸め（numpy.round）</li>
      </ul>
      <details><summary>この結果を読むときの注意</summary><Cautions compact /></details>
    </div>
  );
}

function m(v: unknown) {
  return typeof v === 'number' ? `${fmt(v, 1)} m` : <span className="muted">—</span>;
}

function dms(deg: number) {
  const d = Math.floor(deg);
  const mm = Math.round((deg - d) * 60);
  return mm === 60 ? `${d + 1}°00′` : `${d}°${String(mm).padStart(2, '0')}′`;
}

function IdList({ list, onPick }: { list: CollectionRec[]; onPick: (cid: number) => void }) {
  return (
    <ul className="id-list">
      {list.slice(0, 60).map((x) => (
        <li key={x.cid}><button onClick={() => onPick(x.cid)} className="link mono">#{x.cid}</button> <span className={`chip chip-${x.ms.status}`}>{shortStatus(x.ms.status)}</span></li>
      ))}
      {list.length > 60 && <li className="muted">ほか{list.length - 60}件</li>}
    </ul>
  );
}
