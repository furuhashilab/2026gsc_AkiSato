// Packs the built app (dist/) and its data into ONE html file that opens by double-click
// (file://) in a normal browser. Output: dist-standalone/fossil-overlay-audit.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const js = readFileSync('dist/' + html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1], 'utf8');
const css = readFileSync('dist/' + html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1], 'utf8');
const data = {};
for (const f of ['site_summary.json', 'collections_jp.json', 'basemap_japan.geojson']) data[f] = JSON.parse(readFileSync('dist/data/' + f, 'utf8'));
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const out = `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Fossil Overlay Audit</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.__FOA_DATA__ = ${safe(JSON.stringify(data))};</script>
<script type="module">${safe(js)}</script>
</body>
</html>
`;
mkdirSync('dist-standalone', { recursive: true });
writeFileSync('dist-standalone/fossil-overlay-audit.html', out);
console.log(`dist-standalone/fossil-overlay-audit.html (${(out.length / 1e6).toFixed(1)} MB)`);
