// Builds a small offline basemap (land polygons around Japan) from Natural Earth 1:10m
// (public domain, via the world-atlas npm package). Used under the map so that the
// collections are always shown on a map, even when external tile servers are unreachable.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/land-10m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);
const [W, S, E, N] = [120, 22, 156, 48];
const r = (v) => Math.round(v * 1e4) / 1e4;
const polys = [];
for (const f of land.features) {
  const list = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of list) {
    const ring = p[0];
    if (ring.some(([x, y]) => x >= W && x <= E && y >= S && y <= N)) polys.push(p.map((rg) => rg.map(([x, y]) => [r(x), r(y)])));
  }
}
const out = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { source: 'Natural Earth 1:10m land (public domain)' }, geometry: { type: 'MultiPolygon', coordinates: polys } }] };
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/basemap_japan.geojson', JSON.stringify(out));
console.log(`basemap: ${polys.length} polygons -> public/data/basemap_japan.geojson`);
