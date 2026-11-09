import { useState, type ReactNode } from 'react';

export function NotAnalyzed({ children }: { children?: ReactNode }) {
  return (
    <div className="not-analyzed" role="note">
      <span className="badge badge-na">未解析</span>
      <span>{children ?? 'この項目のデータはまだありません。架空の値は表示しません。'}</span>
    </div>
  );
}

export function Source({ children }: { children: ReactNode }) {
  return <p className="source">出典：{children}</p>;
}

export function Section({ id, title, children, lead }: { id?: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" id={id}>
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </section>
  );
}

/** Seven geological cautions requested for the screen and README. */
export function Cautions({ compact = false }: { compact?: boolean }) {
  const items: [string, string][] = [
    ['報告座標は、正確な採集地点とは限りません。', '古い文献の地名から求めた代表点や、すでに丸められた座標のことがあります。'],
    ['GSJ地質図は「地表付近」の地質を示す地図です。', '化石が採れた地層（採集層準）と一致するとは限りません。崖・採石場・地下の層から採集されることもあります。'],
    ['地図の縮尺によって、小さな地層は省略されます。', '20万分の1の地図では、薄い地層や小さな露頭は描かれないことがあります。'],
    ['地質図と年代が合わなくても、化石の登録ミスの証明にはなりません。', '座標・地図・採集層準のどれが原因か、この比較だけでは決められません。'],
    ['人工的な座標の丸めは、実際の位置誤差ではありません。', 'ここでの「1分角丸め」は、結果の感度を調べるための実験操作です。'],
    ['「地質凡例が変わった」と「化石年代との整合性が反転した」は別の指標です。', '凡例が変わっても年代が同じこともあり、逆もあります。'],
    ['Ye & Peters（2023）の対応付けと、単純な点とポリゴンの重ね合わせ（point-in-polygon）は違う方法です。', '元の研究は年代条件や周辺探索も使っています。本サービスの照合は、座標を含むポリゴンを調べるだけの単純な方法です。'],
  ];
  return (
    <ul className={compact ? 'cautions compact' : 'cautions'}>
      {items.map(([h, b]) => (
        <li key={h}>
          <strong>{h}</strong>
          {!compact && <span> {b}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal bar chart (single measure, percent). Hover/focus shows exact value. */
export function HBarChart({
  rows, max, unit = '%', ariaLabel,
}: { rows: { label: string; value: number | null; color: string; note?: string }[]; max: number; unit?: string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, rowH = 34, labelW = 150, pad = 64;
  const H = rows.length * rowH + 24;
  const x = (v: number) => (v / max) * (W - labelW - pad);
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={labelW + x(t)} x2={labelW + x(t)} y1={0} y2={H - 20} className="grid" />
            <text x={labelW + x(t)} y={H - 6} className="tick" textAnchor="middle">{fmtTick(t)}{unit}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = i * rowH + 6;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <rect x={0} y={y - 4} width={W} height={rowH} fill="transparent" />
              <text x={labelW - 8} y={y + 15} textAnchor="end" className="axis-label">{r.label}</text>
              {r.value == null ? (
                <text x={labelW + 4} y={y + 15} className="na-text">未解析</text>
              ) : (
                <>
                  <rect x={labelW} y={y + 4} height={18} width={Math.max(x(r.value), 2)} rx={4} fill={r.color} />
                  <text x={labelW + Math.max(x(r.value), 2) + 6} y={y + 18} className="value-label">{r.value.toFixed(2)}{unit}</text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && rows[hover] && (
        <div className="tooltip" role="status">
          <strong>{rows[hover].label}</strong>：{rows[hover].value == null ? '未解析' : `${rows[hover].value!.toFixed(4)}${unit}`}
          {rows[hover].note && <div className="muted">{rows[hover].note}</div>}
        </div>
      )}
    </div>
  );
}

function fmtTick(t: number) {
  return Number.isInteger(t) ? String(t) : t.toFixed(1);
}

/** 100% stacked horizontal bar per row with a legend and hover detail. */
export function StackedBars({
  rows, segments, ariaLabel,
}: {
  rows: { label: string; values: number[] }[];
  segments: { label: string; color: string; pattern?: boolean }[];
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<{ r: number; s: number } | null>(null);
  const W = 560, rowH = 40, labelW = 70;
  const H = rows.length * rowH;
  return (
    <div className="chart-wrap">
      <div className="legend">
        {segments.map((s) => (
          <span key={s.label} className="legend-item"><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="chart">
        {rows.map((r, ri) => {
          const total = r.values.reduce((a, b) => a + b, 0);
          let acc = 0;
          const y = ri * rowH + 8;
          return (
            <g key={r.label}>
              <text x={labelW - 8} y={y + 16} textAnchor="end" className="axis-label">{r.label}</text>
              {r.values.map((v, si) => {
                const w = (v / total) * (W - labelW - 4);
                const x0 = labelW + (acc / total) * (W - labelW - 4);
                acc += v;
                if (v === 0) return null;
                return (
                  <rect key={si} x={x0} y={y} width={Math.max(w - 2, 1)} height={22} rx={2}
                        fill={segments[si].color} tabIndex={0}
                        onMouseEnter={() => setHover({ r: ri, s: si })} onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover({ r: ri, s: si })} onBlur={() => setHover(null)} />
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tooltip" role="status">
          <strong>{rows[hover.r].label}</strong>・{segments[hover.s].label}：
          {rows[hover.r].values[hover.s].toLocaleString('ja-JP')}件
          （{((rows[hover.r].values[hover.s] / rows[hover.r].values.reduce((a, b) => a + b, 0)) * 100).toFixed(2)}%）
        </div>
      )}
    </div>
  );
}
