# 設計書: 敵機ごとの対策メモ(段階1〜3) — issue #389

- ステータス: 段階1 単位1〜5 実装完了。段階2(#689、§13)実装完了(レビュー2周で収束)。段階3(#690、§14)実装完了(レビュー2周で収束)。基準画像の取り込みは CI の ui-baseline 後
- 日付: 2026-11-16
- 関連 issue: #389(単位1 = #668、単位2〜4 = #669〜#671、単位5 = #684、段階2 = #689、段階3 = #690)
- 対象: catalyzer(既定ブランチ develop。調査は origin/develop d23aaec)

## 0. 用語(表示文言)
ナレッジ ui-terminology に従い、要求文の「相手機体」は表示上 **敵機** と書く(「敵機体」「相手機体」は使わない)。
自分の機体は **自機**。コード識別子(`enemies`・`my_ms`)は英語のまま。画面に「紐付け先」「種類」という語は出さない(単位5)。

---

## 1. 方針

### 1.1 データの置き場所: `notes/{userKey}/items/{id}` に1件1ドキュメント(採用)

| 案 | 一覧の読み取り | 件数・ピン上限の判定 | 欠点 |
|---|---|---|---|
| A. `notes/{userKey}` 1ドキュメント + `items` map | 1回 | 読んで書くだけで厳密 | 1ドキュメント 1MiB の上限(500文字×2000件は約4MB で収まらない) |
| **B. `notes/{userKey}/items/{id}` 1件1ドキュメント(採用)** | 件数分(最大2000) | トランザクション内の count 集計(下記) | 起動ごとに件数分の読み取り |

採用理由: 件数上限を2000件にするには A の 1MiB に収まらないため B にする。集計は全件読み(最大2000読み取り/書き込み)ではなく count 集計を採る。count は 1000 index entry につき1読み取りなので書き込み1回あたり数読み取りで済み、全件読みと同じく同じトランザクション内なので2端末同時保存でも上限を超えない。ピン数は `pinned==true` の count(単一フィールドの自動インデックスで足り、複合インデックスは要らない)。
GET /notes は items を全件読む(起動ごとに件数分。件数が増えたら段階2以降で差分取得を検討)。IAM は `roles/datastore.user` がプロジェクト単位で付いているので(infra/shared/iam.tf)、infra の変更は要らない。


### 1.2 保存の単位: 1件ごとの API(採用)

| 案 | 長所 | 短所 |
|---|---|---|
| 全件置換 `PUT /notes`(配列ごと) | サーバーが単純 | 2端末で編集すると後勝ちで片方が消える(版の管理が要る)。保存のたびに最大数百KBを送る。差分の検証ができない |
| **1件ごと `POST /notes`・`PUT /notes/{id}`・`DELETE /notes/{id}`(採用)** | 送るのは小さな1件だけ。他の端末の編集を消さない。上限はサーバーのトランザクションで判定する | エンドポイントが3つになる |

サーバー内部は「対象と件数を読む→上限を判定→その1ドキュメントだけ書く」を1トランザクションで行う。

### 1.3 フロントの状態: Report が持ち、メモリだけに置く
- 取得は `Report` の中の `useNotes` フック。IndexedDB・localStorage には保存しない。ログアウトは `render(null, #report)` で Report が外れるのでメモも消え、端末に何も残らない(`clearUserState` の変更は要らない)。
- 通信は auto-refresh と同じく app.js に置き、`REPORT_ACTIONS.notes` で props として渡す(report/ から app.js を import しない規約)。純粋ロジックは `static/lib/notes.js`(import なし)。
- 「書くシート」は Report に1つだけ描く。どの入口から開いても同じ部品になる。

### 1.4 ログイン状態を保持していない人
メモ API はセッション Cookie で本人を特定するため、「ログイン状態を保持する」を選ばなかった人には使えない(自動更新と同じ制約)。
このときは試合詳細・試合検索・相性タブには何も出さない。その他画面のメモ行だけで「ログイン状態を保持すると使えます」と案内する(→ 要判断 2)。
この扱いにすると、既存の ui-check 画面(start `report` はセッション無し)のうち基準画像が変わるのはその他画面の5枚だけになる。

### 1.5 その他の決定
- 📝印は絵文字ではなくインライン SVG のアイコンで描く。CI の撮影環境には `fonts-noto-cjk` しか入っておらず(ui-check.yml)、絵文字が豆腐になる可能性があるため(→ 要判断 5)。
- 全画面の層 `Layer` を search.js から popover.js へ移し、重なったときは**最上位の層だけが Esc で閉じる**ようにする。書くシートは試合詳細・メモ一覧の上に重なる。今の `useDismiss` は全部の層が document の keydown を聞いているので、そのままだと Esc 1回で下の層まで閉じる。
- 削除の確認は `window.confirm` を使わず、行内に「削除する/やめる」を出す。ui-check は confirm で止まるため(ナレッジ ui-check-headless-chrome-determinism)。
- 表示はすべて Preact のテキスト補間で行う。`dangerouslySetInnerHTML`・`innerHTML` は使わない(静的検査テストで固定する)。改行は CSS の `white-space: pre-wrap` で保つ。

### 1.6 外部の定石
確立済みのアーキテクチャへの機能追加なので、内部パターンに合わせる(autoRefreshAPI の store interface + 依存注入、tag-partners の本人確認、auto-refresh の props 注入)。外部の定石は引かない。

### 1.7 単位5: 種類をやめ、日付・敵機・自機を独立した任意の属性にする(採用。ユーザー合意 2026-11-16)

| 案 | 長所 | 短所 |
|---|---|---|
| A. kind を残し、kind=enemy に敵機の配列を足す | 差分が小さい | 「日付と敵機の両方」を持てない。シートに「紐付け先」の切り替えが残る |
| **B. kind を廃止し、日付(任意)・敵機0〜5機(任意)・自機(任意)を独立に持つ(採用)** | 1件のメモが日付と複数の敵機を同時に持てる。シートから切り替えが消える | API・保存形式・フロントの抽出関数を全部変える(保存済みのメモが無いので移行は不要) |

細部の決定:
- **敵機は OR で試合に当てる**: 敵機を複数持つメモは、どれか1機がいる試合に出す(`notesForEnemy` が `enemies` に含むかで判定するので、`notesForMatch`・`hasNoteForMatch`・試合検索の絞り込みは呼び出しを変えずに OR になる)。
- **試合詳細・メモ一覧の敵機タブでは、当てはまる敵機それぞれの下に出す**: 試合の相手2機が両方メモの敵機に入っていると、同じメモが2つの見出しの下に出る。1回だけ出す案は「どの見出しの下に出すか」の規則が別に要るので採らない(`groupByEnemy` と同じ規則にそろえる)。
- **上限5機・重複不可**。上限はサーバーの定数 `noteEnemiesMax` の1か所に置き、`GET /notes` の `limits.enemies_max` でフロントに渡す(他の上限と同じ。フロントに数値を持たない)。重複は書くシートで他の欄の機体を選択肢から外して作らせず、`validateDraft` とサーバーでも拒否する。
- **未選択の敵機の欄は保存しない**: 「＋ 敵機を追加する」で足して選ばなかった欄は `draftToRequest` で落とす(保存を止めない)。サーバーは空の敵機を 400 にする(UI からは届かない)。
- **日付の既定**: 試合詳細から書くときはその試合のプレイ日(`playDay(match.date)`。朝5時切替)、相性タブ・メモ一覧からは今日のプレイ日(`currentPlayDay(new Date())`)。× で空にできる。`lib/notes.js` は import を持たないので、日付を決めるのは `components/notes.js` の `matchDraft`・`todayDraft`(§5.2)。
- **自機だけのメモも保存できる**: 試合詳細・相性タブは敵機で引くので、敵機の無いメモ(自機だけ・日付だけ・何も無い)はメモ一覧にだけ出る。自機の絞り込み規則(`my_ms` が空か一致)は今のまま。
- 保存済みのメモは無い(画面は未デプロイ)ので、データ移行・旧フィールドの互換は作らない。Firestore の `DataTo` は struct に無いフィールドを読み飛ばす(cloud.google.com/go/firestore v1.29.2 `from_value.go` の `populateStruct`)ので、仮に旧形式の文書が残っていても一覧の読み込みは失敗しない(旧 `enemy_ms` は無視され、敵機の無いメモになる)。

---

## 2. データモデル

### 2.1 Firestore
```
notes/{userKey}/items/{id}    // userKey = SHA256(email)[:8] の16進。id = サーバーが生成する UUID v4(ドキュメント ID)

NoteDoc
  text:       string    // 1〜500文字(rune)。前後の空白を除き、CRLF→LF
  enemies:    []string  // 0〜5機(任意)。各1〜64文字、前後の空白を除く、重複なし、選んだ順。無ければ空配列(null にしない)
  my_ms:      string    // 0〜64文字(任意)。"" = 指定しない
  date:       string    // "" または "YYYY-MM-DD"(任意。プレイ日。朝5時で切り替え)
  pinned:     bool      // 全体で最大3件
  created_at: timestamp
  updated_at: timestamp
```
- 日付・敵機・自機はどれも任意で、組み合わせに制約は無い(3つとも空のメモも保存できる)。
- `enemies` で検索するクエリは無い(一覧は全件読んでフロントで引く)ので、インデックスの追加は要らない。

### 2.2 上限(サーバーが正。GET の応答 `limits` でフロントに渡し、フロントに定数を重複させない)
| 項目 | 値 | 超えたとき |
|---|---|---|
| 本文 | 500文字(rune、正規化後) | 400 |
| 件数 | 2000件/ユーザー | 409 |
| ピン | 3件/ユーザー | 409 |
| 敵機 | 5機/メモ(`enemies_max`)。重複は不可 | 400 |
| 機体名 | 64文字(敵機の各機体・自機) | 400 |
| リクエスト本文 | 8KiB | 400 |
| 書き込み回数 | ユーザーごとにバースト30・2秒に1回回復 | 429 |

---

## 3. API

すべてセッション本人だけ。クエリの `user_key` は受け付けない(#461 と同じ)。

| メソッド・パス | リクエスト | 成功 | 内容 |
|---|---|---|---|
| `GET /notes` | なし | 200 `{"user_key","notes":[Note…],"limits":{"text_max":500,"count_max":2000,"pinned_max":3,"enemies_max":5}}` | `updated_at` の新しい順、同じなら id の昇順 |
| `POST /notes` | `NoteRequest` | 201 `{"note":Note}` | 作成。id・日時はサーバーが付ける |
| `PUT /notes/{id}` | `NoteRequest` | 200 `{"note":Note}` | 編集できる項目を丸ごと置き換える。`created_at` はそのまま |
| `DELETE /notes/{id}` | なし | 200 `{"ok":true}` | 削除 |

- `NoteRequest` = `{"text","enemies":[string…],"my_ms","date","pinned"}`。`enemies` の省略・`null` は `[]` として扱う。配列でない `enemies` は JSON の型違いで 400 `Invalid request body`。知らない項目(旧 `kind`・`enemy_ms` を含む)は無視する
- `Note` = `NoteRequest` + `"id"`・`"created_at"`・`"updated_at"`(RFC3339)。応答の `enemies` は常に配列(敵機が無ければ `[]`。`null` を返さない)

判定の順序(上から順に見て、最初に当たったものを返す):
1. メソッド違い → 405(`/notes` は GET/POST、`/notes/{id}` は PUT/DELETE)
2. Cookie が無い/セッションを解決できない → 401 `ログイン状態が保持されていません`
3. 書き込みだけ: ユーザー単位のレート制限 → 429 `保存の回数が多すぎます。しばらく待ってからお試しください`
4. POST/PUT だけ: Content-Type が `application/json` でない → 415。SameSite=Strict に加えて、フォームからの送信を断つ(同じサイトの別サブドメインからの CSRF 対策。数行で済む)
5. `/notes/{id}` の id が UUID として読めない、または後ろにパスが続く → 404 `メモが見つかりません`
6. 本文を読めない(8KiB 超・型違いを含む) → 400 `Invalid request body`
7. 入力検証(`validateNote`)に落ちた → 400。正規化(本文は CRLF→LF と前後の空白除去、敵機の各機体と自機は前後の空白除去)の後、次の順に見る:
   1. 本文が空 → `メモの本文を入力してください`
   2. 本文・敵機のどれか・自機に改行とタブ以外の制御文字 → `使えない文字が含まれています`
   3. 本文が500文字超 → `メモは500文字までです`
   4. 敵機が `noteEnemiesMax` 機超 → `敵機は5機までです`
   5. 空の敵機がある → `敵機を選んでください`
   6. 敵機のどれか・自機が64文字超 → `機体名が長すぎます`
   7. 敵機が重複している → `同じ敵機が重複しています`
   8. 日付が空でなく、`YYYY-MM-DD` として読めないか桁あふれ(`2026-02-30`) → `日付の形式が正しくありません`
8. 保存処理のエラー: `ErrNoteNotFound` → 404、`ErrNoteLimit` → 409 `メモは2000件までです。不要なメモを削除してください`、`ErrPinLimit` → 409 `ピン留めは3件までです`、それ以外 → 500 `メモを読み込めませんでした` / `メモを保存できませんでした` / `メモを削除できませんでした`(数値はすべて定数から Sprintf で作る)

単位1〜4 の `kind`(`enemy`/`date`/`free`)・`enemy_ms` と、文言 `メモの種類が正しくありません`・`メモの種類と紐付け先が合いません` は単位5で廃止する。

---

## 4. 変更ファイルと変更内容

### 4.1 Go(単位1)
- `internal/model/types.go`: `Note` 型と kind 定数 `NoteKindEnemy="enemy"`・`NoteKindDate="date"`・`NoteKindFree="free"` を足す(JobStatus の定数と同じ置き方)。kind 定数は単位5で削除(§4.4)。
- `internal/firestore/notes.go`(新規): `notes/{userKey}/items/{id}` の読み書き。作成・更新は `RunTransaction` の中で、対象を `tx.Get`、件数は `items` の count 集計(`NewAggregationQuery().WithCount().Transaction(tx)`)、ピン数は `Where("pinned","==",true)` の count 集計で数え、`checkCreate`・`checkUpdate` で判定してから `tx.Create`・`tx.Set` する(自分の除外は checkUpdate の中)。削除は `tx.Get` で存在確認して `tx.Delete`。判定規則は純粋関数に切り出し、エミュレータなしでテストする。
- `internal/firestore/notes_test.go`(新規)
- `internal/server/notes.go`(新規): `notesAPI`(store interface・`loadSession`・`limiter`・`now`・`newID` を注入する。`autoRefreshAPI` と同じ形)、`validateNote`、`registerNotes(mux)`。上限は定数で持つ(`noteTextMax=500`・`noteCountMax=2000`・`notePinnedMax=3`・`noteMSMax=64`・`noteBodyMax=8<<10`)。
- `internal/server/notes_test.go`(新規): fake store で HTTP の振る舞いを検証する。
- `internal/server/server.go`: `registerAutoRefresh` の隣に `registerNotes(http.DefaultServeMux)` を1行足す。
- `internal/server/session_scope_test.go`: `TestDataAPIsRequireSession` の対象に `/notes`(`newNotesAPI().handleNotes`)を足す。

### 4.2 フロント(単位2〜4)
- `static/lib/notes.js`(新規・import なし・単位2): 純粋関数(§5.2)。
- `static/components/notes.js`(新規・単位2〜4で育てる): `useNotes`・`NoteSheet`・`MatchNotes`・`NoteMark`・`NoteItem`(単位2)、`EnemyNotes`(単位3)、`NoteList`(単位4)。import してよいのは popover.js・parts.js・ui.js・lib/notes.js・analysis/today.js だけ(search.js・charts.js から import されるため、循環を作らない)。
- `static/components/popover.js`(単位2): search.js の `Layer` をそのまま移して export する。重なりの管理を足す(§5.3)。マークアップ・クラス名は変えない(ui-check の画素一致を崩さない)。
- `static/components/search.js`(単位2・3): `Layer` は popover.js から import する。`SearchView` に `notes` props を足す。`MatchDetail` に「敵機のメモ」パネル(単位2)、`ResultItem` に印・`FilterFields` に絞り込みのチップ(単位3)。
- `static/analysis/search.js`(単位3): `emptyFilters` に `noteEnemies: false`。`filterMatches(matches, filters, notes)` に第3引数を足す。`hasActiveFilters`・`appliedFilterLabels` を対応させる。
- `static/components/charts.js`(単位3): `WinRateRowList({ entries, onSelect })`。entry に `mark`(true で印を出す)と `expand` を足す。どちらも省略したときは今と同じ DOM になる。
- `static/components/report/matchup.js`(単位3): `MatchupPane({ frontendData, lens, notes, selectedMs })`。得意・苦手な敵機の行に印を付け、タップで行内を開く(`EnemyNotes`)。
- `static/components/report/report.js`(単位2〜4): `useNotes(userKey, actions.notes, data)` を呼ぶ。`SearchView`・`MatchupPane`・`MoreView` に `notes` を渡し、search・report・more の各 view で AppShell の子の末尾に `<${NoteSheet} notes=${notes} choices=${noteChoices} />` を描く。`noteChoices = useMemo(msChoices(msImages, allMatches))`。
- `static/components/shell.js`(単位4): `MoreView` に `notes` props(省略可)と「メモ」パネル。
- `static/app.js`(単位2): `autoRefreshCall` を `apiCall(method, path, body)` にして使い回す(auto-refresh は `apiCall(method, '/auto-refresh', body)`)。`NOTES_ACTIONS` を作り `REPORT_ACTIONS.notes` に入れる(§5.1)。
- `static/styles/notes.css`(新規・単位2): メモ部品のスタイル。`static/index.html` と `tools/ui-check/preview/parts.html` の両方で `responsive.css` の直前に link を足す(screens.test が両方の並びの一致を検査している)。文字は14px 以上、色は tokens.css の定義だけを使う。
- テスト: `static/__tests__/notes.test.js`(新規)、`popover.test.js`・`search.test.js`・`skeleton-actions.test.js` に追記。

### 4.3 ui-check
- `tools/ui-check/fixture.js`: `notes()` を足す(単位5で §4.4 の6件に置き換え)。架空の6件(kind enemy 4件=ストームレイダー2件・ヴァルキュリア1件・ガルーダ零1件(単位3で足した。`computeEnemyMatchup` の苦手に入る敵機)で、うち1件は `my_ms` 付き、date 1件 `2026-06-15`、free 1件。ピンは1件。日時は固定の ISO 文字列)。敵機は fixture の機体名から、§7 の fixture テストを満たすものを選ぶ。
- `tools/ui-check/server.js`: `/notes` のモック(状態は持たない)
  - `GET /notes`: Cookie `preview_session=valid` があれば `fixture.notes()`、無ければ `notes: []`。**どちらも 200**。401 を返すと、`?session=1` で始まる既存画面(session-expired)で Report の取得が console エラーになり、その画面が落ちるため。`limits` は `{text_max:500,count_max:2000,pinned_max:3}`
  - `POST /notes`: 本文の text に `保存エラー` を含めば 500 `{error:'メモを保存できませんでした'}`。それ以外は 201 で、本文に `id:'preview-note-new'` と固定の日時を足して返す
  - `PUT /notes/{id}`: POST と同じ規則で 200
  - `DELETE /notes/{id}`: 200 `{ok:true}`
  - 既存の `if (!get) return 405` より前に置く
- `tools/ui-check/screens.js`: §6.6 の画面を足す。
- `tools/ui-check/server.test.js`・`fixture.test.js`: 追記(§7)。

### 4.4 単位5: 日付と複数の敵機を両方持てるようにする
4.1〜4.3 は単位1〜4 の変更の記録。単位5 で置き換える箇所は次のとおり(§2・§3・§5・§6 が正)。

Go:
- `internal/model/types.go`: `NoteKindEnemy`・`NoteKindDate`・`NoteKindFree` とその見出しコメントを削除。`Note` から `Kind`・`EnemyMS` を削除し `Enemies []string` を足す(§5.1)。
- `internal/firestore/notes.go`: `noteDoc` から `Kind`・`EnemyMS` を削除し `Enemies []string` を足す(タグは `firestore:"enemies"`)。`docFromNote`・`note` を合わせる。トランザクション・上限判定・関数のシグネチャは変えない。
- `internal/firestore/notes_test.go`: `model.Note` のリテラルに `Kind`・`EnemyMS` があれば外す(3関数の中身は変えない)。
- `internal/server/notes.go`: 定数 `noteEnemiesMax = 5` を足す(上限の唯一の定義)。`noteRequest`・`noteJSON` を §5.1 に変更。`validateNote` を §3 の順に書き直す(kind の判定と「種類と紐付け先」の整合を削除)。`toNoteJSON` は `Enemies` が nil なら `[]string{}` にする。GET の `limits` に `"enemies_max": noteEnemiesMax`。
- `internal/server/notes_test.go`: `validNoteBody` を `{"text":"メモ"}` に。`TestNotesValidate` の表を §7 の24件に置き換える。`listNotes` で `limits["enemies_max"] == noteEnemiesMax` を確かめる。`TestNotesCRUD` の本文を `enemies` にし、敵機2機の往復と、敵機の無いメモの GET 応答の生 JSON に `"enemies":[]` が含まれることを確かめる。他の `kind` を含む本文も外す。

フロント:
- `static/lib/notes.js`: `NOTE_KINDS` を削除。§5.2 のとおり `sanitizeNotes`・`notesForEnemy`・`groupByEnemy`・`notesByTab`・`noteTargetLabel`・`defaultDraft`・`draftFromNote`・`draftToRequest`・`validateDraft` を変更し、`canAddEnemy`・`enemyOptions`・`withValue`(components/notes.js から移す)を足す。`notesForMatch`・`hasNoteForMatch`・`tabCounts` はコードを変えない(中で使う関数の変更で新しい規則になる)。
- `static/components/notes.js`: `analysis/today.js` から `playDay` も import する。`matchDraft`・`todayDraft` を足し、`MatchNotes`・`EnemyNotes`・`NoteList` の「書く」をそれぞれに置き換える。`NoteSheetBody` から `KIND_OPTIONS`・`setKind`・紐付け先の `ToggleGroup` を削除し、§6.1 の欄にする。`NoteList` の `ToggleGroup` の label を `メモの種類` から `表示するメモ` に変える(「種類」を出さない)。
- `static/styles/notes.css`: 敵機の行(Dropdown と × を横に並べる)・日付の行(入力と ×)・× ボタン(44px 四方以上)のスタイルを足す。文字は14px 以上、色は tokens.css の定義だけ。
- `static/__tests__/notes.test.js`: §7 のとおり書き換える。
- `static/__tests__/search.test.js`: メモのリテラル(`kind`・`enemy_ms`)を `enemies: ['シャアザク']` に。期待値は変えない。
- 呼び出し側(`static/components/search.js`・`static/analysis/search.js`・`static/components/report/matchup.js`・`report.js`・`shell.js`・`app.js`)は変えない(関数のシグネチャが変わらないため)。

ui-check:
- `tools/ui-check/fixture.js`: `notes()` を次の6件にする(id・本文・日時・ピンは今のまま。`kind`・`enemy_ms` を外し `enemies` を足す)。
  | id | enemies | my_ms | date |
  |---|---|---|---|
  | preview-note-1(ピン) | `['ストームレイダー']` | '' | '' |
  | preview-note-2 | `['ストームレイダー']` | 'ストームレイダー' | '' |
  | preview-note-3 | `['ヴァルキュリア', 'ガルーダ零']` | '' | '2026-06-15' |
  | preview-note-4 | `[]` | '' | '2026-06-15' |
  | preview-note-5 | `[]` | '' | '' |
  | preview-note-6 | `['ガルーダ零']` | '' | '' |
  タブの件数は すべて6・敵機4・日付2・ピン1。敵機タブのまとまりは ガルーダ零2件(3と6)・ストームレイダー2件・ヴァルキュリア1件の3つ。先頭の試合(2026-06-15 22:23、相手はストームレイダーとヴァルキュリア)で印が付く試合の集合は単位4 と同じ。
- `tools/ui-check/fixture.test.js`: メモの検査を新しいモデルにする(§7)。
- `tools/ui-check/server.js`: `NOTES_LIMITS` に `enemies_max: 5` を足す(モックは他の上限と同じく値を自分で持つ)。
- `tools/ui-check/server.test.js`: `limits` の期待値に `enemies_max: 5`、POST の本文から `kind` を外す。
- `tools/ui-check/screens.js`: §6.6 のとおり `NOTE_SHEET_REQUIRED` と既存画面の検査を変え、`mobile-note-sheet-enemies` を足す。
- `tools/ui-check/baseline/`: 新画面の2枚と、変わる既存画面の基準を CI の撮影から取り込む(`ui-baseline` ラベル → `make ui-baseline RUN=<run-id>`)。

ドキュメント: CLAUDE.md・README(§10)、この設計書。

---

## 5. インターフェース

### 5.1 Go
```go
// internal/model/types.go(単位5。Kind・EnemyMS と NoteKind* 定数は削除)
// Note は対策メモ。日付・敵機・自機はどれも任意
type Note struct {
	ID        string
	Text      string
	Enemies   []string // 0〜5機。重複なし・選んだ順
	MyMS      string   // "" = 指定しない
	Date      string   // YYYY-MM-DD。"" = 日付なし
	Pinned    bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// internal/firestore/notes.go
var (
	ErrNoteNotFound = errors.New("note not found")
	ErrNoteLimit    = errors.New("note limit reached")
	ErrPinLimit     = errors.New("pin limit reached")
)
type NoteLimits struct{ MaxCount, MaxPinned int }
func ListNotes(ctx context.Context, userKey string) ([]model.Note, error)
func CreateNote(ctx context.Context, userKey string, n model.Note, lim NoteLimits) error
func UpdateNote(ctx context.Context, userKey string, n model.Note, lim NoteLimits) (model.Note, error) // CreatedAt は保存済みの値を返す
func DeleteNote(ctx context.Context, userKey, id string) error
// 純粋関数(テスト対象・非公開)。count はトランザクション内の集計で得た値
func checkCreate(count, pinnedOthers int, n model.Note, lim NoteLimits) error // count>=MaxCount→ErrNoteLimit, n.Pinned で pinnedOthers>=MaxPinned→ErrPinLimit
func checkUpdate(pinnedTotal int, oldPinned bool, n model.Note, lim NoteLimits) error // 自分(oldPinned なら1引く)を除いたピン数で n.Pinned && >=MaxPinned→ErrPinLimit
func notesFromDocs(docs map[string]noteDoc) []model.Note                      // UpdatedAt 降順、同じなら ID 昇順

// internal/server/notes.go
type notesStore interface {
	List(ctx context.Context, userKey string) ([]model.Note, error)
	Create(ctx context.Context, userKey string, n model.Note) error
	Update(ctx context.Context, userKey string, n model.Note) (model.Note, error)
	Delete(ctx context.Context, userKey, id string) error
}
type notesAPI struct {
	store       notesStore
	loadSession func(token string) (userKey string, encryptedJar []byte, err error)
	limiter     *rateLimiter
	now         func() time.Time
	newID       func() string // uuid.NewString
}
func newNotesAPI() *notesAPI
func (a *notesAPI) handleNotes(w http.ResponseWriter, r *http.Request) // /notes
func (a *notesAPI) handleNote(w http.ResponseWriter, r *http.Request)  // /notes/{id}
func registerNotes(mux *http.ServeMux)                                 // "/notes" と "/notes/" を登録
const noteEnemiesMax = 5 // 1件の敵機の上限。定義はここだけ。GET の limits.enemies_max で渡す(単位5)
type noteRequest struct {
	Text    string   `json:"text"`
	Enemies []string `json:"enemies"`
	MyMS    string   `json:"my_ms"`
	Date    string   `json:"date"`
	Pinned  bool     `json:"pinned"`
}
type noteJSON struct {
	ID        string   `json:"id"`
	Text      string   `json:"text"`
	Enemies   []string `json:"enemies"` // 常に配列(nil は []string{} にして null を返さない)
	MyMS      string   `json:"my_ms"`
	Date      string   `json:"date"`
	Pinned    bool     `json:"pinned"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}
func validateNote(req noteRequest) (model.Note, string) // 正規化済みの Note と、400 の文言(通れば "")。判定順は §3。返す Enemies は nil にしない
func toNoteJSON(n model.Note) noteJSON
```
- `internal/firestore/notes.go` の公開関数(`ListNotes`・`CreateNote`・`UpdateNote`・`DeleteNote`)と `checkCreate`・`checkUpdate`・`notesFromDocs` のシグネチャは単位5でも変えない。変わるのは `noteDoc` の項目だけ(`text`・`enemies`・`my_ms`・`date`・`pinned`・`created_at`・`updated_at`)。
- store の呼び出しは `context.WithTimeout(r.Context(), storeTimeout)` で包む(autorefresh.go の定数を使い回す)。
- 書き込みの limiter は `newRateLimiter(rate.Every(2*time.Second), 30)` のパッケージ変数で、キーは `"notes:"+userKey`。

### 5.2 フロント
```js
// static/app.js
async function apiCall(method, path, body) // → { status, body }。通信失敗は status 0(今の autoRefreshCall と同じ契約)
var NOTES_ACTIONS = {
  available: function () { /* !!localStorage 'catalyzer_has_session'(呼んだ時点で読む) */ },
  list: function () { return apiCall('GET', '/notes'); },
  create: function (req) { return apiCall('POST', '/notes', req); },
  update: function (id, req) { return apiCall('PUT', '/notes/' + encodeURIComponent(id), req); },
  remove: function (id) { return apiCall('DELETE', '/notes/' + encodeURIComponent(id)); },
};

// static/lib/notes.js(import なし。単位5の形)
export function loadDecision(userKey, available, settledKey, loadingKey) // 'off'|'skip'|'load'(変更なし)
export function responseOutcome(requestedKey, currentKey, res)         // 'stale'|'off'|'on'|'error'(変更なし)
export function sanitizeNotes(list)                       // id・text が文字列の項目だけ残す。enemies は配列なら空でない文字列だけ、配列でなければ []。my_ms・date・日時の欠けは ''。kind は見ない・持たない
export function notesForEnemy(notes, enemyMs, myMs)       // enemies に enemyMs を含むメモ(OR)。myMs が文字列なら my_ms が '' か myMs と一致するものだけ(null なら自機を問わない)
export function notesForMatch(notes, match)               // 変更なし。敵機ごとに [{ enemy, notes }]。opponent1_ms・opponent2_ms の順で、同じ機体は1つにまとめる。複数の敵機を持つメモは当てはまる敵機それぞれの下に出る
export function hasNoteForMatch(notes, match)             // 変更なし。相手のどれか1機が、どれかのメモの enemies にあれば真
export function groupByEnemy(notes)                       // [{ enemy, count, notes }]。各メモを enemies の機体それぞれの下に入れる。count はその敵機の下のメモ数。件数の多い順、同じなら localeCompare('ja')
export function notesByTab(notes, tab)                    // 'all'|'enemy'|'date'|'pin'。enemy = enemies が1機以上、date = date が ''でない。all・enemy・pin は updated_at の新しい順、date は date の新しい順(同じなら updated_at)
export function tabCounts(notes)                          // 変更なし。{ all, enemy, date, pin }(enemy はメモの件数で、まとまりの延べ数ではない)
export function noteTargetLabel(note)                     // 'M/D' と敵機の '・' 区切りを半角空白でつなぐ(例 '6/15 ヴァルキュリア・ガルーダ零')。どちらも無ければ 'メモ'
export function defaultDraft(ctx)                         // ctx: { enemy?, date? } → { id:null, text:'', enemies: enemy ? [enemy] : [], my_ms:'', date: date || '', pinned:false }
export function draftFromNote(note)                       // { id, text, enemies: note.enemies の複製, my_ms, date, pinned }
export function draftToRequest(draft)                     // { text, enemies, my_ms, date, pinned }。本文は CRLF→LF・前後の空白を除く。enemies は各機体の前後の空白を除き '' を落とす(順序は保つ。重複は落とさない=validateDraft で止める)
export function textLength(text)                          // 変更なし
export function validateDraft(draft, limits, pinnedOthers) // 判定順: 本文が空 → 本文が text_max 超 → 空でない敵機が enemies_max 超 → 敵機の重複 `同じ敵機が重複しています` → date が '' でなく不正 → ピン上限。保存できるなら ''。文言はサーバーと同じ
export function canAddEnemy(draft, limits)                // limits.enemies_max があり、draft.enemies.length(未選択の欄も数える) < enemies_max なら真。limits が無ければ偽
export function enemyOptions(options, enemies, index)     // index 以外の欄で選んだ機体を options から除き、enemies[index] が options に無ければ足す(withValue)
export function withValue(options, value)                 // value が options に無ければ { value, label: value } を足す(components/notes.js から移す。自機の選択肢でも使う)
export function pinnedCount(notes, exceptId)              // 以下4つは変更なし
export function upsertNote(notes, note)
export function removeNoteById(notes, id)
export function msChoices(msImages, matches)

// static/components/popover.js(単位2で追加)
export function createLayerStack()                        // { push(token), remove(token), isTop(token) }。モジュールで1つ持つ
export function Layer({ ui, label, head, foot, footUi, onClose, children }) // 移設。Esc は isTop のときだけ onClose を呼ぶ

// static/components/notes.js
export function useNotes(userKey, api, data)
// → { status: 'off'|'loading'|'on'|'error', list, limits, draft: Draft|null,
//     open(draft), close(), save(draft) → Promise<string>(失敗時は文言、成功時は ''),
//     remove(id) → Promise<string>, reload() }
export function NoteMark()                                // <span data-ui="note-mark" role="img" aria-label="メモあり"><svg…/></span>
export function NoteItem({ note, showTarget, onOpen })    // button data-ui="note-item"。本文は pre-wrap で3行まで。showTarget なら noteTargetLabel、自機の指定があれば「自機: X」
export function matchDraft(match)                         // 単位5。defaultDraft({ enemy: match.opponent1_ms, date: playDay(match.date) })
export function todayDraft(enemy, now)                    // 単位5。defaultDraft({ enemy: enemy, date: currentPlayDay(now) })。enemy が '' なら敵機0欄
export function MatchNotes({ notes, match })              // MatchDetail のパネル中身(data-ui="match-notes")
export function NoteSheet({ notes, choices })             // notes.draft が null なら何も描かない
export function EnemyNotes({ notes, enemy, myMs })        // 単位3
export function NoteList({ notes, onClose })              // 単位4
```

`useNotes` の取得タイミング(ナレッジ report-rerender-props-ignored への対策):
- `useEffect(…, [userKey, data])` の中で「`api` が無い、または `api.available()` が false → status 'off'」「取得済みの userKey と違い、取得中でもない → `api.list()`」を判定する。
  初回ログインでは `catalyzer_has_session` が分析の完了時にしか立たない。`data` を deps に入れておくと、完了時の `renderReport` で読み直しが走る。
- 応答の扱い: 200 で `body.user_key === userKey` → 'on'(`sanitizeNotes`、`limits` を保持)。401 → 'off'。それ以外と通信失敗 → 'error'。'on'・'error' になった userKey は覚えておき、同じ userKey の data 更新では取り直さない。'error' のときは `reload()` でだけ取り直す。
- アンマウント後に届いた応答は捨てる(ref で生存を確認)。
- 保存は悲観的に更新する: 応答を待ってから `upsertNote`・`removeNoteById` で一覧に反映する。DELETE の 404 は成功として扱う(もう消えている)。
- 失敗の文言: 応答に `error` があればそれを使う。status 0 なら `通信に失敗しました。電波の良い場所でもう一度お試しください`。それ以外は `メモを保存できませんでした`。401 でも status は変えない(入力中の本文を失わせない)。

### 5.3 Layer の重なり
- `Layer` はマウント時に token を `push` し、アンマウント時に `remove` する。
- `useDismiss(true, null, function () { if (stack.isTop(token)) onClose(); })` とする。document の keydown には全部の層が反応するが、判定は state が変わる前に同期で行うので、閉じるのは最上位の1枚だけになる。
- 背面を inert にする処理・スクロール位置とフォーカスの退避と復元は今のまま。重ねた層が閉じると、下の層の値が戻る。

---

## 6. 画面の変更

共通: `notes.status !== 'on'` のときは、どの画面も今と同じ DOM にする(単位4のその他画面だけ例外)。この節は単位5 の後の形で書く。

### 6.1 書くシート `NoteSheet`(Layer `ui="note-sheet"`、見出しは「メモを書く」/「メモを編集」)
上から次の順に並べる。「紐付け先」の切り替え(単位2〜4 の `ToggleGroup ui="note-kind"`)は単位5で削除する。
```
 メモ  [textarea 6行]                       n / 500
 日付  [2026/06/15 ] [×]
 敵機  [ストームレイダー ▼] [×]
       [ヴァルキュリア ▼]   [×]
       ＋ 敵機を追加する          (enemies_max 欄で消える)
 自機  [指定しない ▼]
 □ ピン留めする（最大3件）
```
- head: 閉じる(`data-ui="sheet-close"`)・見出し
- メモ: `textarea`(6行。placeholder `対策を書く（例: 着地を見てから射撃を合わせる）`)。文字数 `n / 500`(`data-ui="note-count"`。上限を超えたら bad の色)
- 日付: `<input type="date" id="noteDate" data-ui="note-date">`。`draft.date` が空でないときだけ右に × `button data-ui="note-date-clear" aria-label="日付を消す"`(押すと `date: ''`)。空にした後も入力欄から選び直せる
- 敵機: 見出しのラベル「敵機」。`draft.enemies` の各欄を `div data-ui="note-enemy"` で包み、中に `Dropdown`(noClear、placeholder `選んでください`、選択肢は `enemyOptions(choices.enemies, draft.enemies, i)`)と × `button data-ui="note-enemy-remove" aria-label="敵機を外す"`(その欄を消す)を横に並べる。欄の下に、`canAddEnemy(draft, limits)` が真のときだけ `button.ui-action data-ui="note-enemy-add"`「＋ 敵機を追加する」(押すと `enemies` の末尾に '' を足す)。敵機が0欄なら追加ボタンだけ
- 自機: 常に出す。`Dropdown`(placeholder `指定しない`、`data-ui="note-my"` で包む。選択肢は `withValue(choices.mine, draft.my_ms)`)
- `<label data-ui="note-pin"><input type="checkbox"> ピン留めする（最大3件）</label>`。他のピンが上限に達していて、自分もピン留めしていなければ disabled にし、`ピン留めは3件までです` を添える
- × ボタンは3つとも 44px 四方以上(ui-check の tap 検査の対象にする)
- 失敗時: シート内に `Notice tone="error"`。入力はそのまま残し、保存ボタンは押せる状態に戻す
- foot: 編集時は左に「削除」(`data-ui="note-delete"`)。押すと行内に「削除する」「やめる」(`data-ui="note-delete-confirm"`)。右に「保存」(`data-ui="note-save"`)。`validateDraft` が文言を返す間と保存中は disabled。保存中のラベルは「保存中…」

入口ごとの既定値(単位5):
| 入口 | 日付 | 敵機 | 自機 |
|---|---|---|---|
| 試合詳細の「＋ メモを書く」(`matchDraft(match)`) | その試合のプレイ日 `playDay(match.date)` | `opponent1_ms` の1欄(単位2 と同じ) | 指定しない |
| 相性タブの行内の「＋ メモを書く」(`todayDraft(enemy, new Date())`) | 今日のプレイ日 `currentPlayDay(new Date())` | その行の敵機の1欄 | 指定しない |
| メモ一覧の「書く」(`todayDraft('', new Date())`) | 今日のプレイ日 | 0欄 | 指定しない |
| 既存のメモをタップ(`draftFromNote`) | 保存値 | 保存値 | 保存値 |

自機はどの入口でも「指定しない」(→ 要判断 6)。

### 6.2 試合詳細 `MatchDetail`
- 結果の行(と、あれば注意の一文)の直後、「4人の比較」より上に `Panel title="敵機のメモ"`
- 中身 `MatchNotes`: 敵機ごとに機体名の小見出しを置き、`notesForMatch` のメモを `NoteItem` で並べる(無ければ `まだメモはありません`)。複数の敵機を持つメモは、当てはまる敵機それぞれの下に出る(§1.7)。末尾に「＋ メモを書く」(`data-ui="note-write"`。`matchDraft(match)` で開く)
- `NoteItem` をタップすると編集シート

### 6.3 試合検索(単位3)
- `ResultItem`: `hasNoteForMatch` が真なら、上の行(日付の前)に `NoteMark`。メモの敵機のどれか1機が相手にいれば真(OR)
- `FilterFields`: 敵機の欄の直下に `Chip ui="search-note-filter"`「メモがある敵機との試合」(押すと切り替わる)。status 'on' のときだけ出す
- 絞り込み: `filterMatches(base, filters, notes.list)`。`noteEnemies` が真なら `hasNoteForMatch` の試合だけ残す。notes を渡さなければ空として扱い、0件になる。適用中のタグは `メモがある敵機との試合`

### 6.4 レポートの相性タブ(単位3)
- 「得意な敵機」「苦手な敵機」の行: `notesForEnemy(list, 名前, selectedMs)` が1件以上なら機体名の後ろに `NoteMark`(その敵機を `enemies` のどれかに持つメモ)
- status 'on' のときだけ行をボタンにし、タップで行内に `EnemyNotes`(`data-ui="enemy-notes"`: その敵機のメモと「＋ メモを書く」。`todayDraft(enemy, new Date())` で開く)を開閉する。開くのは一度に1行
- 「表で見る」の表は変えない

### 6.5 その他画面 → メモ一覧(単位4)
- `MoreView` の「設定」と「データ」の間に `Panel title="メモ"` を置き、`div data-ui="more-notes"` の中に RowList の1行を出す
  - 'on': 本文「メモ」、補足 `n件`。タップで `NoteList`
  - 'off': 補足 `ログイン状態を保持すると使えます`。タップできない(onSelect を渡さない)
  - 'error': 補足 `読み込めませんでした`。タップで `reload()`
  - `notes` props が無い(Skeleton 経由)ときはパネルを出さない
- `NoteList`(Layer `ui="note-list"`): head に戻る(`data-ui="note-list-back"`「その他」)・見出し「メモ」・「書く」(`data-ui="note-write"`。`todayDraft('', new Date())` で開く)
  - `ToggleGroup ui="note-tabs"`(label `表示するメモ`): `すべて n` / `敵機 n` / `日付 n` / `ピン n`。敵機 = 敵機を1機以上持つメモ、日付 = 日付を持つメモ。両方持つメモは両方のタブに出て、両方の件数に入る
  - すべて・日付・ピン: `NoteItem`(`showTarget`。`noteTargetLabel` で日付と敵機を出す。例 `6/15 ヴァルキュリア・ガルーダ零`)の一覧
  - 敵機: `groupByEnemy` の順に、`data-ui="note-group"` の見出し(機体名と `n件`)とその `NoteItem` を並べる。複数の敵機を持つメモは各敵機の下に出る。タブの件数はメモの件数(まとまりの延べ数ではない)
  - 0件: `メモはまだありません`

### 6.6 ui-check の画面 id
すべて start `report-session-valid`(既存のプリセット。`?session=valid` で Cookie が付き、モックが fixture のメモを返す)。単位5 の後の required・tap を書く。

`NOTE_SHEET_REQUIRED`(単位5で置き換え): `[data-ui="note-sheet"] textarea` / `[data-ui="note-enemy"] [data-ui="select-trigger"]`「ストームレイダー」/ `[data-ui="note-date-clear"]`(日付の既定が入っている)/ `[data-ui="note-enemy-add"]` / `[data-ui="note-my"] [data-ui="select-trigger"]`「指定しない」/ `[data-ui="note-save"]` / `[data-ui="match-detail"][inert], [inert] [data-ui="match-detail"]`

| 単位 | id | viewport | 操作の要点 | 主な required / 検査 |
|---|---|---|---|---|
| 2 | `mobile-match-detail-notes` | M | 試合検索 → 先頭の結果を開く | `[data-ui="panel"] h2`「敵機のメモ」、`[data-ui="match-notes"] [data-ui="note-item"]`「着地を見てから射撃を合わせる」、`[data-ui="match-notes"] [data-ui="note-write"]`。inview: `[data-ui="match-notes"]`。tap: note-item・note-write |
| 2 | `mobile-note-sheet` | M | ↑ +「メモを書く」 | `NOTE_SHEET_REQUIRED`。tap: note-save・`[data-ui="note-enemy-remove"]`・`[data-ui="note-enemy-add"]`・`[data-ui="note-date-clear"]`(単位5で `note-kind button` から置き換え) |
| 2 | `note-sheet` | D | 同上 | `NOTE_SHEET_REQUIRED` |
| 2 | `mobile-note-saved` | M | ↑ + textarea に `ui-check で書いたメモ` を入力 → 保存 | `[data-ui="match-notes"] [data-ui="note-item"]` に入力した文字列。absent: `[data-ui="note-sheet"]` |
| 2 | `mobile-note-sheet-error` | M | ↑ + `保存エラー` を入力 → 保存。expectConsole `status of 500` | `[data-ui="note-sheet"] [data-ui="notice"][role="alert"]`「メモを保存できませんでした」、`[data-ui="note-save"]:not([disabled])` |
| 3 | `mobile-search-notes` | M | 試合検索 | `[data-ui="search-result"] [data-ui="note-mark"]` 1件以上 |
| 3 | `mobile-search-filter-notes` | M | 絞り込み → `search-note-filter`(シートを開いたまま撮る) | `[data-ui="search-applied"]`「メモがある敵機との試合」、印付きの結果が1件以上。absent: `[data-ui="search-result"]:not(:has([data-ui="note-mark"]))` |
| 3 | `mobile-report-matchup-notes` | M | 相性タブ → 「ガルーダ零」の行をタップ | `[data-ui="panel"] [data-ui="note-mark"]`、`[data-ui="enemy-notes"] [data-ui="note-item"]`「距離を詰められたら」、**単位5で追加** `[data-ui="enemy-notes"] [data-ui="note-item"]`「格闘の間合いに入らない」(複数の敵機を持つメモが出る)、`[data-ui="enemy-notes"] [data-ui="note-write"]` |
| 4 | `mobile-more-notes` | M | その他 → メモの行 | `[data-ui="note-tabs"] button` 4件、`[data-ui="note-tabs"] button[aria-pressed="true"]`「すべて」、`[data-ui="note-list"] [data-ui="note-item"]` 6件、**単位5で追加** `[data-ui="note-tabs"] button`「日付 2」・`[data-ui="note-item"]`「6/15 ヴァルキュリア・ガルーダ零」。tap: note-tabs button・note-item・note-list-back |
| 4 | `mobile-more-notes-enemy` | M | ↑ + タブ「敵機」 | `[data-ui="note-group"]` 3件、`[data-ui="note-group"]`「2件」、`[data-ui="note-group"]`「ガルーダ零」、**単位5で追加** `[data-ui="note-list"] [data-ui="note-item"]`「格闘の間合いに入らない」2件(ヴァルキュリアとガルーダ零の両方の下に出る) |
| 5 | `mobile-note-sheet-enemies`(新規) | M | `OPEN_NOTE_SHEET` → `note-enemy-add` → `[data-ui="note-enemy"] [data-ui="select-trigger"]`「選んでください」→ `[data-ui="select-item"]`「ヴァルキュリア」 | `[data-ui="note-enemy"]` 2件、`[data-ui="note-enemy"] [data-ui="select-trigger"]`「ストームレイダー」、同「ヴァルキュリア」、`[data-ui="note-enemy-remove"]` 2件、`[data-ui="note-enemy-add"]`、`[data-ui="note-date-clear"]`。tap: note-enemy-remove・note-enemy-add・note-date-clear |

画面数は 75 → 80(単位2)→ 83(単位3)→ 85(単位4)→ 86(単位5)、画像は 150 → 160 → 166 → 170 → 172 枚。

単位5 で基準画像が変わる見込みの既存画面(`ui-baseline` で撮り直す):
- `mobile-note-sheet`・`note-sheet`・`mobile-note-sheet-error`(シートの欄が変わる)
- `mobile-report-matchup-notes`(ガルーダ零の行内のメモが1件 → 2件)
- `mobile-more-notes`(日付タブの件数 1 → 2、ラベルに日付と複数の敵機)
- `mobile-more-notes-enemy`(まとまりの並びと中身。ガルーダ零が先頭・2件)

変わらない見込み: `mobile-match-detail-notes`・`mobile-note-saved`・`mobile-search-notes`・`mobile-search-filter-notes`(先頭の試合のメモと印の付く試合の集合が単位4 と同じ)、その他の既存画面。`ui-baseline` を付ける前の CI の ui-check で不一致になった画面がこの見込みと違えば、artifact の画像で原因を確かめてから取り込む。

---

## 7. テスト計画

単位5 の後の形で書く。単位5 で変える行は「単位5」と書く。

| 対象 | 追加・変更するテスト | 検証コマンド |
|---|---|---|
| server | `TestNotesRequireSession`(4メソッド×Cookie無し・解決できないトークンで401、store を呼ばない)/ `TestNotesMethods`(PATCH /notes・GET /notes/{id} で405)/ `TestNotesContentType`(415)/ `TestNotesCRUD`(作成201→GET に含まれる→PUT で本文が変わり created_at は不変→DELETE 200→GET が空。別ユーザーの GET に出ない・別ユーザーの PUT は404。**単位5**: 本文は `enemies` で書き、敵機2機 `["A","B"]` が順序どおり往復する・敵機の無いメモの GET の生 JSON に `"enemies":[]` を含む。`listNotes` で `limits.enemies_max == noteEnemiesMax`)/ `TestNotesStoreErrors`(ErrNoteLimit・ErrPinLimit→409、ErrNoteNotFound→404、その他→500、UUID でない id・後ろにパスが続く id→404)/ `TestNotesRateLimit`(31回目の書き込みが429、GET は制限しない) | `go test -race ./internal/server/` |
| server(単位5) | `TestNotesValidate` の表を次の24件にする(名前はこのとおり。期待は §3 の文言): `空` / `空白だけ` / `500字は通る` / `501字` / `絵文字500字は通る` / `絵文字501字` / `CRLF は LF・前後の空白は除く` / `改行・タブは通る` / `制御文字` / `単独の CR` / `何も持たないメモは通る`(Enemies は nil でなく長さ0)/ `敵機5機・日付・自機は通る`(各機体の前後の空白を除く)/ `敵機6機` / `敵機の重複` / `空白を除くと重複` / `空の敵機` / `空白だけの敵機` / `敵機に制御文字` / `機体名65字` / `機体名64字は通る` / `自機65字` / `日付の形式不正`(`2026-13-01`)/ `日付の桁あふれ`(`2026-02-30`)/ `日付は通る`(ピン付き)。既存の `HTTP では 400` のサブテストは本文から `kind` を外して残す | `go test -race -run '^TestNotesValidate$' -v ./internal/server/` |
| server | `TestDataAPIsRequireSession` に `/notes`(単位1。変更なし) | 同上 |
| firestore | `TestNotesCheckCreate`・`TestNotesCheckUpdate`・`TestNotesSortOrder`(単位1。単位5では `model.Note` のリテラルから旧項目を外すだけ) | `go test -race ./internal/firestore/` |
| lib/notes.js(単位5) | `static/__tests__/notes.test.js` を書き換える。削除: `kind は enemy・date・free`・`draftToRequest は kind で使わない項目を空にする`。変更: 既存のメモのリテラルを `enemies` にする(`note()` の既定は `enemies: ['A']`)。追加(1項目1 `it`、計14本): (1) sanitizeNotes が enemies を文字列の配列にし(空文字・文字列でない要素を落とす)、配列でなければ [] にし、出力のキーが `id`・`text`・`enemies`・`my_ms`・`date`・`pinned`・`created_at`・`updated_at` の8つだけ (2) notesForEnemy は複数の敵機のどれかが一致すれば出る (3) hasNoteForMatch は相手の片方だけがメモの敵機でも真(OR) (4) notesForMatch は相手2機を両方持つメモを両方の敵機の下に出す (5) groupByEnemy は複数の敵機を持つメモを各敵機の下に入れて件数にも数える (6) notesByTab で敵機と日付の両方を持つメモが enemy・date の両方に出て、tabCounts の両方に数える (7) noteTargetLabel が `'6/15 A・B'`・日付だけ `'6/15'`・敵機だけ `'A・B'`・どちらも無ければ `'メモ'` (8) defaultDraft が `{ enemy, date }` を受け、無ければ enemies [] と date '' (9) draftToRequest が空の欄を落とし前後の空白を除き、順序を保つ (10) validateDraft が空でない敵機の数で enemies_max を判定する(未選択の欄は数えない) (11) validateDraft が重複を `同じ敵機が重複しています` にし、日付が空なら通す (12) canAddEnemy が enemies_max 未満で真・到達で偽・limits が無ければ偽 (13) enemyOptions が他の欄の機体を除き、自分の値は残し、選択肢に無い値を足す (14) matchDraft が `date: '2026-06-15 03:00'` の試合で date `'2026-06-14'`・敵機 opponent1_ms、todayDraft が `new Date(2026, 5, 15, 4, 0)` で `'2026-06-14'`・敵機 '' で0欄(components/notes.js を import する。popover.test と同じく node で読める)。静的検査は今のまま(`dangerouslySetInnerHTML`・`innerHTML`・`localStorage` が無い、lib/notes.js が import を持たない) | `node --test static/__tests__/notes.test.js` |
| popover.js | `popover.test.js` の `createLayerStack`(単位2。変更なし) | `node --test static/__tests__/popover.test.js` |
| props の渡し忘れ | `skeleton-actions.test.js`(単位2・3。変更なし) | `node --test static/__tests__/skeleton-actions.test.js` |
| analysis/search.js | `search.test.js`(単位3)。**単位5**: メモのリテラルを `enemies` にするだけで期待値は変えない | `node --test static/__tests__/search.test.js` |
| ui-check(単位5) | テストに旧項目の名前(`kind`・`enemy_ms`)を書かない(§8 単位5 の条件10・11 で0件を確かめるため)。`server.test.js`: `limits` が `{ text_max:500, count_max:2000, pinned_max:3, enemies_max:5 }`、POST の本文に `kind` を含めない。`fixture.test.js`: メモの各敵機は先頭の試合の相手か `computeEnemyMatchup(全試合)` の strong ∪ weak に入る・先頭の試合の相手を持つメモと得意・苦手の敵機を持つメモがそれぞれ1件以上・件数は「敵機あり4・日付あり2・両方1・敵機2機以上1・どちらも無し1・ピン1」・どのメモもキーが `id`・`text`・`enemies`・`my_ms`・`date`・`pinned`・`created_at`・`updated_at` の8つだけ | `node --test tools/ui-check/server.test.js tools/ui-check/fixture.test.js` |
| 画面定義 | `screens.test.js`(既存の規約テスト。新画面がクラス名セレクタを使わないこと、基準画像と SCREENS の過不足が無いこと) | `node --test tools/ui-check/screens.test.js` |
| 画面 | §6.6。CI の UI Check で撮影・比較する(ローカルでは回さない) | PR の `ui-check` ジョブ |

手元の node が使えないとき(Intel Mac)は catalyzer-oracle イメージで回す: `docker run --rm -v "$PWD":/w -w /w catalyzer-oracle <node のコマンド>`(メモリ reference_docker-js-oracle)。
単位5 の着手前の実測(2026-11-16、worktree catalyzer--notes-fields の 5cf7d86): JS 全体 `# tests 602`・`# pass 602`、notes.test `# pass 42`、SCREENS 85、`^--- PASS: TestNotes` 10、`TestNotesValidate/` のサブテスト 22。

---

## 8. sub-issue への分割

PR タイトルに `(#番号)` を入れない(ナレッジ build-no-deploy-pr-number-from-title。#535 が直るまで)。
単位1〜4 の表は完了した時点の記録(単位5 で消える `note-kind` 等を含む)。単位5 の後の仕様は §2・§3・§5・§6 が正。

### 単位1: メモ(段階1-1) メモの保存 API
- 範囲: §4.1 の全部と、CLAUDE.md・README の API・Go の記述(§10)
- 依存: なし。フロントからはまだ呼ばれないので、単独でマージ・デプロイしてよい(infra の変更なし)

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| Go のテストが通る | `go test -race ./internal/...` | exit 0 |
| 追加したテスト関数が全部通る | `go test -race -run '^TestNotes' -v ./internal/server/ ./internal/firestore/ 2>&1 \| grep -cE '^--- PASS: TestNotes'` | `10`(server 7 + firestore 3) |
| /notes が本人確認の検査対象に入っている | `go test -race -run TestDataAPIsRequireSession -v ./internal/server/ 2>&1 \| grep -c -- '--- PASS: TestDataAPIsRequireSession//notes/'` | `2` |
| lint | `golangci-lint run` | exit 0(指摘0件) |
| フォーマット | `gofmt -l .` | 出力なし |
| ビルド | `go build ./cmd/server` | exit 0 |
| ルーティング | `grep -c 'registerNotes(http.DefaultServeMux)' internal/server/server.go` | `1` |
| CLAUDE.md に API がある | `grep -c 'PUT\|DELETE /notes/{id}' CLAUDE.md` | `1` 以上 |

### 単位2: メモ(段階1-2) 書くシートと試合詳細の敵機のメモ
- 範囲: lib/notes.js、components/notes.js(useNotes・NoteSheet・MatchNotes・NoteMark・NoteItem)、Layer の移設と重なりの管理、MatchDetail のパネル、app.js の apiCall・NOTES_ACTIONS、report.js の配線(SearchView への受け渡しと NoteSheet)、notes.css、ui-check のモック・fixture・5画面、ドキュメント
- 依存: 単位1

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| JS のテストが全部通る | `node --test 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js'` | exit 0 |
| notes.test が通り、テストが25件以上ある | `node --test --test-reporter=tap static/__tests__/notes.test.js \| grep -E '^# (pass\|fail)'` | `# pass` が25以上、`# fail 0` |
| 層の重なりのテストがある | `grep -c 'createLayerStack' static/__tests__/popover.test.js` | `1` 以上 |
| Layer の定義が1か所だけ | `grep -rn 'function Layer(' static/components \| wc -l` | `1`(popover.js) |
| 画面を5つ足した | `node --input-type=module -e "import {SCREENS} from './tools/ui-check/screens.js'; console.log(['mobile-match-detail-notes','mobile-note-sheet','note-sheet','mobile-note-saved','mobile-note-sheet-error'].filter(id=>SCREENS.some(s=>s.id===id)).length, SCREENS.length)"` | `5 80` |
| CSS の link が2か所にある | `grep -c 'styles/notes.css' static/index.html tools/ui-check/preview/parts.html` | 各 `1` |
| 画面確認 | PR に `ui-baseline` → `make ui-baseline RUN=<id>` で取り込んだ後の `gh pr checks <PR>` | `ui-check` が pass |
| CLAUDE.md の画面数 | `grep -c '80画面' CLAUDE.md` | `1` |

### 単位3: メモ(段階1-3) 試合検索の印と絞り込み・相性タブの印
- 範囲: analysis/search.js の絞り込み、ResultItem の印、FilterFields のチップ、WinRateRowList の拡張、MatchupPane と EnemyNotes、report.js から MatchupPane への受け渡し、3画面、ドキュメント
- 依存: 単位2(単位4とは独立)

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| JS のテストが全部通る | `node --test 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js'` | exit 0 |
| 絞り込みのテストがある | `grep -c 'noteEnemies' static/__tests__/search.test.js` | `3` 以上 |
| MatchupPane への渡し忘れ検査 | `grep -c 'MatchupPane' static/__tests__/skeleton-actions.test.js` | `1` 以上 |
| 画面を3つ足した | (単位2と同じ node -e で3つの id を数える) | `3 83` |
| 画面確認 | `gh pr checks <PR>` | `ui-check` が pass |
| CLAUDE.md の画面数 | `grep -c '83画面' CLAUDE.md` | `1` |

### 単位4: メモ(段階1-4) その他 → メモ一覧
- 範囲: NoteList、MoreView のメモパネル(on/off/error)、report.js から MoreView への受け渡し、2画面と既存のその他画面5枚の基準更新、ドキュメント
- 依存: 単位2(単位3とは独立)

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| JS のテストが全部通る | `node --test 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js'` | exit 0 |
| 画面を2つ足した | (単位2と同じ node -e で2つの id を数える) | `2 85`(単位3が先にマージ済みの場合。未マージなら `2 82`) |
| 画面確認(既存5枚の基準更新を含む) | `gh pr checks <PR>` | `ui-check` が pass |
| CLAUDE.md の画面数 | `grep -cE '8[25]画面' CLAUDE.md` | `1` |

### 単位5: メモ(段階1-5) 日付と複数の敵機を両方持てるようにする
- 範囲: §4.4 の全部(Go のモデル・保存・API の検証、lib/notes.js・components/notes.js・notes.css、fixture・モック・画面定義、既存6画面と新1画面の基準画像)、CLAUDE.md・README(§10)
- 依存: 単位4(#679。feat-notes-list の上に積む)。保存済みのメモは無いので、データ移行と旧 `kind`・`enemy_ms` の互換は作らない
- JS のコマンドは手元に node が無ければ `docker run --rm -v "$PWD":/w -w /w catalyzer-oracle <コマンド>` で回す。検証はすべて worktree の直下で行う

| # | 条件 | 検証コマンド | 期待値 |
|---|---|---|---|
| 1 | Go のテストが通る | `go test -race ./internal/...` | exit 0 |
| 2 | メモのテスト関数が全部通る | `go test -race -run '^TestNotes' -v ./internal/server/ ./internal/firestore/ 2>&1 \| grep -cE '^--- PASS: TestNotes'` | `10`(着手前と同じ) |
| 3 | 入力検証のケースが新しい表になっている | `go test -race -run '^TestNotesValidate$' -v ./internal/server/ 2>&1 \| grep -cE '^    --- PASS: TestNotesValidate/'` | `25`(表24件 + `HTTP では 400`。着手前 22) |
| 4 | 複数の敵機・上限・重複・日付なしのケースがある | `grep -cE '"(敵機6機\|敵機の重複\|空白を除くと重複\|空の敵機\|何も持たないメモは通る\|敵機5機・日付・自機は通る)"' internal/server/notes_test.go` | `6` |
| 5 | 敵機の上限の定義が1か所 | `grep -rnE 'noteEnemiesMax[[:space:]]*=' internal \| wc -l` | `1` |
| 6 | 上限の値が5 | `grep -cE 'noteEnemiesMax[[:space:]]*=[[:space:]]*5([^0-9]\|$)' internal/server/notes.go` | `1` |
| 7 | GET の limits で上限を渡す | `grep -cE '"enemies_max":[[:space:]]*noteEnemiesMax' internal/server/notes.go` | `1` |
| 8 | GET の limits をテストで確かめている | `grep -c 'enemies_max' internal/server/notes_test.go` | `1` 以上 |
| 9 | フロントが上限の数値を持たない(テストは除く) | `grep -rnE 'enemies_max[[:space:]]*[:=]\|enemies\.length[[:space:]]*[<>]=?[[:space:]]*[2-9]' static --exclude-dir=__tests__ \| wc -l` | `0` |
| 10 | 旧モデルの識別子・文言が残っていない | `grep -rIlE 'NoteKind\|EnemyMS\|enemy_ms\|NOTE_KINDS\|note-kind\|紐付け' internal static tools \| wc -l` | `0` |
| 11 | 旧 kind が残っていない | `grep -nwE 'Kind\|kind' internal/model/types.go internal/firestore/notes.go internal/firestore/notes_test.go internal/server/notes.go internal/server/notes_test.go static/lib/notes.js static/components/notes.js static/__tests__/notes.test.js static/__tests__/search.test.js tools/ui-check/fixture.js tools/ui-check/fixture.test.js tools/ui-check/server.js tools/ui-check/server.test.js tools/ui-check/screens.js \| wc -l` | `0` |
| 12 | lint | `golangci-lint run` | exit 0(指摘0件) |
| 13 | フォーマット | `gofmt -l .` | 出力なし |
| 14 | ビルド(実行ファイルを残さない) | `go build -o /dev/null ./cmd/server` | exit 0 |
| 15 | notes.test が通り、テストが増えた | `node --test --test-reporter=tap static/__tests__/notes.test.js \| grep -E '^# (pass\|fail)'` | `# pass` が `54` 以上(着手前 42 − 削除2 + 追加14)、`# fail 0` |
| 16 | 新しい関数にテストがある | `for f in canAddEnemy enemyOptions matchDraft todayDraft; do grep -c "$f(" static/__tests__/notes.test.js; done` | 4行とも `1` 以上 |
| 17 | 日付の既定を試合のプレイ日・今日のプレイ日で決める | `grep -cE 'playDay\(match\.date\)\|currentPlayDay\(now\)' static/components/notes.js` | `2` |
| 18 | ui-check の上限のモック | `grep -c 'enemies_max: 5' tools/ui-check/server.js` | `1` |
| 19 | 画面を1つ足した | `node --input-type=module -e "import {SCREENS} from './tools/ui-check/screens.js'; console.log(['mobile-note-sheet-enemies'].filter(id=>SCREENS.some(s=>s.id===id)).length, SCREENS.length)"` | `1 86` |
| 20 | 基準画像の取り込み前: 失敗は基準画像の過不足の1件だけ | `node --test --test-reporter=tap 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js' \| grep -E '^# fail\|^[[:space:]]*not ok [0-9]+ - 基準画像が'` | `# fail 1` と `not ok … - 基準画像が SCREENS × THEMES …` の1行ずつ |
| 21 | 画面確認と基準の取り込み | PR に `ui-baseline` → `make ui-baseline RUN=<run-id>` で取り込んでコミットした後の `gh pr checks <PR>` | `ui-check` が pass |
| 22 | 基準画像の枚数 | `ls tools/ui-check/baseline/*.png \| wc -l` | `172` |
| 23 | 基準の取り込み後: JS のテストが全部通る | `node --test --test-reporter=tap 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js' \| grep -E '^# (pass\|fail)'` | `# pass` が `614` 以上(着手前 602 − 2 + 14)、`# fail 0` |
| 24 | CLAUDE.md の画面数 | `grep -c '86画面' CLAUDE.md` | `1` |
| 25 | CLAUDE.md の画像数 | `grep -o '172枚' CLAUDE.md \| wc -l` | `2`(撮影の説明と baseline の説明。同じ行に2回出る) |
| 26 | 古い画面数・画像数が残っていない | `grep -cE '85画面\|170枚' CLAUDE.md` | `0` |
| 27 | CI(Go・JS) | `gh pr checks <PR>` | `build`・`lint-go`・`test-js` が pass(Go を変えるので `skip-ci` は付けない) |

---

## 9. レビュー観点(主観判断。完了条件には入れない)
- シートの入力欄・ボタンの配置がスマホで押しやすいか(CI の artifact 画像で見る)
- 印のアイコンの見た目と大きさ、文字数カウンタの色
- 文言が ui-terminology に沿っているか(敵機・自機・相手・相方)
- 単位ごとの差分に、他の単位の範囲が混ざっていないか
- 単位5: シートの欄の順(メモ→日付→敵機→自機→ピン)と、敵機の行の × が押しやすいか。複数の敵機を持つメモが試合詳細・敵機タブで重ねて出る見え方が煩くないか
- 単位5: `noteTargetLabel` の `6/15 A・B` が敵機5機のとき折り返して読めるか

## 10. CLAUDE.md・README の更新対象
| 単位 | CLAUDE.md | README |
|---|---|---|
| 1 | 主要エンドポイントに `GET|POST /notes`・`PUT|DELETE /notes/{id}`(メモ。セッション本人のみ)。コード構成の `internal/model`(`Note`)・`internal/firestore`(`notes.go`。`notes/{userKey}/items/{id}` に1件1ドキュメントで持つ)・`internal/server`(`notes.go` メモ API) | ツリーに `firestore/notes.go`・`server/notes.go` |
| 2 | `static/lib/notes.js`・`static/components/notes.js` の行を新設。`popover.js` の行に Layer(重なると最上位だけ Esc で閉じる)。`search.js` の行に敵機のメモ。`static/styles/` を全16ファイルに。`tools/ui-check/` の行に `/notes` のモック(Cookie 付きでサンプル、無ければ空・200)と fixture のメモ。`static/__tests__/` の列挙に notes。画面数 80画面・160枚 | ツリーに lib/notes.js・components/notes.js、styles を全16ファイル、`__tests__/notes.test.js`。表の static/components・static/lib |
| 3 | `static/analysis/search.js`・`static/components/search.js` の行にメモの絞り込みと印、`report/` の行に相性タブの印。83画面・166枚 | 必要なら components の説明 |
| 4 | `shell.js` の行に MoreView のメモ一覧。85画面・170枚 | shell.js の説明 |
| 5 | `static/components/notes.js` の行の「敵機のメモ。」を「メモ（日付・敵機0〜5機・自機・ピン。どれも任意。敵機はどれか1機がいる試合に出す）。」にし、`NoteSheet` に「日付の既定は試合詳細=その試合のプレイ日・他=今日」。`static/lib/notes.js` の行の「敵機ごとのメモの純粋ロジック」を「メモの純粋ロジック」にし、`canAddEnemy`・`enemyOptions` と「敵機の上限は `limits.enemies_max`」を足す。`tools/ui-check/` の行を 86画面・172枚(2か所) | `components/notes.js`・`lib/notes.js` の説明の「敵機のメモ」を「メモ」に |

## 11. エスカレーション事項
- 不可逆な操作・外部公開: なし。prod の Firestore には、最初の保存で `notes` コレクションができるだけ(移行・infra の変更なし)。
- 保持期間: メモはログアウトしてもサーバーに残る(それが目的)。ユーザー単位で全部消す機能は段階1に含めない。ログアウトの説明文(「保存したログイン情報と端末内の試合データを削除します」)は変えなくても正しい。
- 既存の基準画像: 単位4で、その他画面の5枚が意図した変更として変わる(`ui-baseline` ラベルで撮り直す)。
- 単位5: API の契約(`kind`・`enemy_ms` → `enemies`)を互換なしで変える。単位1 の API は develop(stg)に入っているが、呼ぶ画面(単位2〜4)は未マージで、保存済みのメモは無い前提(ユーザー合意 2026-11-16)。stg に試しに作った文書が残っていても、読み込みは失敗せず敵機の無いメモとして出るだけ(§1.7)。不可逆な操作・外部公開は無い。
- 単位5: 既存6画面の基準画像が意図した変更として変わる(§6.6)。

## 12. ナレッジ候補・起票候補
ナレッジ候補(knowledge-add):
- メモは `notes/{userKey}/items/{id}` に1件1ドキュメントで持つ。件数・ピン上限は書き込みと同じトランザクション内の count 集計で判定する(全件を読まない)。1MiB の制約を受けない代わりに、一覧は件数分の読み取りになる
- 全画面の Layer は重なると最上位だけが Esc で閉じる(useDismiss が document の keydown を全部の層で聞くため)
- ui-check のモックは 401 を返さない。セッション失効の画面で Report の取得が console エラーになり、その画面が落ちる(/notes は Cookie なしでも 200 で空)
- 単位5: メモは種類を持たず、日付・敵機(0〜5機)・自機・ピンを独立に持つ。敵機はどれか1機がいる試合に出し(OR)、まとまりでは各敵機の下に出す。敵機の上限はサーバーの `noteEnemiesMax` だけが持ち、`limits.enemies_max` で渡す
- 単位5: Firestore Go の `DataTo` は struct に無いフィールドを読み飛ばす(`populateStruct`)。項目を消す変更でも、古い文書の読み込みは失敗しない

起票候補(issue-create):
- develop に 31,836,226 バイトの実行ファイル `server` がコミットされている(f5f6a47。`.gitignore` に `/server` が無い)。今回の範囲外
- Layer の中の Dropdown(FilterSheet など)で Esc を押すと、ドロップダウンと層が両方閉じる(どちらも document の keydown で閉じるため。コードを読んで確認しただけで、実機では未確認)

## 13. 段階2(#689): ホームのピン留めしたメモ・試合詳細から相手2機

基点: feat-notes-home(origin/develop e2d9ee1)。Go・API・保存形式は変えない。

### 13.1 方針
- **「すべて ›」**: メモ一覧の開閉 state を Report の useState に持ち上げ、MoreView に `listOpen`/`onListOpen` を渡す(採用 D)。`openNoteList()` = `setNoteListOpen(true); nav.onNavigate('more')`。一覧の下にその他画面が描かれるので戻る「その他」は正しい。保存キーを足さない(user-state.test 無影響)。不採用: A ホーム上で開く(戻る文言が嘘)、B localStorage(clearUserState に波及)、C ref の一度きり要求(消し忘れで毎回開く)。Layer のロックは useEffect で Report の useLayoutEffect([view]) の overflow 解除より後に走る。Layer をレイアウトエフェクトに変えない
- **カード**: `PinnedNotes` を components/notes.js に作り、report.js のホーム分岐で EmptyMode/HomeView より前に描く。メモは形式で絞らないので EmptyMode でも出す。home.js は変えない。セッション無しの既存ホーム画面は null を返すので DOM 不変
- **CSS**: 既存 static/styles/notes.css に足す(新規ファイル・link なし)。クラス `.note-pins`/`.note-pins-empty`(surface.test の `.panel|.kpi|.card` に当たらない名前)。ボタンは既存 `.search-link`、hover の背景だけ明示(base.css の button:hover に負けるため)
- **純粋ロジック**: lib/notes.js(import なし)に `matchEnemies`・`pinnedNotes`・`canPinMore`。`notesForMatch` の重複除去も `matchEnemies` に置換(定義を1か所に)。日付が要る `homeDraft` は components/notes.js
- **ui-check のピン件数再現**: seed `?pins=N` → Cookie `preview_pins=N` → モック GET /notes が `fixture.notes(N)`(先頭 N 件ピン。既定1件=現状)。不採用: fixture 既定を3件(mobile-more-notes が変わる)、UI 操作で0件(流れに依存)

### 13.2 画面仕様
`PinnedNotes({notes,onAll})`(hook を使わない):
- `notes.status !== 'on'` は null
- ピン1件以上: `section.note-pins[data-ui="home-notes"]`。見出し行 `div.note-pins-head`: `h2`「ピン留めしたメモ」/ `button.search-link[data-ui="home-note-write"]`「書く」/ `button.search-link[data-ui="home-notes-all"]`「すべて ›」(U+203A。action-plan.js の「n戦 ›」に合わせる)。続けて `pinnedNotes(list, limits.pinned_max)` を `NoteItem showTarget` で並べ、タップで `draftFromNote` の編集シート
- ピン0件: `section.note-pins-empty[data-ui="home-notes"]` に `p`「メモをピン留めすると、ここに出ます」と「書く」のみ(h2・すべて無し。1段の細い枠)
- 書く: `notes.open(homeDraft(notes.list, notes.limits, new Date()))`。すべて: `onAll`
- 書くシートの文言: `ホームにピン留めする（最大${limits.pinned_max || ''}件）`。満杯時の disabled・「ピン留めは3件までです」は現状維持

入口ごとの既定値:
| 入口 | 日付 | 敵機 | ピン |
|---|---|---|---|
| 試合詳細 matchDraft | その試合のプレイ日 | 相手2機(matchEnemies。同機体は1機、空は除く) | なし |
| 相性タブ todayDraft(enemy) | 今日のプレイ日 | その行の敵機 | なし |
| メモ一覧の書く todayDraft('') | 今日のプレイ日 | 0欄 | なし |
| ホームの書く homeDraft | 今日のプレイ日 | 0欄 | canPinMore が真ならチェック |

### 13.3 インターフェース
```js
// static/lib/notes.js
matchEnemies(match)           // [opponent1_ms, opponent2_ms] の順で空・重複を除く
pinnedNotes(notes, max)       // pinned を新しい順(notesByTab 'pin')。max が正の数なら先頭 max 件
canPinMore(notes, limits)     // limits.pinned_max があり pinnedCount(notes) < pinned_max なら真。limits 無しは偽
defaultDraft(ctx)             // ctx {enemies?,date?,pinned?}。enemies は複製。enemy は廃止。pinned: !!pinned
// static/components/notes.js
matchDraft(match)             // defaultDraft({enemies: matchEnemies(match), date: playDay(match.date)})
todayDraft(enemy, now)        // defaultDraft({enemies: enemy ? [enemy] : [], date: currentPlayDay(now)})
homeDraft(notes, limits, now) // defaultDraft({date: currentPlayDay(now), pinned: canPinMore(notes, limits)})
PinnedNotes({notes,onAll})
// static/components/shell.js
MoreView({shareData,onLogout,onRebuildCache,onReanalyze,autoRefresh,notes,listOpen,onListOpen})
```
- shell.js: 内部の `listRef`/`setListOpen` を削除。メモ行 onSelect は `if (notes.status==='on') onListOpen(true); else notes.reload();`、NoteList の onClose は `function(){ onListOpen(false); }`
- report.js: `import { NoteSheet, PinnedNotes, useNotes } from '../notes.js'`。`useNotes` の直後(分岐より前)に `var noteListRef = useState(false)` と `function openNoteList()`。ホーム分岐の AppShell の子は PinnedNotes → 既存の EmptyMode/HomeView 三項 → NoteSheet。more 分岐の MoreView に `listOpen=${noteListOpen} onListOpen=${setNoteListOpen}`。既存の静的テスト保護: more 分岐より前に文字列 `view === 'more'` を書かない・MoreView 呼び出しに `=>` を使わない
- CSS(14px 以上、色は tokens.css のみ):
```css
.note-pins { display: flex; flex-direction: column; gap: 8px; margin: 0 0 36px; }
.note-pins-head { display: flex; align-items: center; gap: 8px; }
.note-pins-head h2 { flex: 1; margin: 0; color: var(--text); font-size: 1.125rem; }
.note-pins-empty { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 36px; padding: 0 4px 0 12px; border: 1px solid var(--line); border-radius: 8px; }
.note-pins-empty p { margin: 0; color: var(--muted); font-size: 0.875rem; }
.note-pins-head .search-link:hover, .note-pins-empty .search-link:hover { background: var(--accent-a10); }
```
(トークン名が実在しなければ既存の近いものに合わせる)

### 13.4 ui-check
- fixture.js `notes(pins)`(引数無し=1、`pinned: i < pins`)、seed.js `get('pins') !== null` なら `document.cookie='preview_pins='+値+'; path=/'` を location.replace 前に、server.js GET /notes は Cookie `/(?:^|;\s*)preview_pins=(\d+)(?:;|$)/` で `fx.notes(n)`、check.js START_URL に `'report-session-pins0': '/__preview/?session=valid&pins=0'`・`'report-session-pins3': '/__preview/?session=valid&pins=3'`
- 新規画面(全て `home: true`・`clock: HOME_CLOCK`・`full: false`):
  - `mobile-home-notes`(M, pins3, wait home-notes の note-item): required `[data-ui="home-notes"] h2`「ピン留めしたメモ」/ note-item 3件 / 「6/15 ヴァルキュリア・ガルーダ零」/ home-note-write「書く」/ home-notes-all「すべて」/ today-card。inview home-notes。tap note-item・write・all
  - `home-notes`(D, pins3): h2、note-item 3件
  - `mobile-home-notes-empty`(M, pins0, wait home-note-write): required home-notes「ピン留めすると」/ write / today-card。absent `home-notes h2`・home-notes-all・home-notes の note-item。oneRow home-notes。tap write
  - `mobile-home-note-sheet`(M, report-session-valid, click home-note-write → wait note-sheet): required textarea / `note-pin input:checked` / note-pin「ホームにピン留めする（最大3件）」/ note-date-clear / note-enemy-add / note-my select-trigger「指定しない」/ `[data-ui="home-notes"][inert], [inert] [data-ui="home-notes"]`。absent note-enemy・note-delete。tap save・enemy-add・date-clear
  - `mobile-home-notes-all`(M, report-session-valid, click home-notes-all → wait note-list): required CURRENT「その他」/ note-list / note-list-back「その他」/ more-notes「6件」。tap note-list-back。閉じた後の absent は即評価されるので使わない
- 既存の変更: `NOTE_SHEET_REQUIRED` に `['[data-ui="note-enemy"]', null, 2]`・`['[data-ui="note-enemy"] [data-ui="select-trigger"]','ヴァルキュリア']`・`['[data-ui="note-pin"]','ホームにピン留めする（最大3件）']`・`['[data-ui="note-pin"] input:not(:checked)']` を足す。`mobile-note-sheet-enemies` は初期2欄なので追加で選ぶ機体を「ガルーダ零」に変え、note-enemy 3件・select-trigger 3種・remove 3件に。`mobile-note-saved` の `[data-ui="match-notes"] [data-ui="note-item"]` NOTE_TEXT は2件に
- 基準が変わる既存画面(5): mobile-note-sheet, note-sheet, mobile-note-sheet-error, mobile-note-sheet-enemies, mobile-note-saved。不変見込み: セッション無しの全ホーム画面・mobile-more-notes(-enemy)・mobile-match-detail-notes。CI の不一致が見込みと違えば artifact で原因を確認してから取り込む
- 画面数 87→92、画像 174→184 枚

### 13.5 テスト計画(docker: `docker run --rm -v "$PWD":/w -w /w catalyzer-oracle <cmd>`)
- notes.test.js(54→62): 変更3(defaultDraft の完全一致/引数なしで pinned false/enemies 複製、draftToRequest CRLF は `defaultDraft({enemies:['A']})`、matchDraft 相手A・Bで['A','B']・同機体で['A']・opponent2空で['A']) / 追加8(matchEnemies、pinnedNotes、canPinMore、homeDraft(`new Date(2026,5,15,4,0)`→'2026-06-14'・enemies []・ピン2/上限3で true・3件で false)、PinnedNotes 直接呼び(off/loading/error で null、on 0件で all 無し write 有り、on 4件/pinned_max3 で NoteItem 3)、components/notes.js の import 網羅(lib の export のうち src に `名前(` がある関数は全て import 節にある)、report.js(PinnedNotes import、ホーム分岐で EmptyMode より前に PinnedNotes と NoteSheet、`<${X}` が全て import/定義済み)、MoreView 呼び出しに listOpen=/onListOpen= があり shell.js に setListOpen 無し)
- skeleton-actions.test.js +1(`<${PinnedNotes}` 全呼び出しに notes と onAll)、fixture.test.js +1、server.test.js +1、screens.test.js +1(`home` かつ start が `report-session` 始まりの画面は5つで全て clock を持つ)

### 13.6 完了条件
| # | 条件 | 期待値 |
|---|---|---|
| 1 | JS 全体(取り込み前): docker oracle(tap) | pass 634 / fail 1(基準画像過不足の1件のみ)。着手前 623/0 |
| 2 | notes.test | pass 62 / fail 0 |
| 3 | node -e で components/notes.js の PinnedNotes・homeDraft、lib/notes.js の matchEnemies・pinnedNotes・canPinMore が function | `2 3` |
| 4 | `grep -cE "^import \{[^}]*\bPinnedNotes\b[^}]*\} from '\.\./notes\.js';" static/components/report/report.js` | 1 |
| 5 | report.js・shell.js を node で import | ok |
| 6 | `grep -c setListOpen static/components/shell.js` | 0 |
| 7 | `grep -c 'function openNoteList' static/components/report/report.js` | 1 |
| 8 | `git diff origin/develop -- static | grep -cE '^\+.*(localStorage|sessionStorage)'` | 0 |
| 9 | `grep -c '\[match.opponent1_ms, match.opponent2_ms\]' static/lib/notes.js` | 1 |
| 10 | `grep -c 'ホームにピン留めする（最大' static/components/notes.js` | 1 |
| 11 | フロントにピン上限の数値を持たない(`grep -rnE 'pinned_max[[:space:]]*[:=]|最大3件' static --exclude-dir=__tests__ | wc -l`) | 0 |
| 12 | SCREENS に5 id があり総数 | `5 92` |
| 13 | check.js に pins プリセット2件 | 2 |
| 14 | `git diff --name-only origin/develop -- '*.go' | wc -l` | 0 |
| 15 | baseline 枚数(CI 取り込み後) | 184 |
| 16 | JS 全体(取り込み後) | pass 635 / fail 0 |
| 17 | CLAUDE.md: `grep -c '92画面'`=1、`grep -o '184枚' | wc -l`=2、`grep -cE '87画面|174枚'`=0 | 左記 |
| 18 | CLAUDE.md に PinnedNotes と preview_pins、README に ピン留め が各所 | 1以上 |
| 19 | 画面確認(ui-check)・基準取り込み | PR の CI で判定(ローカルで回さない) |

### 13.7 ドキュメント更新
CLAUDE.md: home.js 行(ホーム最上部のピンカードは notes.js の PinnedNotes を report.js が描く)、shell.js 行(メモ一覧の開閉は Report が持つ)、components/notes.js 行(PinnedNotes・敵機の既定は試合詳細=相手2機)、lib/notes.js 行(matchEnemies・pinnedNotes・canPinMore)、tools/ui-check 行(preview_pins・?pins=N・notes(pins)・92画面・184枚の2か所)。README: notes.js 行に「ホームのピン留め」、lib/notes.js 行に「ピン留め」。

### 13.8 レビュー観点
見た目(ピン1件以上はフラット見出し+行、0件は細い枠)/「すべて ›」の記号は既存「n戦 ›」に合わせた/0件の案内文/2機の重ね表示/文言が ui-terminology に沿うか。
ナレッジ候補: 別画面から全画面の層を開いて遷移するときは開閉 state を Report に持ち上げる。起票候補: `.search-link` の hover が base.css の accent-2 背景になる(既存ボタン)。

## 14. 段階3(#690): 総合戦歴をその他に移し、下部タブにメモ

基点: feat-notes-tab(feat-notes-home 12d5db4)。Go・API・保存形式・localStorage のキー・app.js・lib/tabseen.js・components/classrecord.js・ui-check の seed/server/check/fixture は変えない。

### 14.1 方針
1. **総合戦歴は view 値 `classrecord` を残し「その他の下の画面」にする(a)**。shell.js に `SUB_VIEWS = { classrecord: 'more' }`(非 export)と `tabOf(view)`(hasOwnProperty で引く)。TabBar の `aria-current` は親タブ。`readView` は TAB_ITEMS の key と SUB_VIEWS の key を許す。Report の classrecord 分岐は今の形(bare+trailing 再分析ボタン+onPull/canPull)のまま、本文先頭に戻るボタン `classrecord-back`「その他」を足す。不採用(b) MoreView 内に描く: trailing・onPull・既読判定が Report 側にあり、描き分け state を持ち上げると(a)の作り直しになる。Layer に載せるとタブバー・引っ張り・再分析ボタンが隠れる
2. **総合戦歴の点はその他のタブと「総合戦歴」の行に移す**。signals は `{home,report,search,classrecord}` のまま。`tabDot(badges,key,view)` で下の画面の点を親タブに出す(表示中のタブには付けない)。その他を開くとタブの点は消えるので行に `dot` を出す。既読は今と同じく view===classrecord 表示時(markSeen 不変)。不採用: 点をやめる(今の通知が消える)、その他を開いたら既読(見ていないのに消える)。**メモタブには点を付けない**(メモが変わるのは本人の操作だけで外部更新が無いため)
3. **メモタブは bare**。trailing・onPull は渡さない(メモは戦績と無関係で再分析しても変わらず、誤った引っ張りで数分の取得が走るのを避ける)。「書く」は本文の見出し行(trailing はスマホで display:none)
4. **NoteList の Layer 版は消す**(使っていたのは MoreView だけ)。本体は内部 `NoteList({notes})`(export しない)、外側は export する `NotesView({notes})`(hook なし)。`note-list-back`・`more-notes`・`notesRow`・`listOpen`/`onListOpen`・`noteListOpen`/`openNoteList`・more 分岐の NoteSheet は削除
5. view 値 `notes`、ラベル「メモ」、アイコンは鉛筆。`TAB_ICONS.classrecord` は削除

### 14.2 画面仕様
- 下部タブ: ホーム / レポート / 試合検索 / メモ / その他(shell.css の repeat(5,1fr) 不変)
- `NotesView` ルート `div[data-ui="notes-view"]`。見出し行 `div.notes-head` に `h2`「メモ」、status が on のときだけ `button.search-link[data-ui="note-write"]`「書く」(`notes.open(todayDraft('', new Date()))`)
  - on: NoteList(`div.note-list[data-ui="note-list"]`。すべて/敵機/日付/ピン・一覧・空なら「メモはまだありません」)
  - off: Notice(info)「ログイン状態を保持すると使えます」/ loading: `p.note-empty`「読み込み中…」/ error: `Notice tone="error" action={label:'もう一度読み込む', onClick: notes.reload}`「読み込めませんでした」。on 以外では書く・トグル・一覧を出さない
- Report の分岐順: home → search → notes → classrecord → more → report。notes 分岐は `AppShell nav` の子に NotesView と NoteSheet
- 総合戦歴: 先頭に `button.search-back[data-ui="classrecord-back"][aria-label="その他に戻る"]`(左矢印 svg+「その他」)、押すと `nav.onNavigate('more')`。再分析ボタン・引っ張りは今のまま
- その他: ブランドロゴ直後に `Panel title="戦績"` → `div[data-ui="more-classrecord"]` → RowList 1行 `{key:'classrecord', main:'総合戦歴', sub:'ガンダムモバイルの通算戦績と通算記録', dot: !!classRecordDot}`(押すと `onClassRecord()`)。「メモ」Panel は削除
- ホームの「すべて ›」: `onAll` は `nav.onNavigate('notes')`
- RowList の `dot`: 真のとき main と aside の間に `span.ui-row-dot[data-ui="row-dot"][aria-hidden]` と `span.visually-hidden`「(更新あり)」

### 14.3 インターフェース
```js
// static/components/shell.js
export var TAB_ITEMS = [home, report, search, { key: 'notes', label: 'メモ' }, more];
export function tabOf(view)               // SUB_VIEWS を hasOwnProperty で引き、無ければ view
export function tabDot(badges, key, view) // !badges か key===tabOf(view) なら false。badges[key] か、SUB_VIEWS[s]===key の badges[s] が真なら true
export var TAB_ICONS                      // テストから読むため export
export function readView()                // TAB_ITEMS か SUB_VIEWS の key ならそれ、他は 'home'
// TabBar: aria-current は tabOf(view)===t.key、点は tabDot(badges,t.key,view)
export function MoreView({ shareData, onLogout, onRebuildCache, onReanalyze, autoRefresh, onClassRecord, classRecordDot })
// shell.js は notes.js を import しない(notesRow 削除)
// static/components/notes.js: function NoteList({ notes }) / export function NotesView({ notes })
// static/components/parts.js: RowList の行に dot?: boolean
// report.js: import { NoteSheet, NotesView, PinnedNotes, useNotes } from '../notes.js'
//  noteListRef/noteListOpen/openNoteList 削除。PinnedNotes onAll=${function () { nav.onNavigate('notes'); }}
//  more: MoreView に onClassRecord=${function () { nav.onNavigate('classrecord'); }} classRecordDot=${nav.badges.classrecord}(NoteSheet・notes・listOpen は渡さない)。Skeleton の more にも onClassRecord
```
- MoreView 呼び出しに `=>` を使わない(既存静的テストの正規表現)。アイコン path 例: `M5 19l1-4L16 5l3 3L9 18l-4 1zM14 7l3 3`
- CSS(14px 以上、色は tokens のみ):
```css
/* notes.css */
.note-pins-head, .notes-head { display: flex; align-items: center; gap: 8px; }
.note-pins-head h2, .notes-head h2 { flex: 1; margin: 0; color: var(--text); font-size: 1.125rem; }
.notes-head { margin: 0 0 12px; }
.note-pins-head .search-link:hover, .note-pins-empty .search-link:hover, .notes-head .search-link:hover { background: var(--accent-a10); }
/* 削除: .search-layer-head .note-list-write(クラス note-list-write も) */
/* search.css(追加) */
.search-back:hover { background: var(--accent-a10); }  /* button:hover に負けるため。試合詳細の戻るボタンにも効く */
/* parts.css */
.ui-row-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--bad); }
```

### 14.4 ui-check
- 現状: SCREENS 92、基準 174 枚(#692 の5画面10枚が未取込、孤児0)。変更後 **95 画面・190 枚**(92-2+5)
- 改名(削除): mobile-more-notes→mobile-notes、mobile-more-notes-enemy→mobile-notes-enemy。基準 `mobile-more-notes{,-enemy}-{dark,light}.png` 4枚は **ラベルを付ける前に git rm**(make ui-baseline は cp で孤児を消さない)
- 新規5: 
  - `mobile-notes`(M, report-session-valid): goTab('メモ')→wait note-list note-item。required: CURRENT メモ / notes-view h2 メモ / note-write 書く / note-tabs button 4件 / pressed すべて / note-list note-item 6件 / 「日付 2」/ 「6/15 ヴァルキュリア・ガルーダ零」。absent: note-list-back・reanalyze-button。tap: note-tabs button・note-item・note-write
  - `mobile-notes-enemy`(M): 上に加え「敵機」を押す。required・tap は旧 mobile-more-notes-enemy と同じ
  - `notes`(D, full:false): required CURRENT メモ / note-item 6件 / note-write。absent reanalyze-button
  - `mobile-notes-write`(M, clock: HOME_CLOCK): goTab('メモ')→click note-write→wait note-sheet。required: textarea / note-date-clear / `note-pin input:not(:checked)` / note-my「指定しない」/ note-enemy-add / `[data-ui="notes-view"][inert], [inert] [data-ui="notes-view"]`。absent: note-enemy・note-delete。tap: note-save・note-enemy-add・note-date-clear
  - `mobile-classrecord`(M, report-seen): goTab('その他')→wait `more-classrecord row-dot`→absentNow `tabbar-item:nth-child(5) tabbar-dot`→click `more-classrecord button`→wait classrecord-back。required: CURRENT その他 / classrecord-back「その他」/ summary-hero 通算勝率 / h2 通算記録。absent: reanalyze-button・`tabbar-item:nth-child(5) tabbar-dot`。tap: classrecord-back
- 既存の変更: 
  - `classrecord`(D): ops goTab('その他')→click more-classrecord button→wait h2 通算記録。CURRENT を「その他」、classrecord-back を追加(REANALYZE_BTN は残す)
  - `mobile-more`: ops 試合検索→wait search-filter→メモ→wait [notes-view notice,'ログイン状態を保持すると使えます']→その他→総合戦歴の行 click→wait 通算記録→classrecord-back→wait more-classrecord→総合戦歴の行→wait 通算記録→reload→wait [CURRENT,'ホーム']→goTab('その他')。required の more-notes を `['[data-ui="more-classrecord"] button','総合戦歴']` に置換、absent に more-notes
  - `more`(D): required に more-classrecord button 総合戦歴
  - `mobile-home-badges`: required に `tabbar-item:nth-child(5) tabbar-dot`、absent に nth-child(4)(点の数3は不変)
  - `mobile-home-notes-all`: required CURRENT メモ / note-list note-item 6件、absent note-list-back・home-notes、tap 削除(home:true・report-session-valid のまま)
- **基準が変わる画面(タブバーが写る63)**
  - D 14: analyzing, report-overview, home, report-playstyle, report-burst, report-matchup, report-time, dropdown-period, dropdown-ms, search, dropdown-search-sort, home-notes, classrecord, more
  - M 49: analyzing-prelim, analyze-partial, analyze-prelim-error, mobile-home-few, mobile-home, mobile-home-last-day, mobile-home-badges-cleared, mobile-home-badges, mobile-report-grade, mobile-search-applied, mobile-search-sort, mobile-search-notes, mobile-search-filter-notes, mobile-report-matchup-notes, mobile-home-notes, mobile-home-notes-empty, mobile-home-notes-all, mobile-mission-search, mobile-mission-search-removed, mobile-search-pattern, mobile-search-pattern-multi, mobile-home-focus, mobile-focus-review, mobile-search-back, mobile-search-page-next, mobile-report-overview, mobile-report-scroll-up, mobile-pull, mobile-search-pull, mobile-pull-browser, mobile-dropdown-period, mobile-dropdown-mode, mobile-report-empty-mode, mobile-search-shared-scope, mobile-report-shared-scope-cleared, mobile-report-shared-dates, mobile-home-mode, mobile-home-empty-mode, mobile-ms-mode-chip, mobile-dropdown-ms, mobile-more, mobile-more-confirm, mobile-more-auto-refresh, mobile-more-auto-refresh-error, mobile-theme-light, mobile-theme-dark-reload, mobile-theme-os-switch, report-empty-period, report-empty-period-back
  - 基準未取込の #692 の4画面を除くと既存基準で書き換わるのは59画面・118枚
- 変わらない見込み27: AppShell が写らない9(login, session-expired, analyze-error, notice-session-expired, mobile-pull-release, more-reanalyze, report-reanalyze, parts, parts-sheet)・全画面 Layer がタブバーを覆う18(match-detail, mobile-search-filter, mobile-search-proficiency, dropdown-search-filter, mobile-match-detail, mobile-match-detail-streak, mobile-match-detail-notes, mobile-note-sheet, mobile-note-sheet-enemies, note-sheet, mobile-note-saved, mobile-note-sheet-error, mobile-home-note-sheet, mobile-match-detail-hit, mobile-match-detail-ol-hit, mobile-match-detail-lastcost-hit, mobile-match-gantt, mobile-layer-exclusive)。CI で不一致が出たら artifact で原因確認後に取り込む
- 取り込み: 削除4枚をコミット→PR に ui-baseline→`make ui-baseline RUN=<id>`→コミット(#692 の10枚も同じ取り込みで入る。#692 側が先なら rebase して同 id はこのブランチの画像を採る)

### 14.5 テスト計画(docker: `docker run --rm -v "$PWD":/w -w /w catalyzer-oracle <cmd>`)
- shell.test.js(6→11): 変更=TAB_ITEMS 順 `home,report,search,notes,more`、readView は classrecord をそのまま返す、旧「MoreView のメモ行」を差替(notes 引数なし・onClassRecord と classRecordDot あり・`dot: !!classRecordDot`・`from './notes.js'` なし)。追加=tabOf(classrecord→more, notes→notes, valueOf→valueOf)・tabDot(`{classrecord:true}` は more/home で真、more/more・more/classrecord・notes/home で偽、`{report:true}` は report/classrecord で真、badges undefined で偽)・TAB_ICONS が全 key に function を持ち classrecord を持たない・shell.js の `<${X}` が全て import/定義済み
- notes.test.js(62→64): 変更=NoteList の data-ui を `note-list, note-tabs, note-group, notes-view` にし note-list-back と `<${Layer} ui="note-list"` が無いこと、MoreView 呼び出しに `notes=` なし、notes 分岐(`if (view === 'notes')`〜`if (view === 'classrecord')`)に NotesView と NoteSheet があり trailing=・onPull= が無い、report.js・shell.js に `noteListOpen|openNoteList|listOpen|setListOpen` が無く `onAll=${function () { nav.onNavigate('notes'); }}` がある。追加=NotesView を off/loading/error で直接呼び note-write・note-list が無い(off/error は Notice、error の action.onClick===notes.reload、loading は「読み込み中…」)・on で note-write があり NoteList を子に持ち、書くで notes.open に渡る draft が `enemies:[]`・`pinned:false`
- skeleton-actions.test.js(10→12): MoreView の全呼び出しに onClassRecord(2件以上)、NotesView の全呼び出しに notes
- screens.test.js(23→24): mobile-more の押したラベルにレポート・試合検索・メモ・その他、`more-classrecord button` と `classrecord-back` の click、reload 直前は wait「通算記録」、+1 は wait ホーム、+2 は click その他。追加=どの画面も `goTab('総合戦歴')` を使わず classrecord・mobile-classrecord は CURRENT その他と classrecord-back 必須 / mobile-home-badges は nth-child(5) 点必須・nth-child(4) 点 absent
- tabseen.test.js・user-state.test.js は不変。合計 635→645(取込前 pass 644/fail 1、取込後 pass 645/fail 0)

### 14.6 完了条件
`$D`=`docker run --rm -v "$PWD":/w -w /w catalyzer-oracle`、`$T`=`node --test --test-reporter=tap 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js'`
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| 1 | JS 全体(取込前) | `$D $T \| grep -E '^# (pass\|fail)'` | pass 644 / fail 1 |
| 2 | 失敗は基準画像の過不足のみ | `$D $T \| grep -cE '^[[:space:]]*not ok [0-9]+ - 基準画像が'` | 1 |
| 3-5 | shell / notes / skeleton-actions test | 各ファイルを同様に実行 | pass 11 / 64 / 12、fail 0 |
| 6 | タブの並び | TAB_ITEMS の key を node で出力 | `home,report,search,notes,more` |
| 7 | 画面の増減と総数 | SCREENS から新規5・旧2・総数を出力 | `5 0 95` |
| 8 | `grep -c "goTab('総合戦歴')" tools/ui-check/screens.js` | | 0 |
| 9 | `ls tools/ui-check/baseline \| grep -c '^mobile-more-notes'` | | 0 |
| 10 | `grep -cE 'note-list-back\|ui="note-list" label' static/components/notes.js` | | 0 |
| 11 | `grep -c "from './notes.js'" static/components/shell.js` | | 0 |
| 12 | report.js shell.js に `noteListOpen\|openNoteList\|listOpen` | grep -c | 0 |
| 13 | `git diff origin/feat-notes-home...HEAD -- static \| grep -cE '^\+.*localStorage\.setItem'` | | 0 |
| 14 | `git diff --name-only origin/feat-notes-home...HEAD -- '*.go' \| wc -l` | | 0 |
| 15 | ui-baseline 取込後の PR checks | | ui-check pass |
| 16 | `ls tools/ui-check/baseline/*.png \| wc -l`(取込後) | | 190 |
| 17 | JS 全体(取込後) | | pass 645 / fail 0 |
| 18-20 | CLAUDE.md: `grep -c '95画面'`=1、`grep -o '190枚' \| wc -l`=2、`grep -cE '92画面\|184枚'`=0 | | 左記 |
| 21 | CLAUDE.md に旧記述(`NoteList`（その他画面`・listOpen・その他画面のメモの行) | grep -c | 0 |
| 22 | CLAUDE.md の `NotesView`、README の `メモタブ` | grep -c | 各1以上 |
| 23 | CI test-js(skip-ci を付けない) | | pass |
PR の base が develop になったら #13・#14 は読み替える。#15・#16・#17(取込後)・#23 は PR の CI 後で、本パイプラインでは #1-14 と #18-22 を検証する。

### 14.7 ドキュメント更新
- CLAUDE.md: report/ 行(引っ張りは「メモ・その他では無効」)/ shell.js 行(MoreView の括弧書きを総合戦歴への行 `onClassRecord`・点 `classRecordDot`・共有・設定・データ・アカウントに。下部タブ5種と `tabOf`・`tabDot`、classrecord はその他の下の画面)/ home.js(「すべて ›」はメモタブ)/ parts.js(RowList に dot)/ notes.js(メモタブに案内だけ・`NotesView`・import 元は search.js・charts.js・report/)/ classrecord.js(その他の「総合戦歴」の行から開く)/ ui-check の 92画面→95画面・184枚→190枚(2か所)
- README: classrecord.js(その他から開く)・notes.js(メモタブ)・shell.js(下部タブ5種、総合戦歴への入口)

### 14.8 変更予定ファイル
static/components/{shell,notes,parts}.js、static/components/report/report.js、static/styles/{notes,parts,search}.css、static/__tests__/{shell,notes,skeleton-actions}.test.js、tools/ui-check/{screens,screens.test}.js、tools/ui-check/baseline/(4枚削除)、CLAUDE.md、README.md

### 14.9 レビュー観点・既知の制限
鉛筆アイコン・戦績パネル位置と sub 文言・戻るボタンと要約の間隔・メモの見出し行と書くの配置・行の点の大きさ。既知: Skeleton は view が notes のとき search と同様にレポート骨組みを出す。エスカレーション4条件に該当なし(基準4枚の git rm は履歴から戻せる)。
