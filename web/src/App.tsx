import { useEffect, useState } from 'react';
import { loadCollections, loadSummary, type CollectionRec, type SiteSummary } from './data';
import Overview from './pages/Overview';
import Explorer from './pages/Explorer';
import Results from './pages/Results';

function parseHash() {
  const h = window.location.hash.replace(/^#/, '') || '/overview';
  const [path, qs] = h.split('?');
  return { path, params: new URLSearchParams(qs ?? '') };
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [data, setData] = useState<CollectionRec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const on = () => { setRoute(parseHash()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [route.path]);
  useEffect(() => {
    loadSummary().then(setSummary).catch((e) => setErr(String(e)));
    loadCollections().then(setData).catch((e) => setErr(String(e)));
  }, []);

  const tabs = [
    { path: '/overview', label: '1. 研究の概要と実測結果' },
    { path: '/explore', label: '2. 個別コレクションの比較（地図）' },
    { path: '/results', label: '3. 実験結果の比較' },
  ];

  return (
    <>
      <header className="topbar">
        <a href="#/overview" className="brand">Fossil Overlay Audit</a>
        <nav aria-label="画面">
          {tabs.map((t) => (
            <a key={t.path} href={`#${t.path}`} className={route.path === t.path ? 'active' : ''} aria-current={route.path === t.path ? 'page' : undefined}>{t.label}</a>
          ))}
        </nav>
      </header>
      <main>
        {err && <div className="card warn">データを読み込めませんでした：{err}<br />ローカルでは先に <code>npm run data</code> を実行してください。</div>}
        {!err && !summary && <div className="card">読み込み中…</div>}
        {summary && route.path === '/overview' && <Overview s={summary} />}
        {summary && route.path === '/results' && <Results s={summary} />}
        {summary && route.path === '/explore' && (data ? <Explorer s={summary} data={data} params={route.params} /> : <div className="card">コレクションデータを読み込み中…</div>)}
      </main>
      <footer className="footer">
        <p>このサービスは化石の誤登録を自動判定・修正するものではありません。「変更率」は人工的な座標丸めに対する地質図照合結果の変更率であり、位置誤差率や誤登録率ではありません。</p>
        <p>青山学院大学 地球社会共生学部 古橋研究室 2026年度 卒業研究｜<a href="https://github.com/furuhashilab/2026gsc_AkiSato" target="_blank" rel="noreferrer">GitHub</a>｜CC BY 4.0｜化石データ：PBDB / Ye & Peters (2023) Dryad｜地質図：Macrostrat、産総研地質調査総合センター｜背景地図：OpenStreetMap、地理院タイル</p>
      </footer>
    </>
  );
}
