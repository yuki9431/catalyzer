# 設計: 試合検索に自機の熟練度・階級・スコア順位の絞り込みを追加

- ステータス: implemented
- 日付: 2026-11-16
- 関連 issue: #361

フロントのみ。MatchData の proficiency / grade(omitempty) / opponent1_grade / opponent2_grade / score_ranking は実装済み(internal/pipeline/matchdata.go:75-96)。

## 1. 方針

### 熟練度
- class 名の数字は帯内の段。blueN(0〜5)=⭐N、bronzeN=⭐(5+N)、silverN=⭐(10+N)、goldN=⭐(15+N)。その上が master、最上位が legend。本番 DB 全体の集計(一時スクリプト、2026-11-16)で値はこの24種と空のみと確認
- 想定外の値は生値のまま表示し、ランク順の末尾(名前順)に置く。落とさない・壊さない
- 表示: ⭐6〜20 は `⭐N`、master は `Master`、legend は `Legend`、空/undefined は `''`
- 並び: legend → master → ⭐大きい順 → 未知。出現頻度順にしない
- 選択肢は「実データにある値だけ・試合数つき」

### 階級の段の共有
- 案A(採用): stats.js の `OPPONENT_GRADE_BANDS` と `gradeBand` に `export` を付けるだけ(2行)。search.js は既に stats.js から PERIOD_DAYS を import しており依存が増えない。open PR #662(173行・923-961行)と重ならない
- 案B(不採用): static/lib/grade.js へ移動。stats.js の差分が大きくなり衝突しうる
- 弱点: 自分の階級にも名前が OPPONENT_ の定義を使う(改名は影響が広いので見送り)

### 階級の対象・段
- 対象は 自分 と 相手(2人平均。既存 opponentGradeBand と同じ Math.floor、片方不明なら null)。相方は見送り(起票候補)
- 段は 7 段(OPPONENT_GRADE_BANDS)。選択肢は固定(COST_OPTIONS と同じ作り)

### スコア順位
- 自分の順位 1〜4 の複数選択・OR。固定選択肢(値は '1'〜'4'、比較は .map(Number))。0(不明)は選択肢に出さない

### 欠落フィールド
- 条件未指定なら除外しない。指定時は除外(grade 欠落→gradeBand null、順位 0、熟練度 空は indexOf で不一致)。テストで固定

### 置き場所
- 4項目とも「詳細な条件」内の「相手コスト編成」直後(半幅)。既存画面は詳細条件を開いた状態を撮っておらず、既存の基準画像は変わらない。条件が入っていれば ADV_LIST_FIELDS により枠が開き「適用中」バッジが出る

### ui-check(運転者による修正)
- 新画面 mobile-search-proficiency を足す(詳細条件と熟練度のドロップダウンを開いた状態)。基準画像は PR の ui-baseline ラベルで CI が撮り、取り込むまで screens.test.js の基準一致1件は既知の失敗
- fixture の自機 proficiency は乱数を消費せず試合番号 i%5 で5値を回す(並び順を画面で確かめるため。描画は検索UIのみで既存基準は不変)

## 2. 変更内容
- static/analysis/stats.js: 340 と 357 行に export を付ける(他は触らない)
- static/analysis/search.js
  - import に OPPONENT_GRADE_BANDS, gradeBand, opponentGradeBand を追加
  - 新規 proficiencyRank(非 export: bronze/silver/gold 1-5 → 6..20、master=21、legend=22、他 null)、proficiencyLabel(export)
  - emptyFilters に myProficiencyList / myGradeList / enemyGradeList / scoreRankList(各 [])
  - hasActiveFilters の listKeys に 4 キー追加
  - collectMsOptions に proficiencies: tally 結果に label を付け序列順(rank 大が先、片方のみ有るなら有る方が先、双方 null は localeCompare)
  - filterMatches: 熟練度は indexOf(m.proficiency)、自分階級は gradeBand(OPPONENT_GRADE_BANDS, m.grade)、相手階級は opponentGradeBand(m)、順位は Number 化して m.score_ranking
  - appliedFilterLabels: 相手コスト編成の後・RANGE_LABELS の前に `自機の熟練度:` `自分の階級:` `相手の階級:`(段の label)`スコア順位: N位`(listLabel 形式)
- static/components/search.js: MsMulti の表示を o.label || o.name に、ADV_LIST_FIELDS に 4 キー追加、GRADE_OPTIONS / RANK_OPTIONS 定数、FilterFields に半幅 4 欄(熟練度|順位 / 自分の階級|相手の階級。data-ui: search-proficiency / search-rank / search-my-grade / search-enemy-grade)
- static/__tests__/search.test.js: テスト追加、既存 empty ケース(:81)の deepEqual に proficiencies: [] を足す
- CLAUDE.md: static/analysis/search.js の説明に熟練度(proficiencyLabel)・階級・スコア順位を追記。画面数を 76画面・152枚に更新
- tools/ui-check/screens.js: 画面 mobile-search-proficiency を追加 / fixture.js: 自機 proficiency を i%5 で5値ローテーション

## 3. テスト計画(search.test.js に追加)
1. proficiencyLabel: bronze1→⭐6, bronze5→⭐10, silver5→⭐15, gold2→⭐17, gold5→⭐20, master→Master, legend→Legend
2. proficiencyLabel: 'foo'・'gold6' は生値、''/undefined は ''
3. collectMsOptions.proficiencies の序列(legend, gold1, silver3, aaa, zzz。空は出ない。label・matches も確認)
4. myProficiencyList の OR 絞り込み
5. myGradeList: 41→inf、39→e1、38→e1/37→e4 境界、25→ace
6. enemyGradeList: 平均 floor、片方欠落は除外
7. scoreRankList ['1','2']: 1,2 が残り 0/undefined は除外
8. 欠落: 旧キャッシュ試合は 4 条件のどれか指定で除外、全て空なら含まれる
9. appliedFilterLabels に 4 ラベル(`自機の熟練度: ⭐17 ほか1` 等)
10. 4 キー空ならラベル無し
11. hasActiveFilters: 各キー 1 件で true

## 4. 完了条件
| # | 検証コマンド | 期待値 |
|---|---|---|
| 1 | PATH に node shim を前置して `make test-js` | 基準画像取り込み前は `# fail 1`(mobile-search-proficiency の基準一致のみ)、取り込み後 `# fail 0` |
| 2 | `go test -race ./internal/...` | 全 pkg 成功 |
| 3 | `git diff -U0 origin/develop -- static/analysis/stats.js \| grep -c '^[-+][^-+]'` | 4 |
| 4 | `git diff --name-only origin/develop -- tools/ui-check ':!tools/ui-check/baseline'` | `fixture.js` と `screens.js` の2行 |
| 5 | `git diff --quiet origin/develop -- static/__tests__/stats.test.js` | exit 0 |

レビュー観点(完了条件ではない): Master/Legend の英語表記、置き場所、OPPONENT_ 名の流用、半幅ラベルの折り返し(CI の UI oracle)。

## 5. エスカレーション
該当なし。
起票候補: 相方の階級フィルタ / 試合詳細への熟練度表示
