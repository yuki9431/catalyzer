# 設計: レポート出力(AI エージェント向け Markdown)

- ステータス: implemented
- 日付: 2026-11-19
- 関連 issue: #716

## 方針
- 出力形式は **Markdown**。LLM が表と見出しをそのまま読め、人が読んでも分かる。JSON は鍵の意味を別に説明する必要があり、CSV は試合単位で大きく集計をエージェント任せにするため採らない。
- 対象は **全期間・全形式・全機体**。その他画面には絞り込みが見えないため、画面の絞り込みに従わせると何を出したか利用者に分からない。機体別・形式別・日別の表を中に持たせ、絞り込みはエージェント側で読み分けさせる。
- 出口は **その他画面の「レポート出力」欄** の2行(コピー/ダウンロード)。スマホはコピーしてチャットに貼り、PC はファイルで渡す。レポート画面に置くと全画面の基準画像が変わり、絞り込みとの関係も曖昧になる。
- 生成はクリック時に同期で行う(描画のたびに全集計を回さない。clipboard の user activation も保つ)。
- 冒頭に **ゲーム固有の用語説明** を付ける。エージェントはコスト制・覚醒・OL・順落ちを知らないため、無いと数値を誤読する。
- **他プレイヤーの名前・チーム名は出さない**(第三者の情報を外部サービスへ出さない)。固定相方は試合数順に「固定相方A/B…」に置き換える。
- 行数は表ごとに上限を置き(敵機30・自機15・僚機20・編成10・日別14日)、3000試合でも 32KB 未満に収める。少数試合の行は各集計の最小試合数(敵機・僚機5試合)で落とす。

## 変更ファイル
- `static/analysis/report-export.js`(新規): `buildReportMarkdown(matches, tagPartners, now)` → string | null(0試合で null)。stats/coach/match だけを import する純粋関数
- `static/components/shell.js`: MoreView に `buildReport` props と「レポート出力」Panel(RowList の2行)。コピー結果は行の sub 文言で示す。ダウンロードは Blob + `a[download]`
- `static/components/report/report.js`: MoreView に `buildReport` を渡す(allMatches・tagPartners を閉じ込める)。試合なし画面の MoreView は渡さない=欄を出さない
- `tools/ui-check/screens.js`: `more` 画面の required に2行を追加。基準画像は CI(`ui-baseline`)で撮り直す
- `CLAUDE.md`・`README.md`: コード構成に report-export.js を追記

## テスト計画(`static/__tests__/report-export.test.js`)
- 0試合で null / fixture で主要な見出しが全て出る
- fixture の自分・相方・相手のプレイヤー名、チーム名、タグ相方名が出力に含まれない
- 固定相方が「固定相方A」で出る
- 3000試合・敵機200種の合成データで 32KB 未満、敵機の表が30行以内
- 表のセル中の `|` がエスケープされる

## 完了条件
1. `node --test 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js'` が失敗0件(新規テスト5件以上を含む)
2. PR の ui-check CI が成功(`more` 系の基準画像は `ui-baseline` で撮り直して取り込む)
3. Go の変更なし(`git diff --stat origin/develop -- '*.go'` が空)
