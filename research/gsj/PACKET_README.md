# GSJ 再検証パケット — 実測データと偽陽性を分離する

## 重要な結論

以前の `gsj_pilot_15_results.json` は**実測結果として不採用**。

- 名称は15件だが実際は11行、コレクションIDが `p1`～`p11` でPBDBコレクションIDではない。
- 11座標はいずれも以前の日本4,766件の元座標に一致しない。最も近い実コレクションまで0.241～25.027 km。
- 北海道～九州の別々の地点が原点・丸め後すべて `Ca-O_mscpe_hc` で一致する。不自然なためAPI生応答なしで信頼できない。
- **「GSJで0/11件変更」は主張してはいけない。** `rejected_pilot_11_audit.json` を参照。

## 同梱ファイルと検算

- `data/macrostrat_changed_real15.csv`：**Macrostratで変化した実在15コレクション**、11種類の元座標。例 `101735`, `127345`, `129652` など。GSJの選抜事例パイロット用。
- `data/jp_real_4766.csv`：日本4,766コレクション、4,766行、元座標2,480種類。Macrostratで元・丸めの両側マッチ3,862件、そのうちポリゴン変更15件。GSJ全体比較用の母集団。
- `scripts/gsj_fetch_verified.py`：Python標準ライブラリのみでGSJ APIの本物の応答を問い合わせ、根拠URL・時刻・生JSON・sha256をキャッシュ、再開可能。
- `tests/test_gsj_fetch_verified.py`：完全オフラインの検算テスト6件。
- `rejected_pilot_11_audit.json`：以前の疑わしいファイルの監査記録。

※以前の4,770件／2,484座標は元の日本抽出全体。ここでの4,766件／2,480座標はMacrostrat計算で使用した別の入力集合。**両者を混同しないこと**。

## 実行方法（プロジェクト直下で）

Python 3.9以上。pip install不要。

```bash
# 1. 正しい入力とロジックを確認（オフラインで実行できる）
python3 -m unittest discover -s tests -v

# 2. GSJの3地点の生応答を検査（実際にネット接続する）
python3 scripts/gsj_fetch_verified.py --probe --output research/gsj/probe

# 3. Macrostratで変化した本物の15コレクションについて照合
python3 scripts/gsj_fetch_verified.py --input data/macrostrat_changed_real15.csv --output research/gsj/selected15

# 4. Macrostrat母集団から本物の30コレクションを試験取得
python3 scripts/gsj_fetch_verified.py --input data/jp_real_4766.csv --limit 30 --output research/gsj/first30

# 5. 日本4,766コレクションを全件照合（必要なら時間を分けて同じコマンドで再開）
python3 scripts/gsj_fetch_verified.py --input data/jp_real_4766.csv --output research/gsj/full4766
```

`--output`ごとに `gsj_probe_raw.json`, `response_cache/*.json`, `gsj_per_collection.csv`, `gsj_summary.json` を生成する。取得できなかった点は `unknown` とし、変更しなかったとみなさない。

**安全チェック：** GSJの公式ドキュメント例 `point=39.700038,141.149898` の `symbol` は `K12_pim_a`（2026年11月確認）。APIが同じ既定値を返すなど、3地点の結果が不自然であれば**解析を停止する**。このチェックは最低限であり、全件の真正性の保証にはならない。

URL: https://gbank.gsj.jp/seamless/v2/api/1.3.1/legend.json?point=39.700038,141.149898

### 厳密な解釈

- `GSJ symbol changed` は**凡例記号の変化**。GSJの**個別ポリゴンの変化ではない**。
- `GSJ formationAge_ja changed` は**凡例の年代ラベル文字列の変化**。化石の実年代との一致・不一致を計算したわけではない。
- `selected15` は最初からMacrostratで変化した15件を選んだ**条件付きサンプル**。そのGSJ変更率を「日本全体のGSJ変更率」と表現しない。
- `first30` は動作確認の最初の30件。統計的に代表性がない。全国率は全4,766件のうち**GSJ両点の取得に成功したコレクション**を分母として別途報告し、未マッチ数も明記する。
- 本データで「GIS地質図の詳細さが変化率を決めた」「化石記録が誤登録」は証明できない。
- 地質境界までの距離は、地質図ベクトルデータが必要であり、このAPI応答だけでは計算不可。**未計算のままにする**。
- API応答の利用条件・アクセス負荷を守り、全件処理は間隔設定とキャッシュを使う。

## GitHub Pagesに反映する条件

- `gsj_probe_raw.json` でAPIのテストが通り、本物の `collection_no` に紐づく取得結果があること。
- `gsj_per_collection.csv` と `gsj_summary.json` で何件成功／未マッチ／失敗かが確認できること。
- `site_summary.json` を「パイロット完了」とするのは、**本物の対象集合に対して検査が完了し、凡例変更率の分母と対象集合を明示**できた場合だけ。
- ネットワークなしならコードはリポジトリに残し、UIは「GSJ未検証」、READMEにも未検証と書く。**架空の数値で埋めない**。
