# Codexへの最初の指示（GitHubリポジトリ接続済み）

いまから10分以内にGitHub Pagesへ公開したいです。添付ZIPの中身は **site/などの上位フォルダなしで、そのままリポジトリ直下に置ける完成済みサイト** です。

1. 接続済みリポジトリの現在のファイルを確認し、既存ファイル・コミット履歴を破壊しない。
2. 添付ZIPの中身をリポジトリ直下に反映する。README.md、build.mjs、package.json、docs/、data/、scripts/、tests/、research/、.github/workflows/pages.yml を含む。**今回のREADME.mdはIMRAD（Introduction→Methods→Results→Discussion）に修正済み。最優先でこの版を採用し、別の文章で上書き・要約・セクション構造を変更しない。** 古いREADMEは `research/README_旧版_20261110.md` に保存済み。無関係な研究成果も消さない。
3. `python3 -m unittest discover -s tests -v` と `npm run build` を実行する。
4. `docs/index.html` と `docs/explorer.html` が生成・存在することを確認。後者でPBDBコレクション番号検索・元座標と丸め後座標の地図表示が可能。15件は日本でMacrostratが変わった実測事例であり、GSJのデータではない。
5. `.github/workflows/pages.yml` はGitHub Pages自動デプロイ用。デフォルトブランチが `main` でないときはworkflowのbranchesを合わせる。既存のPages設定が競合する場合は適切に調整する。
6. コミット・push後、GitHub Actions「Deploy Fossil Overlay Audit to GitHub Pages」の成否を確認し、可能なら公開URLにアクセスして表示を確かめる。権限の制限がある場合だけ、必要なGitHub設定操作を具体的に示す。
7. **GSJのAPIが不通なら追加の取得を強要しない。** READMEのResults §3.5には、試したコマンド、オフラインテスト6件成功、APIのDNSエラー、15→30→4766件が未実行でGSJ数値が未取得であることを明記済み。この**試行と結果の監査記録を絶対に削らない**。未取得や地質境界距離の数値を捏造しない。4,770件、122地点、3,848ペア等の過去の解析と先行研究注釈がresearch/内にあるので消さない。
8. 完了報告は公開URL、コミットID、テスト結果、未完了事項のみ。追加の研究計画・提案は不要。**ただの計画書を返さず、実際にpushして公開すること。**

※ZIPにはNode依存ライブラリを追加していない。`npm run build` はnode 18+で動く。探査画面のLeafletとOpenStreetMap背景地図だけはブラウザ側のインターネット接続が必要。読み込めない場合でも個別レコード表とOSMへのリンクは利用できる。

**研究報告の整理**：READMEの主文はIMRAD。Introductionに必要性・地図利用者への寄与、Methodsに試した方法、Resultsに成功数値・失敗ログ・未取得の対象、Discussionに解釈と限界を配置済み。ResultsとDiscussionを混ぜたり、失敗を無かったことにしない。
