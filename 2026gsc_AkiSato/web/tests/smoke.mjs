// Basic operation test against the built site (npm run build && npm run test:e2e).
// Starts `vite preview`, drives Chromium with Playwright, saves screenshots in test-results/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
mkdirSync('test-results', { recursive: true });
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  srv.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); });
  srv.on('exit', (c) => rej(new Error('preview exited ' + c)));
  setTimeout(() => rej(new Error('preview timeout')), 20000);
});

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const appErrors = [];
  page.on('pageerror', (e) => appErrors.push(String(e)));

  // Screen 1
  await page.goto(BASE + '#/overview');
  await page.getByRole('heading', { name: /座標丸めは、地質図との照合結果/ }).waitFor();
  const body1 = await page.locator('main').innerText();
  check('overview: JP 15 / 3,862', body1.includes('15') && body1.includes('3,862'));
  check('overview: US 1,965 / 52,759', body1.includes('1,965') && body1.includes('52,759'));
  check('overview: GSJ shown as 未解析', body1.includes('未解析'));
  check('overview: prior work listed', ['Ye & Peters', 'CoordinateCleaner', 'fossilbrush'].every((t) => body1.includes(t)));
  check('overview: 7 geological cautions', (await page.locator('ul.cautions:not(.compact) > li').count()) === 7);
  check('overview: collection vs unique-coordinate table', body1.includes('11') && body1.includes('2,480'));
  await page.screenshot({ path: 'test-results/01_overview.png', fullPage: true });

  // Screen 2: changed-only filter
  await page.goto(BASE + '#/explore?filter=changed');
  await page.getByTestId('result-count').waitFor();
  const cnt = await page.getByTestId('result-count').innerText();
  check('explorer: changed filter = 15 records', cnt.startsWith('15件'), cnt);
  // search by ID
  await page.fill('#q', '129652');
  await page.click('button[type=submit]');
  await page.getByTestId('detail').waitFor();
  const det = await page.getByTestId('detail').innerText();
  check('explorer: detail shows ID', det.includes('#129652'));
  check('explorer: original + rounded coords', det.includes('36.157001') && det.includes('36.150000') && det.includes('138.483333'));
  check('explorer: Macrostrat before/after names', det.includes('Cenozoic volcanic rocks') && det.includes('Paleozoic-Mesozoic sedimentary rocks'));
  check('explorer: same-coordinate collections listed', ['#129653', '#129654', '#129655', '#129656'].every((t) => det.includes(t)));
  check('explorer: GSJ & boundary marked 未解析', (det.match(/未解析/g) || []).length >= 3);
  const moved = det.match(/([\d,.]+) m\n/);
  check('explorer: move distance shown in metres', !!moved, moved?.[1]);
  // markers on map: wait for selection sources
  await page.waitForTimeout(1500);
  const feats = await page.evaluate(() => {
    const el = document.querySelector('[data-testid=map]');
    return el ? el.querySelectorAll('canvas').length : 0;
  });
  check('explorer: map canvas rendered', feats > 0);
  await page.screenshot({ path: 'test-results/02_explorer_129652.png', fullPage: true });

  // click a same-coordinate link -> navigates
  await page.getByRole('button', { name: '#129653' }).first().click();
  await page.waitForFunction(() => location.hash.includes('id=129653'));
  check('explorer: same-coordinate link navigates', true);

  // filter all + text filter
  await page.goto(BASE + '#/explore?filter=lost');
  await page.waitForFunction(() => document.querySelector('[data-testid=result-count]')?.textContent?.startsWith('46'), null, { timeout: 5000 }).catch(() => {});
  const lost = await page.getByTestId('result-count').innerText();
  check('explorer: lost filter = 46', lost.startsWith('46件'), lost);
  const gsjOpt = await page.locator('#flt option[value=gsj_symbol]').getAttribute('disabled');
  check('explorer: GSJ filter disabled while 未解析', gsjOpt !== null);

  // Screen 3
  await page.goto(BASE + '#/results');
  await page.getByRole('heading', { name: /Macrostrat と GSJ の変更率/ }).waitFor();
  const body3 = await page.locator('main').innerText();
  check('results: rounding table includes 15,464', body3.includes('15,464'));
  check('results: unmatched breakdown 858 / 46 / 24 / 834', ['858', '46', '24', '834'].every((t) => body3.includes(t)));
  const hrefs = await page.locator('.downloads a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check('results: downloads listed', hrefs.length >= 5, hrefs.join(', '));
  const resp = await page.request.get(new URL(hrefs.find((h) => h.includes('changed_15')), page.url()).href);
  const csv = await resp.text();
  check('results: changed_15 CSV downloadable with 15 rows', resp.ok() && csv.trim().split('\n').length === 16);
  await page.screenshot({ path: 'test-results/03_results.png', fullPage: true });

  // mobile width: no horizontal page scroll
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + '#/explore?filter=changed&id=181921');
  await m.getByTestId('detail').waitFor();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile: no horizontal scroll on explorer', overflow <= 1, `overflow=${overflow}`);
  await m.screenshot({ path: 'test-results/04_mobile_explorer.png', fullPage: false });

  check('no uncaught page errors', appErrors.length === 0, appErrors.join(' | '));
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
