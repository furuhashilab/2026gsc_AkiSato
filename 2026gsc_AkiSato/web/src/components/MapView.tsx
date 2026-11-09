import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CollectionRec } from '../data';

// Existing public map services (no geological map is re-created here).
const GSI_PALE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
// GSJ Seamless Digital Geological Map V2 tiles (official tile API, note z/y/x order).
const GSJ_TILES = 'https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png';

const HALF_ARCMIN = 0.5 / 60;

const style: StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: 'raster', tiles: [GSI_PALE], tileSize: 256, maxzoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
    },
    gsj: {
      type: 'raster', tiles: [GSJ_TILES], tileSize: 256, maxzoom: 13,
      attribution: '<a href="https://gbank.gsj.jp/seamless/" target="_blank" rel="noreferrer">産総研地質調査総合センター 20万分の1日本シームレス地質図V2</a>',
    },
  },
  layers: [
    { id: 'gsi', type: 'raster', source: 'gsi' },
    { id: 'gsj', type: 'raster', source: 'gsj', paint: { 'raster-opacity': 0.55 } },
  ],
};

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

export default function MapView({ rec, all, onPick }: { rec: CollectionRec | null; all: CollectionRec[]; onPick: (cid: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [gsjOn, setGsjOn] = useState(true);
  const [opacity, setOpacity] = useState(0.55);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({ container: box.current, style, center: [137.5, 37], zoom: 4.2, attributionControl: { compact: false } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('error', (e) => {
      const src = (e as unknown as { sourceId?: string }).sourceId;
      if (src === 'gsj') setTileError(true);
    });
    m.on('load', () => {
      m.addSource('all', { type: 'geojson', data: fc([]) });
      m.addLayer({
        id: 'all-pts', type: 'circle', source: 'all',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'changed'], 1], 4, 2.5],
          'circle-color': ['case', ['==', ['get', 'changed'], 1], '#52514e', '#9a9893'],
          'circle-stroke-width': 0.5, 'circle-stroke-color': '#ffffff',
        },
      });
      m.addSource('cell', { type: 'geojson', data: fc([]) });
      m.addLayer({ id: 'cell-line', type: 'line', source: 'cell', paint: { 'line-color': '#eb6834', 'line-width': 1, 'line-dasharray': [1, 2] } });
      m.addSource('move', { type: 'geojson', data: fc([]) });
      m.addLayer({ id: 'move-line', type: 'line', source: 'move', paint: { 'line-color': '#0b0b0b', 'line-width': 2, 'line-dasharray': [2, 1] } });
      m.addSource('sel', { type: 'geojson', data: fc([]) });
      m.addLayer({
        id: 'sel-o', type: 'circle', source: 'sel', filter: ['==', ['get', 'kind'], 'original'],
        paint: { 'circle-radius': 9, 'circle-color': '#2a78d6', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' },
      });
      m.addLayer({
        id: 'sel-r', type: 'circle', source: 'sel', filter: ['==', ['get', 'kind'], 'rounded'],
        paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-width': 4, 'circle-stroke-color': '#eb6834' },
      });
      m.on('click', 'all-pts', (e) => {
        const cid = e.features?.[0]?.properties?.cid;
        if (cid != null) onPick(Number(cid));
      });
      m.on('mouseenter', 'all-pts', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'all-pts', () => (m.getCanvas().style.cursor = ''));
      setReady(true);
    });
    map.current = m;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const seen = new Set<string>();
    const feats: GeoJSON.Feature[] = [];
    for (const r of all) {
      if (seen.has(r.ko)) continue;
      seen.add(r.ko);
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: r.o }, properties: { cid: r.cid, changed: r.ms.status === 'changed' ? 1 : 0 } });
    }
    (map.current.getSource('all') as GeoJSONSource).setData(fc(feats));
  }, [ready, all]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (!rec) {
      (m.getSource('sel') as GeoJSONSource).setData(fc([]));
      (m.getSource('move') as GeoJSONSource).setData(fc([]));
      (m.getSource('cell') as GeoJSONSource).setData(fc([]));
      return;
    }
    const [lr, br] = rec.r;
    (m.getSource('sel') as GeoJSONSource).setData(fc([
      { type: 'Feature', geometry: { type: 'Point', coordinates: rec.o }, properties: { kind: 'original' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: rec.r }, properties: { kind: 'rounded' } },
    ]));
    (m.getSource('move') as GeoJSONSource).setData(fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [rec.o, rec.r] }, properties: {} }]));
    (m.getSource('cell') as GeoJSONSource).setData(fc([{
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[lr - HALF_ARCMIN, br - HALF_ARCMIN], [lr + HALF_ARCMIN, br - HALF_ARCMIN], [lr + HALF_ARCMIN, br + HALF_ARCMIN], [lr - HALF_ARCMIN, br + HALF_ARCMIN], [lr - HALF_ARCMIN, br - HALF_ARCMIN]]] },
    }]));
    m.fitBounds([[lr - 2 * HALF_ARCMIN, br - 2 * HALF_ARCMIN], [lr + 2 * HALF_ARCMIN, br + 2 * HALF_ARCMIN]], { maxZoom: 14, duration: 600, padding: 40 });
  }, [ready, rec]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setLayoutProperty('gsj', 'visibility', gsjOn ? 'visible' : 'none');
    m.setPaintProperty('gsj', 'raster-opacity', opacity);
  }, [ready, gsjOn, opacity]);

  return (
    <div className="map-block">
      <div className="map-toolbar">
        <label><input type="checkbox" checked={gsjOn} onChange={(e) => setGsjOn(e.target.checked)} /> GSJシームレス地質図V2（背景・公式タイル）</label>
        <label>透明度 <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="地質図の不透明度" /></label>
      </div>
      <div ref={box} className="map" data-testid="map" />
      <div className="map-legend">
        <span><i className="mk mk-o" />元座標（報告座標）</span>
        <span><i className="mk mk-r" />1分角丸め後の座標</span>
        <span><i className="mk mk-line" />移動線</span>
        <span><i className="mk mk-cell" />丸め後座標を中心とする1分角セル</span>
        <span><i className="mk mk-all" />他のコレクション（濃い灰＝Macrostratで変更あり）</span>
      </div>
      {tileError && <p className="warn">GSJ地質図タイルの読み込みに失敗しました（ネットワークまたは配信側の問題）。照合結果の表示には影響しません。</p>}
      <p className="muted small">背景の地質図は表示用です。本サービスの照合結果は、地図タイルの色ではなく、Pythonで事前に計算した結果ファイルから表示しています。Macrostratの地質図はこの地図には表示していません（解析に使った当時のスナップショットは現在の配信データと異なるため）。</p>
    </div>
  );
}
