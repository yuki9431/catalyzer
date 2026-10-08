# 設計: 負け筋に当てはまった試合を試合検索で見返す

- ステータス: implemented
- 日付: 2026-10-08
- 関連 issue: #391(残りの候補は #524、コストオーバーのミッションは #525)

モック: https://claude.ai/artifact/BhY2Y5bJHPVpdH6isNQ9BZ(ホーム / 挑戦中 / 検索結果 / 絞り込みシート / 試合詳細)

## 1. 方針

### 1-1. 定義の置き場所: 新規 `static/analysis/patterns.js`
| 案 | 利点 | 欠点 |
|---|---|---|
| A. coach.js に置き search.js が import | 移動が少ない | 中立な「試合の展開」が診断モジュールに従属する |
| **B. patterns.js を新設し coach.js と search.js が import(採用)** | 依存が `stats ← patterns ← coach` / `patterns ← analysis/search ← components` の一方向。定義が1か所 | coach.js から判定関数を移す diff が出る |

coach.js の `GOAL_JUDGES` と各 candidate の bad 集合も patterns.js の `test` から導く。ミッション本文の N・リンクの N・検索結果の件数が同じ関数から出るので、一致が構造で保証される。

### 1-2. 検索側の条件は3フィールドに分ける
- `pattern`: シートで選ぶ「試合の展開」(key。`''` は指定なし)
- `goal`: ホームのミッションから渡る goal(`{key, line?, avoid?}`。挑戦中ミッションの保存形と同じ)
- `focusRange`: 挑戦中カードから渡る範囲 `{after, until}`

1フィールドに統合すると、数値基準の goal のときシートの選択が無意味になる。分ければシートは中立な事実、×付きタグは「ホームから来た条件」と役割が分かれる。複数あれば AND。「負け筋」タグを×で外すと focusRange も外す(範囲だけ残ると ✗ 以外の試合まで出て、タグの意味とずれる)。

### 1-3. ホーム → 試合検索の受け渡し
SearchView は view 切替ごとに新しくマウントされる。Report に `searchPreset` を持たせ `initialFilters` として渡し、useState の初期化子だけで使う。view が search 以外になったら preset を消す(タブバーから開いたときは従来どおり空の条件)。検索条件は永続化していないので localStorage は使わない。

### 1-4. 母集団の一致
ホームの `homePlan`(report.js)は「allMatches を selectedMs で絞ったもの」。preset は `emptyFilters()` + `myMsList: selectedMs ? [selectedMs] : []` + `goal`、期間指定なし。母集団は一致する。
既知の制限: リンクを押した後に試合が増えると、ホーム側の line(中央値)は再計算されるが検索側は押した時点の line を持つ。

### 1-5. 挑戦中カードの範囲
`evaluateGoal(goal, targets, 10)` の marks を `(focus.since, until]` で再現する。`until` は marks が10件そろえば `marks[9].date`、未満なら `''`(上限なし)。同じ分に試合は1つしかない(ナレッジ official-detail-url-param-unstable)ので、この範囲はちょうど marks の試合になる。

### 1-6. 「覚醒を抱えたまま落ちた」の境界: `ex.start < 撃墜 <= ex.end`(前提つき)
- スクレイパー `parseMatchTimeline` も `buildActions` も公式の区間を素通しする。撃墜で区間を切る処理は無い。
- `TestParseMatchTimeline` では ex [41.75, 46.25] の終点が exbst-f の開始と一致する(覚醒発動で区間が終わる)。撃墜が端点になるかの根拠はリポジトリ内に無い。
- fixture.js の ex 区間は乱数で根拠にならない。

時刻はセンチ秒に丸めた整数で比べる(`withinSec` と同じ考え方)。撃墜で区間が切れる場合(撃墜 = end)も、ゲージが撃墜をまたいで続く場合(区間の内側)も true。撃墜で得たゲージで区間が始まる場合(start = 撃墜)は false。実データでは未確認(7章)。

## 2. 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `static/analysis/patterns.js`(新規) | 定義一覧 `PATTERNS`(12件)と参照関数。coach.js から `byStart`/`deathsOf`/`burstsOf`/`hasTimeline`/`fallOrder`/`consecutiveFall`/`deathDuringBurst`/`burstBeforeDeath` を移す(中身は変えない)。import は stats.js のみ |
| `static/analysis/coach.js` | 上の関数を削除し patterns.js から import。bad 集合を `testPattern(cond, m) === true` で作る。`candidate()` に `c.matched = bad.length`。`GOAL_JUDGES` を削除し `evaluateGoal`/`isValidGoal` は `goalPattern`/`testPattern` 経由(公開シグネチャは不変) |
| `static/analysis/search.js` | `emptyFilters` に `pattern: ''`, `goal: null`, `focusRange: null`。`hasActiveFilters`/`filterMatches`/`appliedFilterLabels` を拡張。`activeConditions`/`removableFilterLabels` を新設 |
| `static/components/search.js` | `SearchView` に `initialFilters`。シートの「勝敗」の直後に「試合の展開」欄(チップの単一選択。モックどおり)。×付きタグ。`ResultItem` に理由ラベル。`MatchDetail` の上部に一文、`Timeline` に強調する撃墜 |
| `static/components/report/action-plan.js` | 各ミッションに「当てはまった試合を見る N戦 ›」、`FocusCard` に「✗ の試合を見返す N戦 ›」。prop `onShowMatches` |
| `static/components/home.js` | `onShowMatches` を ActionPlanPanel に中継 |
| `static/components/report/report.js` | `searchPreset` state・`showMatches`・view が search 以外で preset を消す effect。`SearchView` に `initialFilters` |
| `static/components/parts.js` | `Chip` に `onRemove`/`removeLabel`(×ボタン。既存呼び出しは不変) |
| `static/styles/parts.css` | `.ui-chip-remove`(タップ領域 44×44px 以上、見た目の高さは負マージンで維持) |
| `static/styles/report.css` | `.action-link`(行全体のボタン、min-height 44px、件数は右寄せ) |
| `static/styles/search.css` | `.search-detail-note`、試合の展開欄のチップ並び、理由ラベルの折り返し |
| `static/styles/gantt.css` | `.gantt-death-hit`(✕ を丸枠で囲む。色はトークン) |
| `static/__tests__/patterns.test.js`(新規)、`coach.test.js`、`search.test.js` | 5章 |
| `tools/ui-check/screens.js`、`check.js`、`preview/seed.js` | 新画面6、START_URL `report-focus`、seed の `?focus=N` |
| `tools/ui-check/baseline/` | 新画面12枚、意図した既存画面の更新 |
| `CLAUDE.md`、`README.md` | 8章 |

app.js と Go は変更しない。

## 3. インターフェース

### 3-1. `static/analysis/patterns.js`
```js
// def = { key, label: string | function(line), sheet?: true, goal?: true, line?: true,
//   test(m, line) → true(当てはまる)/false/null(判定不能), hits?(m) → 強調する自分の death action[],
//   note?: '…{t}…', reason?(m, line) → string }
export var PATTERNS;                    // 下表の順(シートの表示順)
export function hasTimeline(m);
export function findPattern(key);       // hasOwnProperty で引く。未知 key は null
export function goalPattern(goal);      // goal → cond {key, line?} | null
export function testPattern(cond, m);   // true/false/null。cond 無効なら null
export function patternLabel(cond);
export function patternHits(cond, m);   // 自分の death action[](無ければ [])
export function patternNote(cond, m);   // hits が無いか note を持たないなら ''
export function patternReason(cond, m); // hits ありは '撃墜 ' + 時刻を '・' でつなぐ、それ以外は def.reason
export function fmtSec(sec);            // '0:52'(秒は切り捨て、2桁ゼロ埋め)
```

| key | label | sheet | goal | test(true=当てはまる) | null | hits | note | reason |
|---|---|---|---|---|---|---|---|---|
| burst | 1機目で覚醒せず落ちた | ✓ | ✓ | 撃墜があり最初の覚醒が最初の撃墜より前に無い | タイムライン無し | 最初の撃墜 | 覚醒を使う前に {t} で撃墜されています | hits |
| held_burst | 覚醒を抱えたまま落ちた | ✓ | | 撃墜のどれかが ex 区間の `start < t <= end`(センチ秒整数) | タイムライン無し | 該当撃墜すべて | 覚醒を使えるまま {t} で撃墜されています | hits |
| consecutive_fall | 順落ちした | ✓ | ✓ | `consecutiveFall(m)` | チームの撃墜0 | 順落ちペア中の自分の撃墜 | {t} に相方と続けて撃墜されています | hits |
| burst_death | 覚醒中に撃墜された | ✓ | ✓ | `deathDuringBurst(m)` | 覚醒なし・タイムライン無し | 覚醒区間内の撃墜 | 覚醒中に {t} で撃墜されています | hits |
| fall_first | 先落ちした | ✓ | | `fallOrder(m) === 'first'` | fallOrder null | 最初の撃墜 | 相方より先に {t} で撃墜されています | hits |
| fall_second | 後落ちした | ✓ | | `fallOrder(m) === 'second'` | null か 'none' | 最初の撃墜 | 相方より後に {t} で撃墜されています | hits |
| dmg_behind | 与ダメが被ダメを下回った | ✓ | | `dmg_given < dmg_taken` | 数値でない | — | — | 与ダメ {g}・被ダメ {t} |
| deaths | 被撃墜でコストオーバー | | ✓ | `deaths >= COST_FATAL_DEATHS[ms_cost]` | コスト不明 | limit 番目の撃墜 | {t} の撃墜でコストオーバーしています | hits、無ければ 被撃墜 {n}回 |
| dmg_taken | 被ダメ{line}超 | | ✓ line | `dmg_taken > line` | — | — | — | 被ダメ {v} |
| dmg_given | 与ダメ{line}未満 | | ✓ line | `dmg_given < line` | — | — | — | 与ダメ {v} |
| burst_count | 覚醒{line}回未満 | | ✓ line | `bursts < line` | タイムライン無し | — | — | 覚醒 {n}回 |
| ex_dmg | EXダメ{line}未満 | | ✓ line | `ex_dmg < line` | `bursts === 0` | — | — | EXダメ {v} |

- test は移動前の coach.js 判定の否定と全件一致させる(例: burst = `b === null ? null : !b`)。
- `goalPattern`: `fall_order` は avoid 'first' → fall_first、'second' → fall_second、他は null。それ以外は `def.goal === true` のみ通す。line つきは `Number.isFinite(goal.line)` 必須。`{key:'fall_first'}`・`{key:'held_burst'}`・`{key:'valueOf'}` は null(旧 isValidGoal と同じ)。
- 勝率差の表記に pt・ポイントを使わない。

### 3-2. `static/analysis/coach.js`
- `computeActionPlan`: 戻り値は従来どおり + `actions[i].matched`(本文「M戦中N戦」の N)。
- `evaluateGoal`: `cond = goalPattern(goal)`、`t = testPattern(cond, m)` が null でない試合を `{date, ok: !t}` で積む。
- `isValidGoal(goal)`: `goalPattern(goal) !== null`。

### 3-3. `static/analysis/search.js`
```js
emptyFilters()                          // + pattern: '', goal: null, focusRange: null
export function activeConditions(f);     // [goalPattern(f.goal), シートの pattern(def.sheet のみ)] の有効なもの
export function removableFilterLabels(f); // [{field:'goal', label:'負け筋: ' + label}, {field:'focusRange', label:'挑戦中のミッションの試合'}] の有効なもの
appliedFilterLabels(f)                   // 先頭に '試合の展開: ' + label(シート選択時)。goal/focusRange は含めない
hasActiveFilters(f)                      // activeConditions が1件以上 or focusRange 有効
filterMatches(ms, f)                     // 全条件で testPattern === true。focusRange は date > after かつ (until === '' || date <= until)
```
focusRange の有効条件: `after` が空でない文字列、`until` は文字列。

### 3-4. コンポーネント
```js
Chip({ tone, active, onClick, expanded, ui, onRemove, removeLabel, children })
ActionPlanPanel({ plan, selectedMs, matches, userKey, onShowMatches })  // onShowMatches({ goal, focusRange? })
HomeView({ ..., onShowMatches })
SearchView({ matches, msImages, initialFilters })
ResultItem({ ..., reason })               // 空でなければ Chip tone="bad" ui="search-reason"
MatchDetail({ match, msImages, conds, onClose })
Timeline({ match, msImages, hitSecs })    // 自分の行で action_start_sec が hitSecs にある ✕ に .gantt-death-hit / data-ui="gantt-death-hit"
```
- ミッションのリンク: `onShowMatches({ goal: a.goal })`。matched が0なら出さない。
- FocusCard のリンク: `onShowMatches({ goal: focus.goal, focusRange: { after: focus.since, until: marks.length >= FOCUS_SLOTS ? marks[FOCUS_SLOTS - 1].date : '' } })`。✗ が0なら出さない。
- MatchDetail: hitSecs は conds ごとの `patternHits` の和集合。一文は最初に空でない `patternNote`。**詳細画面の上部(4人の比較より前)に注意の帯として** `<p class="search-detail-note" data-ui="match-note">` で置く(モックどおり)。conds が空なら強調も一文も出さない。
- 理由ラベル: `conds.map(c => patternReason(c, m)).filter(Boolean).join('・')`。
- シートの試合の展開欄: 「指定なし」+ sheet の7項目をチップで折り返して並べ、1つだけ選べる(`aria-pressed`、各 44px 以上)。欄の div に `data-ui="search-pattern"`、各チップ `data-ui="search-pattern-item"`。

## 4. UI 文言
| 場所 | 文言 |
|---|---|
| ミッション各項目 | 「当てはまった試合を見る」+ 右寄せ「{N}戦 ›」(`data-ui="mission-matches"`) |
| 挑戦中カード | 「✗ の試合を見返す」+「{N}戦 ›」(`data-ui="focus-review"`) |
| シートの欄 | 見出し「試合の展開」、未選択「指定なし」 |
| 適用中タグ | 「試合の展開: ○○」(×なし)/「負け筋: ○○」(×あり、`search-goal`)/「挑戦中のミッションの試合」(×あり、`search-range`) |
| × の aria-label | 「{タグの文言} を外す」 |

## 5. テスト計画
基線: `node --test ...` pass 385 / fail 0。

### 5-1. `patterns.test.js`(新規)
- 12定義それぞれで true / false / null を1ケースずつ。
- held_burst 境界: 撃墜 = end → true、= start → false、内側 → true、end 57.48 / 撃墜 57.480000001 → true、ex なし → false。
- `goalPattern`: fall_order の対応、`fall_first`/`held_burst`/`valueOf`/line Infinity → null。
- `fmtSec(52.3) === '0:52'`、`fmtSec(125) === '2:05'`、burst の note。
- 規約: key 一意、sheet の label が仕様の7項目と同順で deepStrictEqual。

### 5-2. `coach.test.js`(追加。既存は全件そのまま通す)
- fixture と手組みデータで各 action の `matched` = detail の「(\d+)戦中(\d+)戦」の2つ目 = `testPattern(goalPattern(a.goal), m) === true` の件数。
- `isValidGoal({key:'fall_first'})`・`{key:'held_burst'}` が false。

### 5-3. `search.test.js`(追加)
- 新フィールドと hasActiveFilters、filterMatches(pattern / goal / focusRange の境界)、各ラベル。
- 一致1: fixture の各ミッションで `filterMatches(all, {goal}).length === a.matched`(機体1つの母集団でも)。
- 一致2: evaluateGoal の ✗ 数 = focusRange で絞った件数(marks 10件以上と未満の両方)。

### 5-4. ui-check(6画面・12枚)
START_URL に `'report-focus': '/__preview/?focus=8'`。seed の `?focus=N`: 後ろから N+1 番目の試合の date を since にし `catalyzer_focus` に dmg_given(line L)の挑戦中ミッションを書く。L は fixture で ✗ が1〜7件になる値を node で確かめる。

| id | 概要 |
|---|---|
| `mobile-mission-search` | home から mission-matches の先頭を click → search-goal・search-goal-remove・search-reason・search-total「{N}試合」 |
| `mobile-mission-search-removed` | 続けて search-goal-remove → search-total「60試合」、search-goal absent |
| `mobile-search-pattern` | シートで search-pattern-item「1機目で覚醒せず落ちた」→ apply → search-applied「試合の展開: 1機目で覚醒せず落ちた」、search-reason |
| `mobile-match-detail-hit` | 続けて search-result を click → match-note「覚醒を使う前に」、gantt に scroll して gantt-death-hit が inview |
| `mobile-home-focus` | `report-focus`、clock 固定 → focus-review「✗ の試合を見返す」「{K}戦」 |
| `mobile-focus-review` | 続けて focus-review → search-range、search-goal「負け筋: 与ダメ{L}未満」、search-total「{K}試合」 |

新画面は `node tools/ui-check/check.js --update <6 id>`。意図して変わる既存画面は ホーム系(home, mobile-home, mobile-home-few, mobile-home-last-day, mobile-home-badges, mobile-home-badges-cleared)とシート系(mobile-search-filter, mobile-layer-exclusive, dropdown-search-filter)。落ちた画面がこの部分集合で、差分がリンク・欄だけであることを目視してから `--update`。集合外が落ちたら更新せず原因を調べる。

## 6. 完了条件
| 条件 | コマンド | 期待値 |
|---|---|---|
| JS テスト | `node --test 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js'` | fail 0、pass > 385 |
| 定義のテスト | `node --test static/__tests__/patterns.test.js` | exit 0、tests ≥ 15 |
| UI oracle | `make ui-check` | exit 0 |
| 画面数 | `node -e "import('./tools/ui-check/screens.js').then(m=>console.log(m.SCREENS.length))"` | 61 |
| 基準画像数 | `ls tools/ui-check/baseline/*.png \| wc -l` | 122 |
| 二重実装なし | `grep -cE "function (fallOrder\|burstBeforeDeath\|deathDuringBurst\|consecutiveFall)\b\|GOAL_JUDGES" static/analysis/coach.js` | 0 |
| analysis 層が components に依存しない | `grep -c "components/" static/analysis/{patterns,search,coach}.js` | 各 0 |
| pt を使わない | `git diff origin/develop -- static \| grep -E "^\+" \| grep -cE "[0-9] ?pt\b\|ポイント"` | 0 |
| Go 無変更 | `git diff --name-only origin/develop -- '*.go' \| wc -l` | 0 |
| CLAUDE.md | `grep -c "patterns.js" CLAUDE.md` / `grep -c "55画面" CLAUDE.md` / `grep -c "61画面" CLAUDE.md` | ≥1 / 0 / 2 |
| README | `grep -c "patterns" README.md` | ≥2 |

コードコメントは1行で「なぜ」だけ。判定境界の根拠や一致の証明はこの設計書を参照させる。

## 7. エスカレーション事項
1. **前提(未確定)**: 公式の 'ex' 区間が撃墜で終わるか続くかはリポジトリ内で確定できない。`(start, end]` はどちらでも成り立つが、「撃墜の少し前に区間が切れる」実データだと取りこぼす。マージ前に実データ1試合で ex.end と death の関係を確認し、境界を固定するテストに実数値を1件足す。
2. 不可逆操作・外部公開は含まない(push・PR は main)。

## 8. CLAUDE.md / README の更新
- CLAUDE.md の検証コマンドと tools/ui-check: 「55画面…110枚」→「61画面…122枚」、`?focus=N` を追記。
- コード構成: `static/analysis/patterns.js` を追加(試合の展開の定義一覧。ミッション判定もここから導く。新しい展開は定義1件+テスト1本)。coach.js(判定は patterns.js、`matched`)、analysis/search.js(試合の展開・負け筋・挑戦中の範囲)、components/search.js(試合の展開欄・×で外せるタグ・理由ラベル・✕ の強調と一文)、action-plan.js/home.js(リンク)、parts.js(Chip の onRemove)、__tests__ に patterns。
- README.md: analysis/ に `patterns.js`、__tests__/ に `patterns.test.js`。
