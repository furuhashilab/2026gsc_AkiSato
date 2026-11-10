# PBDBの採集範囲分類と位置精度：監査辞書への補足

## 重要な訂正

既存監査辞書は `geogscale` を「採集地の空間的範囲」としか記述せず、実際の選択値と閾値を省いていた。2026年のPBDB User Guide Version 2.0に基づく分類は下記の通り。

| PBDB User Guide上の表示区分 | 採集された区域の記述 | 公開座標の位置誤差か？ |
|---|---|---|
| small collection | 10m × 10m未満 | いいえ |
| outcrop | 1km × 1km未満 | いいえ |
| local area | 100km × 100km未満 | いいえ |
| basin | 100km × 100km超 | いいえ |
| 記録なし | 不明 | 位置誤差も不明 |

**出典:** [PBDB User Guide Version 2.0 (2026), Scale of geographic resolution](https://www.researchgate.net/publication/404972077_Paleobiology_Database_User_Guide_Version_20). 項目は「化石を見つけた空間範囲」の大きさを分類する。座標が採集地にどれほど近いかの評価ではない。

## 100m四方と10km四方は別の話

「100m × 100m」および「10km × 10km」は、2026年のPBDBガイド記載の選択肢の境界には存在しない。研究用の階級（例 10m, 100m, 1km, 10km, 100km）として採用できるが、DBの原入力でその分解能が得られているかのように扱えない。

## どうすれば数値的に有利といえるか

必要な別々の観測量：

1. **採集範囲（source extent）:** `geogscale` と原産地記述の範囲。カテゴリーとして集計可能だが、このままでは座標誤差のm値を導けない。
2. **位置決定の根拠（georeference basis）:** 文献に明記、地形目標、地図判読、行政単位など。これも誤差ではない。
3. **座標の不確実性半径R:** 原記載の候補区域を包含し、資料・測地系・地図作業等の不確実性を含める計算。[GBIF Georeferencing Best Practices](https://docs.gbif.org/georeferencing-best-practices/1.0/en/) 参照。
4. **実際の距離誤差d:** 登録座標と独立した参照地点との地表測地距離。独立参照がないと計算不可。
5. **用途に対する利益:** 地質図の一意な帰属なら、半径Rの候補区域が1つの地質単元に収まるか、別の地質単元をまたぐかを調べる。地質図の尺度だけで画一的な250m基準を設定しない。

### 地質図との照合の理屈

候補域 U と地質単元のポリゴン P_j を考える。Uが単一P_jに完全包含される場合、その地図の条件下では**位置の候補範囲による地質帰属の曖昧さはない**。Uが複数単元と交差すると複数候補が存在する。これは地図自体の年代・岩相誤りや地質境界の不確実性を保証しない。単純な面積比を確率として解釈するには「U内で位置が一様に分布」という追加仮定が必要。

## PBDB Navigator画面の読み取り限界

NavigatorのCollection詳細画面に表示される地層、年代、岩相、文献は重要だが、**その画面に地理参照の根拠や採集範囲の階級が出ていないことだけでは、本家DBで項目が空欄とは言えない**。Collection APIの拡張フィールドまたは元入力を確認する必要がある。[Peters & McClennen (2016)](https://doi.org/10.1017/pab.2015.39)、[paleobioDB API wrapper](https://docs.ropensci.org/paleobioDB/reference/pbdb_collections.html)。

## 日本4,770コレクションの未測定値

- `geogscale`の各カテゴリー件数・充足率：未測定。既存の13列加工CSVに列がない。
- `latlng_basis`ごとの件数：未測定。
- 独立地理参照での誤差中央値・閾値内率：未測定。
- 100m、1km、10kmの**実際の座標誤差に応じた地質図帰属率**：未測定。根拠のない数値は代入しない。

## 調査の実装

2022年に抽出した日本コレクションの`collection_no`をキーに、現在のPBDB APIの拡張情報を照合し、公開されている`geogscale`の件数を出す。最新のcollectionと2022年加工済みデータの差・非取得・非公開を区別。APIで値が戻らない項目は、必ずしも入力なしとは断定せず、取得可能性を別集計する。

**取得例（APIの出力を未実行であり特定のフィールド返却は未確認）:** https://paleobiodb.org/data1.2/colls/single.json?id=233240&show=loc,stratext,lithext&vocab=pbdb

