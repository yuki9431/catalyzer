# 設計書: 敵機ごとの対策メモ(段階1) — issue #389

- ステータス: 単位1・2・3 実装完了、単位4 未着手
- 日付: 2026-11-16
- 関連 issue: #389(単位1 = #668、単位2〜4 = #669〜#671)
- 対象: catalyzer(既定ブランチ develop。調査は origin/develop d23aaec)

## 0. 用語(表示文言)
ナレッジ ui-terminology に従い、要求文の「相手機体」は表示上 **敵機** と書く(「敵機体」「相手機体」は使わない)。
自分の機体は **自機**。コード識別子(`enemy_ms`・`my_ms`・kind `enemy`)は英語のまま。

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

---

## 2. データモデル

### 2.1 Firestore
```
notes/{userKey}/items/{id}    // userKey = SHA256(email)[:8] の16進。id = サーバーが生成する UUID v4(ドキュメント ID)

NoteDoc
  kind:       string   // "enemy" | "date" | "free"
  text:       string   // 1〜500文字(rune)。前後の空白を除き、CRLF→LF
  enemy_ms:   string   // kind=enemy で必須(1〜64文字)。他の kind では ""
  my_ms:      string   // kind=enemy で任意(0〜64文字)。"" = 指定しない。他の kind では ""
  date:       string   // kind=date で必須 "YYYY-MM-DD"(プレイ日。朝5時で切り替え)。他の kind では ""
  pinned:     bool     // 段階2用。全体で最大3件
  created_at: timestamp
  updated_at: timestamp
```
- 段階2(ピン)・段階3(日付)は、このスキーマのまま表示を足すだけで済む。
- 自機は「敵機メモの補足」(この自機で戦うときだけのメモ)。自機だけに紐付くメモは段階1では作らない(kind を足せば後から拡張できる)。

### 2.2 上限(サーバーが正。GET の応答 `limits` でフロントに渡し、フロントに定数を重複させない)
| 項目 | 値 | 超えたとき |
|---|---|---|
| 本文 | 500文字(rune、正規化後) | 400 |
| 件数 | 2000件/ユーザー | 409 |
| ピン | 3件/ユーザー | 409 |
| 機体名 | 64文字 | 400 |
| リクエスト本文 | 8KiB | 400 |
| 書き込み回数 | ユーザーごとにバースト30・2秒に1回回復 | 429 |

---

## 3. API

すべてセッション本人だけ。クエリの `user_key` は受け付けない(#461 と同じ)。

| メソッド・パス | リクエスト | 成功 | 内容 |
|---|---|---|---|
| `GET /notes` | なし | 200 `{"user_key","notes":[Note…],"limits":{"text_max":500,"count_max":2000,"pinned_max":3}}` | `updated_at` の新しい順、同じなら id の昇順 |
| `POST /notes` | `NoteRequest` | 201 `{"note":Note}` | 作成。id・日時はサーバーが付ける |
| `PUT /notes/{id}` | `NoteRequest` | 200 `{"note":Note}` | 編集できる項目を丸ごと置き換える。`created_at` はそのまま |
| `DELETE /notes/{id}` | なし | 200 `{"ok":true}` | 削除 |

- `NoteRequest` = `{"kind","text","enemy_ms","my_ms","date","pinned"}`
- `Note` = `NoteRequest` + `"id"`・`"created_at"`・`"updated_at"`(RFC3339)

判定の順序(上から順に見て、最初に当たったものを返す):
1. メソッド違い → 405(`/notes` は GET/POST、`/notes/{id}` は PUT/DELETE)
2. Cookie が無い/セッションを解決できない → 401 `ログイン状態が保持されていません`
3. 書き込みだけ: ユーザー単位のレート制限 → 429 `保存の回数が多すぎます。しばらく待ってからお試しください`
4. POST/PUT だけ: Content-Type が `application/json` でない → 415。SameSite=Strict に加えて、フォームからの送信を断つ(同じサイトの別サブドメインからの CSRF 対策。数行で済む)
5. `/notes/{id}` の id が UUID として読めない、または後ろにパスが続く → 404 `メモが見つかりません`
6. 本文を読めない(8KiB 超を含む) → 400 `Invalid request body`
7. 入力検証に落ちた → 400。文言: `メモの本文を入力してください` / `メモは500文字までです` / `敵機を選んでください` / `日付の形式が正しくありません` / `メモの種類が正しくありません` / `機体名が長すぎます` / `使えない文字が含まれています`(改行・タブ以外の制御文字) / kind に合わない項目が入っている → `メモの種類と紐付け先が合いません`
8. 保存処理のエラー: `ErrNoteNotFound` → 404、`ErrNoteLimit` → 409 `メモは2000件までです。不要なメモを削除してください`、`ErrPinLimit` → 409 `ピン留めは3件までです`、それ以外 → 500 `メモを読み込めませんでした` / `メモを保存できませんでした` / `メモを削除できませんでした`(数値はすべて定数から Sprintf で作る)

---

## 4. 変更ファイルと変更内容

### 4.1 Go(単位1)
- `internal/model/types.go`: `Note` 型と kind 定数 `NoteKindEnemy="enemy"`・`NoteKindDate="date"`・`NoteKindFree="free"` を足す(JobStatus の定数と同じ置き方)。
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
- `tools/ui-check/fixture.js`: `notes()` を足す。架空の6件(kind enemy 4件=ストームレイダー2件・ヴァルキュリア1件・ガルーダ零1件(単位3で足した。`computeEnemyMatchup` の苦手に入る敵機)で、うち1件は `my_ms` 付き、date 1件 `2026-06-15`、free 1件。ピンは1件。日時は固定の ISO 文字列)。敵機は fixture の機体名から、§7 の fixture テストを満たすものを選ぶ。
- `tools/ui-check/server.js`: `/notes` のモック(状態は持たない)
  - `GET /notes`: Cookie `preview_session=valid` があれば `fixture.notes()`、無ければ `notes: []`。**どちらも 200**。401 を返すと、`?session=1` で始まる既存画面(session-expired)で Report の取得が console エラーになり、その画面が落ちるため。`limits` は `{text_max:500,count_max:2000,pinned_max:3}`
  - `POST /notes`: 本文の text に `保存エラー` を含めば 500 `{error:'メモを保存できませんでした'}`。それ以外は 201 で、本文に `id:'preview-note-new'` と固定の日時を足して返す
  - `PUT /notes/{id}`: POST と同じ規則で 200
  - `DELETE /notes/{id}`: 200 `{ok:true}`
  - 既存の `if (!get) return 405` より前に置く
- `tools/ui-check/screens.js`: §6.6 の画面を足す。
- `tools/ui-check/server.test.js`・`fixture.test.js`: 追記(§7)。

---

## 5. インターフェース

### 5.1 Go
```go
// internal/model/types.go
type Note struct {
	ID        string
	Kind      string // NoteKindEnemy / NoteKindDate / NoteKindFree
	Text      string
	EnemyMS   string
	MyMS      string
	Date      string // YYYY-MM-DD
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
type noteRequest struct {
	Kind    string `json:"kind"`
	Text    string `json:"text"`
	EnemyMS string `json:"enemy_ms"`
	MyMS    string `json:"my_ms"`
	Date    string `json:"date"`
	Pinned  bool   `json:"pinned"`
}
func validateNote(req noteRequest) (model.Note, string) // 正規化済みの Note と、400 の文言(通れば "")
```
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

// static/lib/notes.js(import なし)
export var NOTE_KINDS = ['enemy', 'date', 'free'];
export function sanitizeNotes(list)                       // GET 応答の検証。id・text が文字列で kind が NOTE_KINDS の項目だけ残す。他の文字列項目の欠けは '' にする
export function notesForEnemy(notes, enemyMs, myMs)       // kind=enemy かつ enemy_ms 一致。myMs が文字列なら my_ms が '' か myMs と一致するものだけ(null なら自機を問わない)
export function notesForMatch(notes, match)               // 敵機ごとに [{ enemy, notes }]。opponent1_ms・opponent2_ms の順で、同じ機体は1つにまとめる。自機は match.ms で絞る
export function hasNoteForMatch(notes, match)             // notesForMatch のどれかが1件以上
export function groupByEnemy(notes)                       // [{ enemy, count, notes }]。件数の多い順、同じなら localeCompare('ja')
export function notesByTab(notes, tab)                    // 'all'|'enemy'|'date'|'pin'。all・pin は updated_at の新しい順、enemy は kind=enemy のみ、date は date の新しい順
export function tabCounts(notes)                          // { all, enemy, date, pin }
export function noteTargetLabel(note)                     // 敵機名 / 'M/D' / 'メモ'
export function defaultDraft(ctx)                         // ctx: { enemy_ms?, kind?, date? } → { id:null, kind, text:'', enemy_ms, my_ms:'', date, pinned:false }。enemy_ms があれば kind 'enemy'
export function draftFromNote(note)
export function draftToRequest(draft)                     // CRLF→LF・前後の空白を除く。kind で使わない項目は '' にする(enemy→date='' / date→enemy_ms=my_ms='' / free→3つとも '')
export function textLength(text)                          // 正規化後の Array.from(text).length(サーバーの rune 数と一致させる)
export function validateDraft(draft, limits, pinnedOthers) // 保存できない理由の文言。保存できるなら ''
export function pinnedCount(notes, exceptId)
export function upsertNote(notes, note)                    // 同じ id は置き換え、無ければ先頭に足す
export function removeNoteById(notes, id)
export function msChoices(msImages, matches)              // { enemies, mine }。どちらも [{value,label}]。対戦した機体(enemies は opponent1/2_ms、mine は ms)を試合数の多い順、続けて msImages にだけある機体を localeCompare('ja') 順

// static/components/popover.js(単位2で追加)
export function createLayerStack()                        // { push(token), remove(token), isTop(token) }。モジュールで1つ持つ
export function Layer({ ui, label, head, foot, footUi, onClose, children }) // 移設。Esc は isTop のときだけ onClose を呼ぶ

// static/components/notes.js
export function useNotes(userKey, api, data)
// → { status: 'off'|'loading'|'on'|'error', list, limits, draft: Draft|null,
//     open(draft), close(), save(draft) → Promise<string>(失敗時は文言、成功時は ''),
//     remove(id) → Promise<string>, reload() }
export function NoteMark()                                // <span data-ui="note-mark" role="img" aria-label="メモあり"><svg…/></span>
export function NoteItem({ note, showTarget, onOpen })    // button data-ui="note-item"。本文は pre-wrap で3行まで、自機の指定があれば「自機: X」
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

共通: `notes.status !== 'on'` のときは、どの画面も今と同じ DOM にする(単位4のその他画面だけ例外)。

### 6.1 書くシート `NoteSheet`(Layer `ui="note-sheet"`、見出しは「メモを書く」/「メモを編集」)
- head: 閉じる(`data-ui="sheet-close"`)・見出し
- 本文: `textarea`(6行。placeholder `対策を書く（例: 着地を見てから射撃を合わせる）`)。文字数 `n / 500`(`data-ui="note-count"`。上限を超えたら bad の色)
- 紐付け: `ToggleGroup ui="note-kind"` [敵機][日付][なし]
  - 敵機: 「敵機」は `Dropdown`(noClear、placeholder `選んでください`、`data-ui="note-enemy"` で包む)。「自機」は `Dropdown`(placeholder `指定しない`、`data-ui="note-my"` で包む)。選択肢は `choices.enemies`・`choices.mine`
  - 日付: `<input type="date" data-ui="note-date">`。初期値は `currentPlayDay(new Date())`(analysis/today.js)
- `<label data-ui="note-pin"><input type="checkbox"> ピン留めする（最大3件）</label>`。他のピンが上限に達していて、自分もピン留めしていなければ disabled にし、`ピン留めは3件までです` を添える
- 失敗時: シート内に `Notice tone="error"`。入力はそのまま残し、保存ボタンは押せる状態に戻す
- foot: 編集時は左に「削除」(`data-ui="note-delete"`)。押すと行内に「削除する」「やめる」(`data-ui="note-delete-confirm"`)。右に「保存」(`data-ui="note-save"`)。`validateDraft` が文言を返す間と保存中は disabled。保存中のラベルは「保存中…」
- 入口ごとの既定値: 試合詳細 → 敵機=opponent1_ms / 相性タブ → その行の敵機 / メモ一覧の「書く」→ 敵機は未選択。**自機はどの入口でも「指定しない」**(→ 要判断 6)

### 6.2 試合詳細 `MatchDetail`
- 結果の行(と、あれば注意の一文)の直後、「4人の比較」より上に `Panel title="敵機のメモ"`
- 中身 `MatchNotes`: 敵機ごとに機体名の小見出しを置き、`NoteItem` を並べる(無ければ `まだメモはありません`)。末尾に「＋ メモを書く」(`data-ui="note-write"`)
- `NoteItem` をタップすると編集シート

### 6.3 試合検索(単位3)
- `ResultItem`: `hasNoteForMatch` が真なら、上の行(日付の前)に `NoteMark`
- `FilterFields`: 敵機の欄の直下に `Chip ui="search-note-filter"`「メモがある敵機との試合」(押すと切り替わる)。status 'on' のときだけ出す
- 絞り込み: `filterMatches(base, filters, notes.list)`。`noteEnemies` が真なら `hasNoteForMatch` の試合だけ残す。notes を渡さなければ空として扱い、0件になる。適用中のタグは `メモがある敵機との試合`

### 6.4 レポートの相性タブ(単位3)
- 「得意な敵機」「苦手な敵機」の行: `notesForEnemy(list, 名前, selectedMs)` が1件以上なら機体名の後ろに `NoteMark`
- status 'on' のときだけ行をボタンにし、タップで行内に `EnemyNotes`(`data-ui="enemy-notes"`: その敵機のメモと「＋ メモを書く」)を開閉する。開くのは一度に1行
- 「表で見る」の表は変えない

### 6.5 その他画面 → メモ一覧(単位4)
- `MoreView` の「設定」と「データ」の間に `Panel title="メモ"` を置き、`div data-ui="more-notes"` の中に RowList の1行を出す
  - 'on': 本文「メモ」、補足 `n件`。タップで `NoteList`
  - 'off': 補足 `ログイン状態を保持すると使えます`。タップできない(onSelect を渡さない)
  - 'error': 補足 `読み込めませんでした`。タップで `reload()`
  - `notes` props が無い(Skeleton 経由)ときはパネルを出さない
- `NoteList`(Layer `ui="note-list"`): head に戻る(`data-ui="note-list-back"`「その他」)・見出し「メモ」・「書く」(`data-ui="note-write"`)
  - `ToggleGroup ui="note-tabs"`: `すべて n` / `敵機 n` / `日付 n` / `ピン n`
  - すべて・日付・ピン: `NoteItem`(紐付け先のラベル付き)の一覧
  - 敵機: `groupByEnemy` の順に、`data-ui="note-group"` の見出し(機体名と `n件`)とその `NoteItem` を並べる
  - 0件: `メモはまだありません`

### 6.6 ui-check に足す画面 id
すべて start `report-session-valid`(既存のプリセット。`?session=valid` で Cookie が付き、モックが fixture のメモを返す)。テキストの具体値は実装時に fixture から確定させ、文字列で書く。

| 単位 | id | viewport | 操作の要点 | 主な required / 検査 |
|---|---|---|---|---|
| 2 | `mobile-match-detail-notes` | M | 試合検索 → 先頭の結果を開く | `[data-ui="panel"] h2`「敵機のメモ」、`[data-ui="match-notes"] [data-ui="note-item"]` 1件以上、`[data-ui="note-write"]`。inview: `[data-ui="match-notes"]`。tap: note-item・note-write |
| 2 | `mobile-note-sheet` | M | ↑ +「メモを書く」 | `[data-ui="note-sheet"] textarea`、`[data-ui="note-kind"] button[aria-pressed="true"]`「敵機」、`[data-ui="note-enemy"] [data-ui="select-trigger"]` に先頭試合の opponent1_ms、`[data-ui="note-save"]`、`[data-ui="match-detail"][inert], [inert] [data-ui="match-detail"]`。tap: note-save・note-kind button |
| 2 | `note-sheet` | D | 同上 | 同上(広い画面の見え方) |
| 2 | `mobile-note-saved` | M | ↑ + textarea に `ui-check で書いたメモ` を入力 → 保存 | `[data-ui="match-notes"] [data-ui="note-item"]` に入力した文字列。absent: `[data-ui="note-sheet"]` |
| 2 | `mobile-note-sheet-error` | M | ↑ + `保存エラー` を入力 → 保存。expectConsole `status of 500` | `[data-ui="note-sheet"] [data-ui="notice"][role="alert"]`「メモを保存できませんでした」、`[data-ui="note-save"]:not([disabled])` |
| 3 | `mobile-search-notes` | M | 試合検索 | `[data-ui="search-result"] [data-ui="note-mark"]` 1件以上 |
| 3 | `mobile-search-filter-notes` | M | 絞り込み → `search-note-filter`(シートを開いたまま撮る。tap 検査の対象がシートの中にあるため) | `[data-ui="search-applied"]`「メモがある敵機との試合」、印付きの結果が1件以上。absent: `[data-ui="search-result"]:not(:has([data-ui="note-mark"]))` |
| 3 | `mobile-report-matchup-notes` | M | 相性タブ → 印付きの敵機の行をタップ | `[data-ui="note-mark"]` 1件以上、`[data-ui="enemy-notes"] [data-ui="note-item"]` 1件以上、`[data-ui="enemy-notes"] [data-ui="note-write"]` |
| 4 | `mobile-more-notes` | M | その他 → メモの行 | `[data-ui="note-tabs"] button` 4件、`[data-ui="note-tabs"] button[aria-pressed="true"]`「すべて」、`[data-ui="note-list"] [data-ui="note-item"]` 6件。tap: note-tabs button・note-item・note-list-back |
| 4 | `mobile-more-notes-enemy` | M | ↑ + タブ「敵機」 | `[data-ui="note-group"]` が3件(ストームレイダー・ヴァルキュリア・ガルーダ零)、2件ある敵機の見出しに `2件` |

基準画像が変わる既存画面: 単位4の `more`・`mobile-more`・`mobile-more-confirm`・`mobile-more-auto-refresh`・`mobile-more-auto-refresh-error`(メモの行が増えるため)。単位2・3では既存画面の画像は変わらない想定。CI が差分を出したら artifact で原因を確かめる。
画面数は 75 → 80(単位2)→ 83(単位3)→ 85(単位4)、画像は 150 → 160 → 166 → 170 枚。

---

## 7. テスト計画

| 対象 | 追加するテスト | 検証コマンド |
|---|---|---|
| server | `TestNotesRequireSession`(4メソッド×Cookie無し・解決できないトークンで401、store を呼ばない)/ `TestNotesMethods`(PATCH /notes・GET /notes/{id} で405)/ `TestNotesContentType`(415)/ `TestNotesValidate`(表駆動: 空・空白だけ・500字は通る・501字・絵文字500字は通る・CRLF の正規化・制御文字・enemy で enemy_ms が空・enemy に date・date の形式不正(`2026-13-01`)・date は通る・free に enemy_ms・未知の kind・機体名65字)/ `TestNotesCRUD`(作成201→GET に含まれる→PUT で本文が変わり created_at は不変→DELETE 200→GET が空。別ユーザーの GET に出ない・別ユーザーの PUT は404)/ `TestNotesStoreErrors`(ErrNoteLimit・ErrPinLimit→409、ErrNoteNotFound→404、その他→500、UUID でない id・後ろにパスが続く id→404)/ `TestNotesRateLimit`(31回目の書き込みが429、GET は制限しない) | `go test -race ./internal/server/` |
| server | `TestDataAPIsRequireSession` に `/notes` を追加 | 同上 |
| firestore | `TestNotesCheckCreate`(`checkCreate`: 件数が2000未満なら通り2000件で ErrNoteLimit / ピン付きで他のピンが3件なら ErrPinLimit・2件なら通る / ピンなしはピン数を見ない)/ `TestNotesCheckUpdate`(`checkUpdate`: ピン総数3で自分が未ピンのままピンにすると ErrPinLimit・ピン総数3で自分がピン済みなら通る(自分を除く)・ピンを外す更新は上限でも通る)/ `TestNotesSortOrder`(UpdatedAt 降順・同じなら ID 昇順)。トランザクション自体はエミュレータなしでは試せないので、規則を純粋関数に切り出してテストする | `go test -race ./internal/firestore/` |
| lib/notes.js | `static/__tests__/notes.test.js`: §5.2 の全関数(自機の指定ありとなし・相手2機が同じ機体・kind 切替での項目のクリア・絵文字の文字数・sanitizeNotes が壊れた項目を落とす・msChoices の並び)。さらに `components/notes.js` と `lib/notes.js` に `dangerouslySetInnerHTML`・`innerHTML`・`localStorage` が無いことの静的検査 | `node --test static/__tests__/notes.test.js` |
| popover.js | `popover.test.js` に `createLayerStack`(push 2つ → 上だけ isTop、上を remove → 下が isTop、途中を remove しても順序が保たれる) | `node --test static/__tests__/popover.test.js` |
| props の渡し忘れ | `skeleton-actions.test.js` に「全ての `<${SearchView}` に `notes=`」(単位2)、「全ての `<${MatchupPane}` に `notes=`」(単位3) | `node --test static/__tests__/skeleton-actions.test.js` |
| analysis/search.js | `search.test.js`(単位3): noteEnemies で印のある試合だけ残る / my_ms 付きのメモは自機が違う試合では残らない / notes を渡さないと0件 / hasActiveFilters が真 / appliedFilterLabels に文言が出る | `node --test static/__tests__/search.test.js` |
| ui-check | `server.test.js`: Cookie 付きの GET は fixture の件数、Cookie 無しは 200 で空、POST `保存エラー` は500、通常の POST は201で id がある。`fixture.test.js`: fixture のメモの敵機は、日付の新しい順で先頭の試合の相手(単位2)か `computeEnemyMatchup(全試合)` の strong ∪ weak(単位3)のどちらかに入り、それぞれに当てはまるメモが1件以上ある | `node --test tools/ui-check/server.test.js tools/ui-check/fixture.test.js` |
| 画面 | §6.6。CI の UI Check で撮影・比較する(ローカルでは回さない) | PR の `ui-check` ジョブ |

手元の node が使えないとき(Intel Mac)は catalyzer-oracle イメージで test-js を回す(メモリ reference_docker-js-oracle)。

---

## 8. sub-issue への分割

PR タイトルに `(#番号)` を入れない(ナレッジ build-no-deploy-pr-number-from-title。#535 が直るまで)。

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

---

## 9. レビュー観点(主観判断。完了条件には入れない)
- シートの入力欄・ボタンの配置がスマホで押しやすいか(CI の artifact 画像で見る)
- 印のアイコンの見た目と大きさ、文字数カウンタの色
- 文言が ui-terminology に沿っているか(敵機・自機・相手・相方)
- 単位ごとの差分に、他の単位の範囲が混ざっていないか

## 10. CLAUDE.md・README の更新対象
| 単位 | CLAUDE.md | README |
|---|---|---|
| 1 | 主要エンドポイントに `GET|POST /notes`・`PUT|DELETE /notes/{id}`(メモ。セッション本人のみ)。コード構成の `internal/model`(`Note`)・`internal/firestore`(`notes.go`。`notes/{userKey}/items/{id}` に1件1ドキュメントで持つ)・`internal/server`(`notes.go` メモ API) | ツリーに `firestore/notes.go`・`server/notes.go` |
| 2 | `static/lib/notes.js`・`static/components/notes.js` の行を新設。`popover.js` の行に Layer(重なると最上位だけ Esc で閉じる)。`search.js` の行に敵機のメモ。`static/styles/` を全16ファイルに。`tools/ui-check/` の行に `/notes` のモック(Cookie 付きでサンプル、無ければ空・200)と fixture のメモ。`static/__tests__/` の列挙に notes。画面数 80画面・160枚 | ツリーに lib/notes.js・components/notes.js、styles を全16ファイル、`__tests__/notes.test.js`。表の static/components・static/lib |
| 3 | `static/analysis/search.js`・`static/components/search.js` の行にメモの絞り込みと印、`report/` の行に相性タブの印。83画面・166枚 | 必要なら components の説明 |
| 4 | `shell.js` の行に MoreView のメモ一覧。85画面・170枚 | shell.js の説明 |

## 11. エスカレーション事項
- 不可逆な操作・外部公開: なし。prod の Firestore には、最初の保存で `notes` コレクションができるだけ(移行・infra の変更なし)。
- 保持期間: メモはログアウトしてもサーバーに残る(それが目的)。ユーザー単位で全部消す機能は段階1に含めない。ログアウトの説明文(「保存したログイン情報と端末内の試合データを削除します」)は変えなくても正しい。
- 既存の基準画像: 単位4で、その他画面の5枚が意図した変更として変わる(`ui-baseline` ラベルで撮り直す)。

## 12. ナレッジ候補・起票候補
ナレッジ候補(knowledge-add):
- メモは `notes/{userKey}/items/{id}` に1件1ドキュメントで持つ。件数・ピン上限は書き込みと同じトランザクション内の count 集計で判定する(全件を読まない)。1MiB の制約を受けない代わりに、一覧は件数分の読み取りになる
- 全画面の Layer は重なると最上位だけが Esc で閉じる(useDismiss が document の keydown を全部の層で聞くため)
- ui-check のモックは 401 を返さない。セッション失効の画面で Report の取得が console エラーになり、その画面が落ちる(/notes は Cookie なしでも 200 で空)

起票候補(issue-create):
- develop に 31,836,226 バイトの実行ファイル `server` がコミットされている(f5f6a47。`.gitignore` に `/server` が無い)。今回の範囲外
- Layer の中の Dropdown(FilterSheet など)で Esc を押すと、ドロップダウンと層が両方閉じる(どちらも document の keydown で閉じるため。コードを読んで確認しただけで、実機では未確認)
