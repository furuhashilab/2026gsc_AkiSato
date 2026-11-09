# Fossil Overlay Audit 実装記録と実行方法

> README.md の研究記録（1〜10章）とは別に、Webサービスと解析スクリプトの実装内容・実行方法をまとめたものです。

## A. できたもの

| 画面 | 内容 |
|---|---|
| 1. 研究の概要と実測結果 | 研究の必要性、既存研究・ツールとの違い、実施済み実験（README 4.1〜4.5）、未検証の内容、Macrostrat日米比較グラフ、コレクション単位とユニーク座標単位の区別、研究の過程、地質学上の注意 |
| 2. 個別コレクションの比較 | コレクションID検索、変更が起きた記録だけの抽出（Macrostratポリゴン変更15件／照合不可へ46件／照合可へ24件など）、元座標・1分角丸め後座標・移動距離、Macrostrat丸め前後の照合結果、GSJの照合結果と境界距離（データがあれば）、同一座標の他コレクション、データ出典。地図上で元座標（青丸）と丸め後座標（白抜き橙丸）を別マーカーで示し、移動線と1分角セルを表示 |
| 3. 実験結果の比較 | MacrostratとGSJの変更率、丸め幅を変えた場合の結果（実測があるものだけ）、境界距離と凡例変更の関係、未マッチ件数の内訳、結果CSVダウンロード、入力ファイルのハッシュと自動照合の結果 |

データがない項目は「未解析」と表示し、値を埋めていません。

## B. ファイル構成

```text
README.md                         研究記録（1〜10章）と概要
docs/IMPLEMENTATION.md            この文書（実装記録・実行方法）
research/macrostrat/              共有された結果（out_JP/US_arcmin1.0.csv, summary_macrostrat.json, quant_macrostrat.py）※変更なし
research/gsj/gsj_quantization_pilot.py   GSJ API試作スクリプト（変更なし）
research/gsj/test_runs/           開発環境でのGSJ API取得テストの記録（接続失敗のログ）
research/readme_reported_values.json     README 4.1〜4.5 の数値の転記（画面表示用）
research/SHA256SUMS.txt           共有ファイルのハッシュ
analysis/build_web_data.py        結果CSV → Web用JSON/CSV（README・集計JSONと自動照合）
analysis/gsj_fetch.py             GSJ API取得（キャッシュ・リトライ・生レスポンス保存）
analysis/boundary_distance.py     地質境界までの距離（GeoPandas / Shapely）
analysis/tests/                   pytest（単純図形での距離テストなど）
web/                              React + TypeScript + Vite + MapLibre GL JS
.github/workflows/deploy.yml      テスト → ビルド → GitHub Pages デプロイ
```

## C. 実行方法

必要なもの：Python 3.11以上、Node.js 20以上。

```bash
pip install -r requirements-geo.txt
```

```bash
python analysis/build_web_data.py
```

```bash
cd web && npm ci && npm run dev
```

ブラウザで表示されたURL（通常 http://localhost:5173/ ）を開きます。背景地図は OpenStreetMap／地理院地図／簡易地図（Natural Earth、オフラインでも表示）から選べ、その上に GSJ シームレス地質図V2 の公式タイルを重ねます。

サーバーなしでダブルクリックで開ける1ファイル版（`web/dist-standalone/fossil-overlay-audit.html`）は次で作れます。

```bash
cd web && npm run standalone
```
本番用ビルドと動作テストは次の通りです（テストには Playwright が必要）。

```bash
cd web && npm run build && npm run test:e2e
```

```bash
python -m pytest analysis/tests -q
```

`fossil_collections.csv`（Dryad）を持っている場合は、化石の登録年代も画面に出せます（列名が自動で見つからない場合は `--age-cols 最大列,最小列` を指定）。

```bash
python analysis/build_web_data.py --fossil-csv path/to/fossil_collections.csv
```

### GitHub Pages への公開

1. GitHub のリポジトリ → Settings → Pages → Build and deployment の Source を **GitHub Actions** にする（以前の「ブランチから公開」のままだと新しいサイトは出ません）。
2. `main` ブランチに push（またはこのブランチを main へマージ）すると、`.github/workflows/deploy.yml` がテスト → データ生成 → ビルド → 公開を行います。Actions タブの「Run workflow」からも実行できます。
3. 公開先：`https://furuhashilab.github.io/2026gsc_AkiSato/`（以前の横瀬町エネルギーマップは別リポジトリ `furuhashilab/2026gsc_SatoAki` に残っています）。

## D. GSJ API の取得（自分のPCで実行）

開発環境（クラウド）からは GSJ のサーバー（gbank.gsj.jp）への接続がネットワーク制限で拒否されたため（`403 Forbidden`、記録：`research/gsj/test_runs/2026-11-09_cloud_30/run_log.json`）、**GSJの取得結果はまだありません**。次のコマンドを自分のPCで実行してください。

```bash
pip install -r requirements.txt
```

まず応答の形式を確認します（東京駅付近と太平洋上の2点の生レスポンスを表示）。`point=` が「緯度,経度」の順で正しく応答するか、`symbol` と `formationAge_ja` があるかを確認してください。

```bash
python analysis/gsj_fetch.py --probe
```

30件で取得テストをします（ランダム抽出 seed=42。重複座標は1回だけ問い合わせ、1秒間隔）。

```bash
python analysis/gsj_fetch.py --limit 30
```

`research/gsj/results/` の `summary.json`・`run_log.json`・`per_collection.csv` を確認し、問題がなければ全件（4,766件、問い合わせるユニーク座標は元座標と丸め後座標を合わせて4,318点。1秒間隔で約1時間15分）を取得します。途中で止まっても、`api_cache.json` に保存済みの座標は再取得しません。

```bash
python analysis/gsj_fetch.py --limit 0
```

その後 `python analysis/build_web_data.py` を実行すると、画面2・3にGSJの結果が表示されます。`research/gsj/results/` をコミットすれば公開サイトにも反映されます。

- 応答が1件も得られなかった実行は `per_collection_NO_VALID_RESPONSES.csv` という名前で保存され、Webには結果として出ません。
- `symbol` が変わったことは、化石の登録が誤りであることを意味しません。`formationAge_ja` は文字列で、変化はMaの差ではありません。
- GSJ の `symbol` と Macrostrat の `legend_id` は別の分類なので、両者を同じ地質単元として比較しません。

## E. 地質境界までの距離（自分のPCで実行）

GSJ の [シームレス地質図V2のデータ利用ページ](https://gsj-seamless.jp/seamless/use.html) から、ベクトルデータ（シェープファイル）を利用条件を確認してダウンロードします（開発環境からはアクセスできず、ファイル名・属性名は未確認です）。

```bash
python analysis/boundary_distance.py run path/to/seamless_v2.shp --list-columns
```

凡例を表す列名を確認したら、GeoParquet に変換してから計算します（`--legend-field` は確認した列名に置き換える）。

```bash
python analysis/boundary_distance.py convert path/to/seamless_v2.shp research/boundary/gsj_v2.parquet
```

```bash
python analysis/boundary_distance.py run research/boundary/gsj_v2.parquet --legend-field symbol --write-lines
```

水域（海・湖）のポリゴンがある場合は、その凡例値を `--water-legends 値1,値2` で指定すると、海岸線を地質境界と区別できます。結果は `research/boundary/results/boundary_distances.csv` と `.parquet` に保存され、`python analysis/build_web_data.py` で画面に反映されます。

**計算方法**

1. 各コレクションを、元座標の経度で決まる **JGD2011 / UTM 座標系（m単位、EPSG:6688〜6692。東経150度以東は WGS 84 / UTM 56N）** に変換する。丸め後座標も同じ座標系で扱う。度のまま距離を計算しない。
2. 点の周囲（探索半径20 km ＋余裕）でポリゴンを切り出し、隣り合うポリゴンの共有辺を取り出す。
3. 境界線を次の5種類に分ける：**異なる凡例の地質境界**／**同じ凡例のポリゴン間の線**（図郭の分割線など）／**海岸線**（水域ポリゴンとの境）／**外縁**（どのポリゴンとも接していない辺＝海岸線またはデータのない範囲）／**切り出し範囲の端**（計算のために人工的にできた辺）。
4. 元座標と丸め後座標のそれぞれから、種類ごとの最寄りの線までの最短距離（m）を求める。ポリゴン本体ではなく**境界線**までを測る（ポリゴン内部の点からポリゴン本体までは0になるため）。
5. 主指標（異なる凡例の境界まで）は、最寄り点を緯度経度に戻して GRS80 楕円体上の距離でも測り直し、投影による誤差を確認する。
6. ベクトルデータでの point-in-polygon による凡例（丸め前後）も記録する。

**単純な図形でのテスト（`analysis/tests/test_boundary_distance.py`）**：1 km 四方の正方形を並べ、既知の距離（100 m、500 m など）になるか、同じ凡例の境界・異なる凡例の境界・海岸線・切り出し端が正しく区別されるか、ポリゴン内部の点でも境界距離が0にならないか、経度139.5度の境界から東経139.49度の点までの距離が楕円体上の距離（約907.3 m）と一致するか、を確認しています。

## F. 使用データと計算方法

| データ | 内容 | 扱い |
|---|---|---|
| `research/macrostrat/out_JP_arcmin1.0.csv` | 日本4,766件の元座標・丸め後座標と、それぞれを含むMacrostrat由来ポリゴンの属性 | 再集計のみ。空間結合は再実行していない |
| `research/macrostrat/out_US_arcmin1.0.csv` | 米国本土54,912件の同様の結果 | 同上 |
| `research/macrostrat/summary_macrostrat.json` | 上記の集計 | ビルド時に再集計値と自動照合 |
| README 4.1〜4.4 の数値 | 座標調査・丸め幅実験など | 元データ未収録のため転記して表示（再計算していない） |

- **丸め**：`round(値 / (1/60)) × (1/60)`、原点(0,0)の格子、偶数丸め（numpy）。CSVの丸め後座標と一致することをビルド時に確認。
- **移動距離**：元座標と丸め後座標の GRS80 楕円体上の測地線距離（pyproj）。日本4,766件で中央値 約370 m、最大 約1,252 m。
- **自動照合（ビルドが止まる条件）**：日本 15/3,862件、米国本土 1,965/52,759件、未照合 858・46・24（日本）／1,946・207・187（米国本土）、年代端点変更 15／1,722、変更15件の元座標11種類 が README.md 4.5 および summary_macrostrat.json と一致すること。
- **追加で再計算できたもの**：座標だけで計算できる「丸め幅ごとのユニーク座標数・新たに同一座標になったペア数」。1分角丸めの新規同一座標ペア 15,464 は README 4.2 と一致。2件以上が同じ元座標にある地点 498 も README 4.1 と一致。ユニーク座標数は 4,766件で 2,480（README 4.1 の 4,770件・2,484地点とは対象集合が4件異なる）。

## G. 地質学上の注意（やさしい説明）

この研究とWebサービスは、**化石の誤登録を自動で見つけたり直したりするものではありません。**

- **報告座標は、正確な採集地点とは限りません。** 地名から決めた代表点や、すでに丸められた値のことがあります。
- **GSJ地質図は地表付近の地質を示す地図です。** 化石が採れた地層（採集層準）と一致するとは限りません。
- **地図の縮尺によって、小さな地層は省略されます。** 20万分の1では薄い地層や小さな露頭は描かれないことがあります。
- **地質図と年代が合わなくても、化石の登録ミスの証明にはなりません。**
- **人工的な座標の丸めは、実際の位置誤差ではありません。** 結果の感度を調べるための実験操作です。
- **「地質凡例の変更」と「化石年代との整合性の反転」は別の指標です。** 凡例が変わっても年代が同じこともあります。
- **Ye & Peters（2023）の年代条件付きの対応付けと、単純な点とポリゴンの重ね合わせ（point-in-polygon）は違う方法です。**
- **異なる地質図の凡例コード（Macrostrat の legend_id と GSJ の symbol）を、同じ地質単元として比べません。** 比べるのは「それぞれの地図の中で丸め前後に変わったか」だけです。

## H. テストした内容と結果（2026-11-09、開発環境）

| テスト | 結果 |
|---|---|
| `python -m pytest analysis/tests -q`（丸めの一致、UTM座標系コード、単純図形での境界距離6種、楕円体距離との一致、GSJ取得のキャッシュ・エラー処理、README数値の再現、GSJ/距離結果の取り込み） | 21件すべて成功 |
| `python analysis/build_web_data.py`（README 4.5・summary_macrostrat.json との自動照合） | 22項目すべて一致 |
| `npm run build`（TypeScript型検査＋Viteビルド） | 成功 |
| `npm run test:e2e`（Playwright：3画面の表示、ID検索、変更15件・照合不可46件の抽出、同一座標リンク、地図描画、CSVダウンロード、スマホ幅で横スクロールなし、実行時エラーなし） | 23件すべて成功 |
| GSJ API 30件取得テスト | **失敗**（開発環境のネットワーク制限で gbank.gsj.jp に接続不可、`403 Forbidden`）。結果は取得できていない |

開発環境では地理院タイル・GSJタイルにも接続できないため、背景地図の表示そのものは未確認です（マーカー・移動線・セルの表示は確認済み）。GSJタイルのURL（`https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png`）は公開後にブラウザで確認してください。

## I. 未完了の作業

| 作業 | 理由 | 次にやること |
|---|---|---|
| GSJ API での全件取得 | 開発環境から gbank.gsj.jp に接続できない | D章のコマンドを自分のPCで実行（まず `--probe` と `--limit 30`） |
| 地質境界までの距離の実計算 | GSJベクトルデータを開発環境で取得できない | E章のコマンドを自分のPCで実行 |
| 化石の登録年代の表示 | 共有CSVに年代列がない（fossil_collections.csv 未収録） | `--fossil-csv` を付けて再生成 |
| 丸め幅ごとの地質図照合 | Macrostrat の元ポリゴン（map_data.geojson）が未収録 | 必要なら quant_macrostrat.py の丸め幅リストを増やして再実行 |
| GitHub Pages での公開 | main へのマージと Pages 設定（Source = GitHub Actions）が必要 | C章の手順 |
