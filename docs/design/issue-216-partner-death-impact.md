# 設計書: 被撃墜分析の改善（自分×相方の2軸化） — issue #216

ステータス: 実装中

## 1. 背景

EXVS2IB は 1チーム 6000 コストの共有ゲージ制で、撃墜されるたびに撃墜機体のコスト分ゲージが減る。自分が 0 落ちでも相方が複数回落ちればゲージが尽きて負ける。

現状の `computeDeathsImpact`（`static/analysis/stats.js:477`）は「自分コスト別 × 自分の被撃墜数」だけで勝率をバケット化しており、相方の落ち数が結果に与える影響が見えない。ユーザーは「現状の表は誤解を招く」と指摘し、分析軸を **「自分の被撃墜数 × 相方の被撃墜数」の2軸（回数ベース）** にすることを確定方針とした。各セルで試合数と勝率を表示し、「自分0落ち×相方0落ち」と「自分0落ち×相方2落ち」を区別できるようにする。

承認済み UI イメージ:
```
【被撃墜と勝率（自分×相方）】
自分0落ち
  相方0落ち  8戦 75%
  相方1落ち 20戦 55%
  相方2落ち 12戦 33%
自分1落ち
  相方0落ち 10戦 60%
  ...
```

## 2. 方針（採用案とトレードオフ）

### 決定1: 既存関数の置換 vs 新規追加 → 「新規関数を追加し、旧関数・旧UIは削除」

- **採用**: 新規純粋関数 `computeTeamDeathsImpact(matches)` を追加。既存 `computeDeathsImpact`・UI コンポーネント `DeathsImpactSubSection`・旧テスト（`stats.test.js:331-351`）・関連配線を削除する。
- **理由**:
  - ユーザーが「現状表は誤解を招く」と明言 → 旧ビューと新ビューを同一パネルに併存させると冗長かつ誤解源が残る。1パネル1ビューにする。
  - パネルを外すと `computeDeathsImpact` / `DeathsImpactSubSection` は未使用エクスポートになる。プロジェクト規約「未使用のエクスポート関数は削除する」に従い削除する。
  - 旧関数を残して modify しないのは、返却構造（コスト別 buckets, fatal_cost, danger status）と新構造（2軸セル）が大きく異なり、in-place 改変は差分が読みにくくなるため。関数削除＋新規追加は git 上で可逆。
- **代替案**: (a) issue 本文どおり「追加」して両パネル併存 → ユーザー指摘に反し却下。(b) `computeDeathsImpact` を in-place 改変 → 差分肥大・命名不整合で却下。

### 決定2: コスト別グルーピング → 「外す（コスト横断で集計）」

- **採用**: 自分コストによるグルーピングを廃止し、全コスト横断で 2軸集計する。
- **理由**:
  - 2軸だけで最大 4×4=16 セル。さらにコスト4段階で割ると 64 セルとなり大半が疎（<5戦）になり勝率が不安定。
  - ユーザー承認 UI にコスト表記がなく、方針は明示的に「回数ベース」。
- **トレードオフ/既知の制限**: コスト横断のため「自分2落ち」がコストによって意味（落ちきりか否か）が異なる。この簡略化は Tips に注記する（決定6）。コスト別 fatal 分析が必要なら別 issue とする。

### 決定3: バケット上限と N+ 集約 → 「自分・相方とも 0,1,2,3+ の4段階。空セルは非表示」

- **採用**: 両軸とも `0, 1, 2, 3+`（3 以上を `3+` に集約）。試合数 0 のセルは表示しない。
- **理由**: 共有ゲージ 6000 では、負けに至る合計被撃墜数はおおむね 2〜4。個々の被撃墜が 3 を超えるのは稀で、`3+` 集約で十分。ユーザー UI 例（0/1/2）も包含。

### 決定4: 表示形式 → 「自分被撃墜ごとにネストした表（表のみ、チャートは出さない）」

- **採用**: 外側＝自分の被撃墜バケット、内側＝相方被撃墜の小表（既存 `Table` を流用）。チャートは追加しない。
- **理由**: 既存 `WinRateBarChart` は 1次元前提。2軸を平坦化すると最大16本で煩雑。自分軸のみに周辺化した棒は「誤解を招く」旧ビューの再来になる。承認 UI は表形式。

### 決定6: 少数サンプルの扱い → 「全非空セルを表示。閾値未満は low_sample フラグ＋Tips 注記」

- **採用**: `MIN_SAMPLE = 5`。各セルに `low_sample`（`matches < MIN_SAMPLE`）。試合数を必ず併記し、少数セルがあれば Tips に「5戦未満のセルは参考値」を出す。閾値未満でもセルは隠さない。

## 3. インターフェース

### 新規: `static/analysis/stats.js`

```js
var TEAM_DEATH_MAX = 3;   // これ以上は "3+" に集約
var MIN_SAMPLE = 5;       // これ未満のセルは参考値扱い

// computeTeamDeathsImpact(matches) 返り値:
// {
//   total: number,                 // deaths と partner_deaths が有効な試合数
//   self_max: number,              // = TEAM_DEATH_MAX
//   partner_max: number,
//   groups: [{                     // self 昇順、matches>0 のみ
//     self, self_label, matches, win_rate,   // self の周辺度数・周辺勝率
//     partners: [{ partner, partner_label, matches, win_rate, low_sample }]  // partner 昇順、matches>0
//   }],
//   tips: string[]
// }
export function computeTeamDeathsImpact(matches) { ... }
```

集計ルール:
- 対象は `d.deaths != null && d.partner_deaths != null`（型ガード）。それ以外はスキップ。コスト絞り込みなし。
- バケット化: `bucket(n) = n >= TEAM_DEATH_MAX ? TEAM_DEATH_MAX : n`。
- 勝率は既存 `jsWinRate` + `round1` を再利用。
- ラベル: `k === max ? 'N落ち以上' : 'N落ち'`。
- `groups` は self 昇順、各 `partners` は partner 昇順。matches>0 のセルのみ push。
- Tips: low_sample セルがあれば「5戦未満のセルは参考値です」、コスト横断注記「※コスト横断の回数集計です（落ちきり回数はコストで異なります）」。

### 新規: `static/components/charts.js`

```js
// 旧 DeathsImpactSubSection を削除し置換
export function TeamDeathsImpactSection({ teamDeaths }) { ... }
```

描画: `teamDeaths.groups` を走査。各 group で見出し（`self_label`＋周辺 試合数/勝率）＋内側 `Table`（headers=['相方被撃墜','試合数','勝率']、colorPct 流用）。末尾に `Tips`。空データは `null`。

## 4. 変更ファイルと変更内容

- `static/analysis/stats.js`: 定数 `TEAM_DEATH_MAX`/`MIN_SAMPLE`・関数 `computeTeamDeathsImpact` 追加。`computeDeathsImpact`(:477-552) 削除。`COST_FATAL_DEATHS`/`COST_LABEL` は他利用箇所を grep 確認し、専用なら削除（他で使用なら残す）。
- `static/components/charts.js`: `DeathsImpactSubSection`(:73-84) 削除、`TeamDeathsImpactSection` 追加。旧パネルの `WinRateBarChart` 呼び出しをこのパネルから外す（コンポーネント自体は他タブで使用のため残す）。
- `static/app.js`: import を `computeDeathsImpact`→`computeTeamDeathsImpact`、`DeathsImpactSubSection`→`TeamDeathsImpactSection`。`frontendData.deaths_impact`→`team_deaths: computeTeamDeathsImpact(filtered)`。`PlaystylePane` の被撃墜パネルを新コンポーネントに置換、空判定も更新。
- `static/__tests__/stats.test.js`: 旧 `computeDeathsImpact` describe と import 削除、`computeTeamDeathsImpact` describe と import 追加。
- ドキュメント: `CLAUDE.md`「コード構成」の stats.js 関数列挙（被撃墜影響）を新関数名に更新。`README.md` に同種記述があれば合わせて更新。

## 5. テスト計画（oracle: `make test-js`）

`makeMatch` ヘルパ利用。検証ケース:
1. 2軸バケット化: (deaths, partner_deaths) 組合せを投入し対象セルの matches/win_rate を検証。
2. N+ 集約: deaths:3 と deaths:5 が同一 self:3（ラベル「以上」）に合流。相方軸も同様。
3. 空セル非表示: 投入しなかった組が現れない。
4. 周辺勝率: self 値の matches が配下 partners 合計に一致、win_rate が全体算出。
5. 型ガード: partner_deaths undefined の match が total に含まれずスキップ。
6. low_sample: 4戦で true、5戦で false。少数セルありで tips に注記。
7. 空入力: `computeTeamDeathsImpact([])` が total:0, groups:[]。

UI 目視は `static/preview.html`。

## 6. 完了条件（done-criteria）

1. `computeTeamDeathsImpact` が `groups[].partners[]` に自分×相方2軸の matches/win_rate を返す。
2. PlaystylePane 被撃墜パネルが自分被撃墜ごとにネストした表で各相方被撃墜セルの試合数・勝率を表示。
3. 旧 `computeDeathsImpact`/`DeathsImpactSubSection`/旧テストが削除され未使用エクスポートが残らない（`grep -rn computeDeathsImpact static/`、`grep -rn DeathsImpactSubSection static/` が 0 件）。
4. 新関数のテスト（ケース1〜7相当）が存在。
5. `make test-js` が全緑。
6. `CLAUDE.md`（該当あれば README.md）のコード構成記述を新関数名に更新。
7. gofmt/go build/go test は対象外。

## 7. ナレッジ候補・起票候補

- ナレッジ: 「EXVS2IB は 6000 共有ゲージ制。被撃墜はチーム合計コストで敗因になるため、被撃墜分析は自分単独でなく自分×相方の2軸で見る」というドメイン制約。
- 起票候補: チーム合計被撃墜数（コスト重み付き）の1次元可視化チャート、コスト重み付きゲージ消費モデルに基づく落ちきり判定の重畳（今回スコープ外）。
