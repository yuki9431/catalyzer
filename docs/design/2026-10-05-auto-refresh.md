# 設計: 自動更新(最終アクセスから30分間、5分おきに新しい試合を取り込む)

- ステータス: draft
- 日付: 2026-10-05
- 関連 issue: #288

## 0. 概要

### 0.1 エスカレーション該当(main が判断すること)
- **本番リソース操作(不可逆寄り)**: shared スタックの手動 `pulumi up`(API 有効化・SA・IAM の追加)と、prod への Job/Scheduler 作成。実行するのはオーナー。implementer は preview まで
- **外部公開**: 公開サービスに新しいエンドポイント 4 本(うち 1 本は OIDC 保護の内部用)を足す。セッション token(ベアラ資格)を新ドキュメントにも複製して保持する。ユーザーに代わって公式サイトへ 5 分おきに自動アクセスする(1 回あたり 2〜3 リクエスト/ユーザー)
- **検証シグナル不在(stg 実機でしか確かめられない)**: allUsers 公開サービスに Scheduler の Authorization ヘッダが届くか、Scheduler のサービスエージェントが OIDC トークンを発行できるか、Job の起動権限、料金の実測。§9.3 の stg 検証手順に分けた
- **要求の曖昧さ**: 「5 分以内に反映」の解釈、合言葉を変えたときの扱い、Job 起動権限の付与方式。§10 の未決事項に入れた
- **調査で判明した重要事実**: **stg と prod は同じ Firestore DB(`exvs-analyzer`)を共有している**(`infra/app/Pulumi.{stg,prod}.yaml` の `firestoreDatabase`)。環境で分けないと両環境の Job が同じユーザーを更新する。§1 の `env` フィールドで分離する

### 0.2 方針(採用案)と、検討して捨てた案
採用: Scheduler(環境ごとに 1 本、5 分おき)→ サービスの `POST /internal/auto-refresh/tick`(Go 側で OIDC を検証)→ Firestore の `auto_refresh` を 1 クエリ → 対象がいれば Cloud Run Job を overrides なしで起動 → Job が自分で対象一覧を引き直し、ユーザーごとに lease を取って保存済み Cookie で差分だけ取り込む。

| 論点 | 採用 | 捨てた案 | 捨てた理由 |
|---|---|---|---|
| 実行場所 | Cloud Run Job | サービス内 goroutine | `cpuIdle:true`(リクエスト課金)ではレスポンス後の goroutine の CPU が絞られる。インスタンス停止で処理が消える |
| 起動経路 | Scheduler → サービス(判定)→ Job | Scheduler → Job 直接起動 | 毎 tick で Job が起動して課金される(月 8,640 回)。「誰もいない時間はほぼ 0 円」を満たせない |
| Job への対象の渡し方 | Job が Firestore を自分で引く | tick が overrides で対象を渡す | `run.jobs.runWithOverrides` が要り権限が広がる。引数の上限も気にすることになる |
| Cookie の引き方 | `auto_refresh` ドキュメントに token を持つ | `sessions` を `user_key` でクエリ | 複合 index が要る。「最後に更新された jar」はユーザーが今使っている端末を表さない |
| Job 起動の実装 | REST(`golang.org/x/oauth2/google`) | `cloud.google.com/go/run/apiv2` | 後者は新しいモジュールと gRPC クライアントを足す。REST は既存の indirect 依存だけで済む |
| 合言葉の試行制限 | インメモリ(ユーザー + IP の 2 キー) | Firestore カウンタ | §3.2 |
| 環境の分離 | ドキュメントの `env` で絞る(メモリ上で) | 環境別コレクション / 複合 index | 対象は数十件なのでメモリで絞れば index が要らない。lease はユーザー単位で環境をまたいで共有した方が都合がよい(同じアカウントを両環境が同時に叩くのを防げる) |

### 0.3 ナレッジ候補・起票候補
- ナレッジ候補
  - stg と prod は Firestore DB `exvs-analyzer` を共有している。ユーザー単位の状態を足すときは環境の識別が要る
  - 自動更新の構成理由: サービスで判定してから Job を起動するのは、誰もいない tick を Firestore 1 read で済ませるため。overrides を使わないのは Job 起動を `run.jobs.run` だけに収めるため
  - 保存済み Cookie 経路でのセッション失効は、戦績トップの最終 URL が `/login` かどうかで判定する(bnid-auth-chain の帰結)
  - (stg で検証した後)allUsers 公開の Cloud Run に Authorization ヘッダが届くかどうかの実機結果
- 起票候補
  - サービスの実行 SA がデフォルトの compute SA で、`roles/editor` を持っている。専用 SA に移し、Job 単位の `roles/run.invoker` に絞る
  - `/matches` が `user_key` だけで読める(認証が無い)
  - 手動分析(Run)が 403 のときもセッション期限切れと表示する(本設計ではセッション削除だけを止め、表示文言は変えない)
  - 手動分析での jar 再保存が非同期(`go func`)で、lease の解放より後に書き込まれうる

---

## 1. 構成図

```
[Browser]
  │ 起動時 / visibilitychange=visible:
  │   POST /auto-refresh/touch   (catalyzer_session Cookie)
  │   GET  /matches?user_key=K&after=<IndexedDBの最新-1分>
  ▼
[Cloud Run Service  ingress ALL / allUsers=run.invoker / 実行SA=compute default]
  ▲  POST /internal/auto-refresh/tick
  │  Authorization: Bearer <OIDC  aud=https://<domain>  email=scheduler SA>
[Cloud Scheduler  <serviceName>-auto-refresh-tick  "*/5 * * * *" Asia/Tokyo  retry 0]
        │
        │ tick: OIDC検証 → auto_refresh where active_until > now (1クエリ)
        │       → Eligible(env一致・enabled・token有・lease空き) が1件以上なら
        ▼       POST https://run.googleapis.com/v2/{AUTO_REFRESH_JOB}:run  (body {})
[Cloud Run Job  <serviceName>-auto-refresh  実行SA=auto-refresh-job  1vCPU/512Mi  timeout 240s  retry 0]
   ListActive → Eligible → ユーザーごとに並列:
     AcquireRefreshLease → LoadSession(token) → 復号/復元
     → GetLatestDatetime + LoadMatchIDsAt → ScrapingWithOption(SavedJar, since=最新-1分, SkipMatchIDs)
     → FillMsNames → SaveScores(新規があれば) → UpdateSessionJar(同期) → FinishRefresh(lease解放+結果)
        │
        ▼
[Firestore  exvs-analyzer  ※stg/prod共有]
  auto_refresh/{userKey}                     ← 新規
  sessions/{token}                           ← 既存 (user_key, jar, updated_at, expire_at[TTL])
  users/{userKey}/matches/{datetime_matchID} ← 既存
```

### `auto_refresh/{userKey}`(新規コレクション、ドキュメント ID は userKey)

| フィールド | 型 | 意味 | 書き手 |
|---|---|---|---|
| enabled | bool | ユーザーが有効にしている | POST /auto-refresh |
| env | string | 有効化・touch した環境(`prod`/`stg` = `APP_ENV`) | enable / touch |
| session_token | string | 最後に touch した端末の sessions doc ID。空なら停止中 | enable / touch / Job(失効時に空にする) |
| passphrase_fp | string | 有効化時点の合言葉ハッシュの指紋(§3.4)。開放モードでは `open` | enable |
| last_access | timestamp | 最終アクセス | enable / touch |
| active_until | timestamp | last_access + 30 分。**tick の対象判定に使う唯一のクエリ列**。停止時はゼロ値 | enable / touch / Job |
| lease_until | timestamp | 排他の期限。ゼロ値なら空き | Job / 手動分析 |
| lease_owner | string | `job:<CLOUD_RUN_EXECUTION>` または `manual:<jobID>` | 同上 |
| last_run_at | timestamp | 最後に Job が処理した時刻 | Job |
| last_result | string | `ok` / `no_session` / `session_expired` / `access_denied` / `error` / `skipped` | Job |
| consecutive_failures | int | `error` が連続した回数 | Job |
| updated_at | timestamp | ServerTimestamp | 全書き込み |

- **TTL: 設定しない**。有効化はユーザーの明示的な設定であり、ドキュメントも数十件・数百バイトでコストは無視できる。ログアウト後に残った token は Job が `no_session` と判定して空にする
- **index**: `Where("active_until", ">", now)` は自動作成される単一フィールド index で足りる。`env`・`enabled` の絞り込みはメモリ上で行うので**複合 index は不要**
- `sessions` と `matches` のスキーマは変えない。`sessions` に足すのは `jar`/`updated_at` だけを更新する関数のみ(`expire_at` は延ばさない。ブラウザの Cookie MaxAge と揃えるため)

---

## 2. 内部エンドポイントの認証

- 前提: サービスは `allUsers` に `run.invoker` を付けて公開しているので、Cloud Run の IAM は認証にならない。認証は **Go 側の検証だけ**が担う
- 新規ファイル `internal/server/oidc.go` に `requireSchedulerOIDC(next http.Handler, audience, invoker string, validate tokenValidator) http.Handler` を置く
  - `type tokenValidator func(ctx context.Context, token, audience string) (*idtoken.Payload, error)`。本番では `idtoken.Validate` を渡し、テストでは偽物を注入する
  - `audience` か `invoker` が空なら **404 を返す**(fail-closed)。`idtoken.Validate` は audience が空だと検証を飛ばすので、空のまま呼ばない
  - `Authorization: Bearer <tok>` が無い・形式が違う → 401。`validate` がエラー → 401
  - `payload.Claims["email"] != invoker`、`Claims["email_verified"] != true`、`payload.Issuer` が `https://accounts.google.com` / `accounts.google.com` 以外 → 403。issuer を `Validate` が見るかは未確認なので、自前で明示的にも確かめる
  - トークンの中身はログに出さない
- audience = `https://<domain>`(config の `domain`)。Scheduler の target URI = `https://<domain>/internal/auto-refresh/tick`
  - `service.uri` を使わないのは、サービスの env に自分自身の URI を入れると Pulumi で循環参照になるため。カスタムドメインは domain mapping で既に本番トラフィックを受けている
  - URI の値は config から組み立て、ハードコードしない
- Basic 認証との併存: `basicAuth(securityHeaders(mux), "/health", "/internal/auto-refresh/tick")` と、スキップするパスを足す。Basic 認証も Authorization ヘッダを使うので衝突を避ける(現状は env 未設定で Basic 認証自体が無効)
- go.mod: `google.golang.org/api` は **indirect v0.274.0 として既に入っている** → `idtoken` を import すると direct に昇格する。新しいモジュールは増えない。最新は v0.300.0 だが、今回は上げない(既存の固定版で足りる)
- **Authorization がハンドラまで届くかは公式ドキュメントで確認できていない** → §9.3 の S1・S2 で確かめる。届かなかった場合の代替(設計の見直し対象): Scheduler の任意ヘッダに共有シークレットを載せ、`subtle.ConstantTimeCompare` で照合する(シークレットが Scheduler の設定として閲覧者に見えるので、OIDC より弱い)

---

## 3. 合言葉

### 3.1 照合
`autorefresh.Gate.Verify` で argon2id の導出鍵を `subtle.ConstantTimeCompare` で比べる(定数時間)。入力は 1〜128 文字、ボディは `MaxBytesReader` で 1KB に抑える。

### 3.2 試行制限
- `internal/server/ratelimit.go` の `rateLimiter` を**そのまま流用**する。`getLimiter(ip string)` は任意の文字列キーで動く
- 新しいインスタンス `passphraseLimiter = newRateLimiter(rate.Every(12*time.Minute), 5)`(1 時間 5 回、バースト 5)を作る
- キーは `user:<userKey>` と `ip:<clientIP>` の 2 つ。**両方が Allow** の場合だけ照合し、どちらかが拒否なら 429
- 判定は argon2 の計算より前に行う(19MiB を使うので DoS 対策にもなる)
- Firestore カウンタは**入れない**。根拠:
  - 試行するには有効なセッション、つまり実在するバンダイナムコ ID でのログインが必要で、試行の主体が限られる
  - インメモリの限界は「5 回/時 × インスタンス数(prod は最大 3)= 15 回/時/ユーザー」。12 文字以上のランダムな合言葉なら総当たりは現実的でない
  - カウンタは試行のたびに Firestore の read/write とトランザクションを足す。数十人規模に見合わない
  - 運用指針として「合言葉は 12 文字以上のランダム文字列」を README か運用メモに書く

### 3.3 保存形式

| 方式 | ハッシュが漏れたときの総当たり耐性 | 実装量 | 依存 | 照合 1 回のコスト |
|---|---|---|---|---|
| SHA-256 | 低い(低エントロピーなら GPU で即座に割れる) | 最小 | 標準 | μs |
| HMAC-SHA256 + pepper | pepper も漏れれば SHA-256 と同等 | 小 | 標準 | μs |
| bcrypt(cost 12) | 中〜高。OWASP の位置付けはレガシー向け | 1 呼び出し | x/crypto(indirect→direct) | 約 250ms |
| **argon2id(m=19456KiB, t=2, p=1)** | **高い。OWASP の第一推奨** | PHC 形式のパース(約 30 行・テスト付き) | x/crypto(indirect v0.49.0→direct) | 数十 ms / 19MiB |

- 結論: **argon2id**。数十人・低頻度なのでコストは問題にならず、依存の追加は indirect からの昇格だけ
- 合言葉はハッシュ生成と照合の両方で NFKC 正規化と前後の空白除去をしてから argon2id に渡す(全角・半角、結合文字の揺れを区別しない。内側の空白と漢字の違いは区別する)。日本語の合言葉を打てるよう入力欄は type=text(PR #471)
- 保存は PHC 文字列 `$argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>`(salt 16 バイト、鍵長 32、base64 は RawStd)
- 渡し方: オーナーが `go run ./cmd/hash-passphrase` に標準入力で合言葉を渡して PHC を得る → `pulumi config set --secret autoRefreshPassphraseHash '<PHC>'`(スタックごと)→ Pulumi がサービスの env `AUTO_REFRESH_PASSPHRASE_HASH` に入れる
  - 既存の `SESSION_ENCRYPTION_KEY` と同じく env に平文で入るので、Cloud Run コンソールで閲覧者に見える。argon2id のハッシュなので許容する。Secret Manager はここでは過剰と判断した

### 3.4 合言葉を変えたときの既存ユーザー
有効化時にハッシュの指紋 `passphrase_fp = hex(sha256(PHC))[:16]` を保存しておく。

| 案 | 動作 | 利点 | 欠点 |
|---|---|---|---|
| A 維持 | 照合は有効化の時点だけ | 最も単純 | 一度渡した合言葉を取り消せない |
| **B 一斉無効化(推奨)** | GET /auto-refresh と touch で `passphrase_fp` が現在の指紋と違えば `enabled=false` に戻す | 合言葉の変更が取り消し手段になる。比較 1 回で済む | 全員が合言葉を入れ直す。無効化が効くのは次のアクセス時なので、最大 30 分は動き続ける |
| C 個別に手動 | Firestore を手で編集する | 実装が要らない | 運用が重く、誤操作の危険がある |

推奨は B。オーナーの運用判断なので §10 の U1 に入れた。

### 3.5 将来の全ユーザー開放
- env `AUTO_REFRESH_OPEN=true`(Pulumi config `autoRefreshOpen`、bool、既定 false)のとき、合言葉の照合を飛ばし、指紋を `open` とする
- `available = AUTO_REFRESH_JOB != "" && session.Enabled() && (Hash != "" || Open)`
- 開放をやめて合言葉ありに戻すと、`open` のユーザーは B と同じく無効化される

---

## 4. Cookie の使い回し

### 4.1 ユーザーと token の紐付け
- 採用: `auto_refresh.session_token` に、最後に touch した端末の token を持たせる
- 比較:
  - `sessions` を `user_key ==` + `updated_at desc` で引く案は、複合 index(shared の `gcp.firestore.Index`)が要る
  - 加えて、Job が jar を保存し直すと `updated_at` が動き、「最新の jar」がユーザーが今使っている端末を表さなくなる
  - token 方式は 1 read で済み、index も要らない
- 複数端末のとき: 最後に開いた(touch した)端末の token を使う。その token が失効して Job が停止しても、別の端末で開けば touch が token を書き換えて再開する

### 4.2 失効と一時障害の分類

| 事象 | 分類 | Job の動作 |
|---|---|---|
| sessions doc が無い / 復号・復元に失敗 | no_session | 復号失敗なら DeleteSession(`handleSessionCheck` と同じ扱い)。session_token を空にし、active_until をゼロ値にする |
| `ErrLoginFailed` / `ErrUnauthorized`(新しい着地チェックを含む) | session_expired | DeleteSession(token)。session_token を空にし、active_until をゼロ値にする。次にアクセスすると既存の `/session` が valid:false を返し、ログイン画面が出る |
| `ErrAccessDenied`(403。途中データがあれば先に保存) | access_denied | セッションは残す。active_until をゼロ値にして、次のアクセスまで止める(レート制限の疑い) |
| `ErrServerError` / `ErrHTTPRequestFailed` / `ErrNotFound` / タイムアウト / Firestore エラー | error | セッションは残す。consecutive_failures を 1 増やし、3 回に達したら active_until をゼロ値にする |
| 最新試合が無い(GetLatestDatetime がゼロ値) | skipped | スクレイピングしない(全件取得の暴走を防ぐ) |
| 成功 | ok | consecutive_failures を 0 に戻す |

- **保存済み Cookie 経路で失効を検知できていない問題への対処**: `collectDailyLinks` は今、`_ = c.Visit` でエラーを捨てており、ログイン画面に着地しても気づかない
  - 純粋関数 `classifyRankpageResponse(final *url.URL, status int, visitErr error) error` を新設する
    - `isVsmobileAuthed(final)` が false → `ErrLoginFailed` をラップして返す
    - 403 → `ErrAccessDenied`、それ以外のステータスは `classifyHTTPError` に回す
    - ネットワークエラー → `ErrHTTPRequestFailed`
  - `collectDailyLinks` の OnResponse/OnError でこの関数を使う
  - colly はリダイレクト後の最終 URL を `r.Request.URL` に反映する(colly v2.1.0 `colly.go:660` で確認済み)
- **Run が一時障害でもセッションを消す問題**: `scraper.IsSessionExpired(err) bool`(`ErrLoginFailed` か `ErrUnauthorized`)を公開する。`pipeline.Run` のセッション削除条件を `shouldDeleteSession(usingSession, token, err)` = `usingSession && token != "" && IsSessionExpired(err)` に変える
  - 上のエラー捕捉で、一時障害が Run の削除経路に入るようになる。だから**この修正は必須**
  - エラー表示の switch は変えない(403 のとき「期限切れ」と表示する点は起票に回す)

### 4.3 排他(lease)
- `firestore.AcquireRefreshLease(ctx, userKey, owner string, now time.Time, ttl time.Duration) (bool, error)`。RunTransaction の中で:
  - ドキュメントが無い → `(true, nil)` を返し、何も書かない(自動更新を使っていないユーザーの手動分析)
  - `!st.LeaseFree(owner, now)` → false
  - それ以外 → `lease_until=now+ttl`、`lease_owner=owner` を書いて true
- 判定は `model.AutoRefreshState.LeaseFree(owner string, now time.Time) bool`(`lease_until` が now 以前、または `lease_owner == owner`)という純粋なメソッドにし、tick の Eligible と共有する
- `firestore.FinishRefresh(ctx, userKey, owner string, upd model.RefreshUpdate) error`: トランザクションで `lease_owner == owner` のときだけ、lease を空けて結果を書く。owner が違う(lease を失った)なら何もしない
- `firestore.ReleaseRefreshLease(ctx, userKey, owner string) error`: 手動分析用で、owner が一致したら空ける
- TTL: Job は 5 分(タスクの timeout 240s より長い。kill されても次の tick 1 回分の遅れで済む)。手動は 15 分
- **手動分析との排他**: `/analyze` と `/reanalyze` は Job を起動する前に `AcquireRefreshLease(userKey, "manual:"+j.ID, now, 15m)` を呼ぶ
  - false なら 409 `{"error":"自動更新で最新の試合を取得中です。30秒ほど待ってから再度お試しください。"}` を返す。フロントの既存のエラー経路でそのまま表示される
  - Firestore エラーなら警告ログを出して続行する(本機能より主機能を優先し、fail-open)
  - goroutine の最後で `ReleaseRefreshLease` を呼ぶ
- **Job 同士の排他**: tick が重なって 2 つの execution が同時に走っても、ユーザー単位の lease で重複を防ぐ。同一 Job の同時実行について公式の記述は無い(research)ので lease で担保する

### 4.4 jar の再保存
- `firestore.UpdateSessionJar(ctx, token string, encryptedJar []byte) error` を新設する。`Update` で `jar` と `updated_at` だけを書く
- 存在しないドキュメントへの Update は NotFound で失敗するので、Job 実行中にログアウトされても**セッションを復活させない**
- Job は lease を持ったまま**同期的に**保存し、それから FinishRefresh を呼ぶ。同じユーザーに対する手動分析・他の Job とは lease で直列化されるので、書き込みの競合は起きない
- 別端末は token が違うので別ドキュメントになる
- 手動分析の非同期保存(既存)は残る。lease 解放後に書き込まれる余地があるが、どちらの jar も有効なので許容し、起票候補にした

---

## 5. pipeline の再利用

- Run は使い回さない。Run はジョブストア・速報・全件読み込みと結びついており、Cookie だけで動く経路としては重すぎる
- 新パッケージ `internal/autorefresh` を作る。依存は `model ← mslist/scraper/firestore/session ← autorefresh ← server`(pipeline と同じ層)で、pipeline は import しない
  - `cmd/auto-refresh/main.go` が `pipeline.DefaultMSListPath` から MS マップを読み込んで渡す(cmd は pipeline を import してよい)

```go
package autorefresh

const (
    ActiveWindow   = 30 * time.Minute
    jobLeaseTTL    = 5 * time.Minute
    ManualLeaseTTL = 60 * time.Minute // 完了時に解放する。初回の全件取得より長くとる(PR #467 レビュー)
    perUserTimeout = 200 * time.Second
    maxFailures    = 3
)

type Gate struct{ Hash string; Open bool }
func (g Gate) Available() bool
func (g Gate) Required() bool
func (g Gate) Fingerprint() string
func (g Gate) Verify(passphrase string) (bool, error)
func HashPassphrase(passphrase string) (string, error)

type Config struct{ Env, JobName, Audience, Invoker string; Gate Gate }
func ConfigFromEnv() Config // APP_ENV, AUTO_REFRESH_JOB, AUTO_REFRESH_AUDIENCE, AUTO_REFRESH_INVOKER, AUTO_REFRESH_PASSPHRASE_HASH, AUTO_REFRESH_OPEN

type Outcome string // ok / no_session / session_expired / access_denied / error / skipped
func classify(err error) Outcome
func nextUpdate(prev model.AutoRefreshState, o Outcome) model.RefreshUpdate
func Eligible(states []model.AutoRefreshState, env string, now time.Time) []model.AutoRefreshState

type Store interface { /* §4 の firestore 関数 + LoadSession/DeleteSession/GetLatestDatetime/LoadMatchIDsAt/SaveScores */ }
type ScrapeFunc func(since time.Time, opt scraper.ScrapingOption) (model.DatedScores, http.CookieJar, error)

func RunJob(ctx context.Context, env, owner string, msMap map[string]string) error // 本番 Store/scrape を内部で組み立てる
func runJob(ctx context.Context, d deps, env, owner string, msMap map[string]string) error // テスト用に deps を注入
func LaunchJob(ctx context.Context, client *http.Client, jobName string) error // POST {runAPIBase}/v2/{jobName}:run。runAPIBase は差し替え可能な変数
```

```go
// model(純粋な型)
type AutoRefreshState struct {
    UserKey, Env, SessionToken, PassphraseFP, LeaseOwner, LastResult string
    Enabled bool
    LastAccess, ActiveUntil, LeaseUntil, LastRunAt time.Time
    ConsecutiveFailures int
}
func (s AutoRefreshState) LeaseFree(owner string, now time.Time) bool

type RefreshUpdate struct {
    LastResult          string
    ConsecutiveFailures int
    ClearSessionToken   bool
    StopActive          bool
}
```

```go
// firestore(新規 autorefresh.go + 既存ファイルへの追加)
func GetAutoRefresh(ctx context.Context, userKey string) (*model.AutoRefreshState, error) // NotFound なら nil, nil
func EnableAutoRefresh(ctx context.Context, userKey, env, token, fp string, now time.Time, window time.Duration) error // Set+MergeAll。consecutive_failures を 0 に戻す
func DisableAutoRefresh(ctx context.Context, userKey string) error // enabled=false, active_until=ゼロ値
func TouchAutoRefresh(ctx context.Context, userKey, env, token string, now time.Time, window time.Duration) (*model.AutoRefreshState, error) // Tx。enabled のときだけ更新。last_access が60秒以内なら書かない
func ListActiveAutoRefresh(ctx context.Context, now time.Time) ([]model.AutoRefreshState, error) // Where active_until > now
func AcquireRefreshLease(...) / FinishRefresh(...) / ReleaseRefreshLease(...) // §4.3
func UpdateSessionJar(ctx context.Context, token string, encryptedJar []byte) error // session.go に追加
func LoadMatchIDsAt(ctx context.Context, userKey string, t time.Time) (ids []string, hasLegacy bool, err error) // scores.go。Where datetime == t
```

- **refreshUser の流れ**: lease を取る → LoadSession → 復号/復元 → `latest := GetLatestDatetime`(既存。Limit(1) で 1 read)→ ゼロ値なら skipped
  → `ids, legacy := LoadMatchIDsAt(latest)` → `since = latest - 1分`(`legacy` があれば `since = latest`)
  → `ScrapingWithOption("", "", since, {SavedJar, Context: 200s のタイムアウト付き ctx, SkipMatchIDs: ids})`
  → 403 の途中データを含め、新規があれば `FillMsNames` / `CheckUnknownMS` / `SaveScores`(同期。`bw.End()` で完了を待つ)
  → 成功か 403 なら `SerializeJar` → `Encrypt` → `UpdateSessionJar` → classify → nextUpdate → FinishRefresh
- **同じ分の試合の取りこぼし対策**: スクレイパーは `!t.After(since)` で打ち切るので、分精度で同じ分に後から出てきた試合を逃す
  - `since` を 1 分戻し、既に保存済みの MatchID を `ScrapingOption.SkipMatchIDs map[string]bool` で詳細取得の前に捨てる
  - MatchID は detailURL から `model.MatchIDFromURL` で求まる。フィルタは純粋関数 `skipKnownEntries` にする
  - legacy の試合(match_id が空)が混ざると doc ID が変わって重複するので、その回は従来どおり `since = latest` にする
- **省くもの**: 速報 JSON とジョブストア(閲覧はフロントの差分取得で行う)、ClassRecord(永続化しない付加情報)、TagPartners(変化が稀。手動分析で更新される)、grade チェック
- **Job の終了**: `RunJob` はユーザーごとの goroutine を WaitGroup で全部待ち、`[INFO] auto-refresh done users=N elapsed=Xs` を出してから return する
  - jar の保存も FinishRefresh も各 goroutine の中で同期的に行うので、プロセスが先に終わることはない
  - 終了コードは、初期化か一覧取得の失敗のときだけ 1(main の `log.Fatal`)。ユーザー単位の失敗は 0
  - owner は `job:` + env `CLOUD_RUN_EXECUTION`。空なら uuid
- ユーザーをまたいだ並列数は制限しない(要求どおり)。1 execution で同時に有効な全員を処理する

---

## 6. 料金

### 6.1 前提と式(単価: 2026-10-05 に取得済みの東京リージョン値)
1 回の Job の execution: `C_exec = T × (v × 0.00283 + m × 0.000314)` 円(T = 秒、v = vCPU、m = GiB)。v=1、m=0.5 なら **T × 0.002987 円**。

Firestore(1 ユーザー・1 回、新規なし):
- read 5 件(lease の Tx、LoadSession、GetLatestDatetime、LoadMatchIDsAt、Finish の Tx)
- write 3 件(lease、jar、Finish)。新規試合があると +2 件(users と match)
- → 5 × 0.0000597 + 3 × 0.000181 = **0.00084 円/回**

| ケース | 1 回あたり | 1 時間あたり(12 回) |
|---|---|---|
| T=25s(issue の「最新 1 件」と一致させた値) | 0.0747 + 0.0008 | **0.906 円** ≈ issue の 0.9 円 |
| T=15s(設計上の目標) | 0.0448 + 0.0008 | 0.548 円 |
| 全件読み(N 試合) | 上に N × 0.0000597 を足す | N≈840 で +0.60 → **1.50 円** ≈ issue の 1.5 円 |

- 検算: issue の 0.9 円/時は「1vCPU/0.5GiB で 1 回 25 秒」、1.5 円/時は「それに加えて 1 回 840 試合を全件読み」を前提にしていれば成り立つ
- 月額(23 人 × 10 時間 = 230 ユーザー時): T=25 で 208 円、全件読みで 345 円 → issue の「200〜350 円」と一致。本設計(最新 1 件、T=15〜25)では **126〜208 円**
- 1 つの execution が同時刻に有効な全員を処理するので、利用時間が重なれば実際はこれより安い(上の数字は上限)
- 常時かかる tick の費用(環境ごと・月 8,640 回):
  - Firestore: 0 件でも最低 1 read 課金 → 8,640 × 0.0000597 = **0.52 円**
  - サービスの計算資源の上限見積もり(1 回 0.2s と仮定し、Jobs の単価で代用): prod(2vCPU/1GiB)8,640 × 0.2 × 0.005974 = **10.3 円**、stg(1vCPU/0.5GiB)**5.2 円**
  - ただしリクエスト課金のサービス単価と無料枠(vCPU 秒・リクエスト数)は**未確認**。無料枠に収まれば 0 円
  - 5 分おきの tick がインスタンスを温め続けるが、リクエスト課金ではアイドル中は課金されない
- Scheduler: 2 ジョブ(prod と stg)で無料枠の 3 以内 → 0 円。touch(2 read + 1 write/回)と差分の `/matches` は誤差の範囲

### 6.2 測り方
- **注意: Job は割り当てた vCPU × 実時間で課金される**ので、測るべきは CPU 使用時間ではなく実行時間 T
- ローカル(スクレイピング部分の実時間だけ。コールドスタートは測れない)
  - `go build -o "$TMPDIR/auto-refresh" ./cmd/auto-refresh`
  - `APP_ENV=stg FIRESTORE_DATABASE=<db> GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project) SESSION_ENCRYPTION_KEY=<stgの鍵> /usr/bin/time -l "$TMPDIR/auto-refresh"`
  - `real`(実時間)と `user+sys`(CPU)を見る。実 Firestore と公式サイトに触るので、**オーナーが自分の stg 有効化状態で実行する**(鍵の扱いもオーナーに限る)
- stg で計測(§9.3 の S5)
  - `gcloud run jobs executions list --job="$JOB" --region="$REGION" --limit=12 --format="table(metadata.name,status.startTime,status.completionTime,status.succeededCount)"`
  - フィールド名は `gcloud run jobs executions describe <name> --region="$REGION" --format=yaml` で事前に確かめる
  - T_exec = completionTime − startTime の中央値
  - アプリ側の処理時間は `gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="'"$JOB"'" AND textPayload:"auto-refresh done"' --freshness=2h --format="value(timestamp,textPayload)"`
  - T_exec − 処理時間 = 起動のオーバーヘッド
  - tick の遅延は `gcloud logging read 'resource.type="cloud_run_revision" AND httpRequest.requestUrl:"/internal/auto-refresh/tick"' --freshness=1h --format="value(timestamp,httpRequest.status,httpRequest.latency)"`
  - `$JOB` と `$REGION` は `gcloud run jobs list` かスタック出力から取る(設計書には書かない)
  - 実額は 1 日後に Cloud Billing レポートを SKU(Cloud Run Jobs CPU/Memory)で絞って突き合わせる

---

## 7. IAM・API・デプロイ順

| 主体 | 権限 | 粒度 | 置き場 | 理由 |
|---|---|---|---|---|
| Job SA(新規 `auto-refresh-job`) | `roles/datastore.user` | project(Firestore に DB 単位の predefined ロールは無い。IAM condition で DB を絞るのは任意) | shared/iam.ts | matches/sessions/auto_refresh の読み書き。editor を持つ compute SA を流用しない(最小権限) |
| Scheduler SA(新規 `auto-refresh-scheduler`) | 付与なし | — | shared/iam.ts | OIDC の発行主体としてだけ使う。公開サービスなので run.invoker は不要 |
| Cloud Scheduler のサービスエージェント | API 有効化時に自動付与(トークン発行を含む想定。**未確認**) | — | 自動 | S1 で確認する |
| サービスの実行 SA(compute default) | `run.jobs.run`(overrides を使わない設計なので run.jobs.run だけで足りる) | 現状は `roles/editor` が持っている | §10 の U3 | `roles/run.invoker` を Job 単位で付けるのが本来の形。ただし CI の SA は setIamPolicy を持たない |
| GitHub Actions SA | `roles/cloudscheduler.admin` | project(Scheduler にリソース単位の IAM は無い) | shared の projectRoles | app スタックから Scheduler を作成・更新する |
| GitHub Actions SA | `roles/iam.serviceAccountUser` | Job SA と Scheduler SA の**各 SA 単位** | shared | Job の実行 SA 指定と OIDC の SA 指定に actAs が要る |
| GitHub Actions SA | `roles/run.developer`(既存) | project | 既存 | Job の作成・更新 |

- サービス実行 SA が Job を起動するとき、Job SA への actAs が要るかは**未確認**。今は editor が actAs を含むので問題は表に出ない
- API: `cloudscheduler.googleapis.com` を `infra/shared/apis.ts` に足す
- shared の出力に `autoRefreshJobSaEmail` と `autoRefreshSchedulerSaEmail` を足す。app スタックは既存の StackReference で読む
- Job と Scheduler を app スタックに置く理由:
  - 環境ごとに image・serviceName・domain・SESSION 鍵が違う
  - image は既存の config `image` を共有するので、build.yml の image 更新にそのまま追従し、更新経路を足さずに済む
  - shared は手動 apply かつ環境に依存しない層なので、ここには置かない
- app のリソース(名前は config の `serviceName` から作る)
  - `gcp.cloudrunv2.Job` `${serviceName}-auto-refresh`
    - `template.template`: `serviceAccount`=Job SA、`timeout: "240s"`、`maxRetries: 0`
    - コンテナ: `image`=既存 config、`commands: ["./auto-refresh"]`、`limits {cpu:"1", memory:"512Mi"}`
    - env: `FIRESTORE_DATABASE`、`SESSION_ENCRYPTION_KEY`、`APP_ENV=pulumi.getStack()`
    - taskCount 1 / parallelism 1。`deletionProtection` は provider v9 の既定に従う(既存の Service と揃える)
  - `gcp.cloudscheduler.Job` `${serviceName}-auto-refresh-tick`
    - `schedule "*/5 * * * *"`、`timeZone "Asia/Tokyo"`、`region`=gcp.config.region、`attemptDeadline "30s"`、`retryConfig.retryCount 0`
    - `paused`: config `autoRefreshPaused`(bool、既定 false)
    - `httpTarget`: `{httpMethod:"POST", uri:`https://${domain}/internal/auto-refresh/tick`, oidcToken:{serviceAccountEmail: schedulerSa, audience:`https://${domain}`}}`
  - Service の env に足すもの:
    - `APP_ENV`
    - `AUTO_REFRESH_JOB = pulumi.interpolate`projects/${gcp.config.project}/locations/${region}/jobs/${job.name}``
    - `AUTO_REFRESH_AUDIENCE = https://${domain}`
    - `AUTO_REFRESH_INVOKER` = schedulerSa の email
    - `AUTO_REFRESH_PASSPHRASE_HASH`(config secret `autoRefreshPassphraseHash`。未設定なら入れない)
    - `AUTO_REFRESH_OPEN`(config `autoRefreshOpen`)
- **デプロイ順**
  1. PR-1(shared)をマージ → オーナーが `make pulumi-shared-preview` で差分が §9 の 7 リソースだけか確かめる(他 PR の未適用差分が混ざることがある。ナレッジ pulumi-shared-manual-apply)→ `make pulumi-shared-shell` → `pulumi up`
  2. PR-2(Go + Dockerfile + app TS)を develop にマージ。Go が変わるので content key が変わり、build.yml → stg の image 更新 → deploy.yml の順に自動で進み、Job・Scheduler・env が作られる
  3. オーナーが `go run ./cmd/hash-passphrase` → `STACK=stg make pulumi-app-shell` → `pulumi config set --secret autoRefreshPassphraseHash ...` → yaml をコミットして push(deploy.yml の paths で起動する)
  4. §9.3 の stg 検証
  5. develop → main(マージコミット)→ deploy-prod.yml。prod の合言葉を設定する(手順 3 と同じ)
  6. PR-3(フロント)
- Job が無いか、合言葉も開放設定も無い間は機能自体が無効になる(GET は available:false、tick は対象 0 件)。順序がずれても壊れない

---

## 8. 作業単位の分割

| 単位 | PR | 依存 | 並行可否 | 変更予定ファイル |
|---|---|---|---|---|
| U1 shared インフラ | PR-1 | なし(#413 と独立) | U2 と並行して開発できる。マージと apply は U2 より先 | `infra/shared/apis.ts`、`infra/shared/iam.ts`、`infra/shared/index.ts` |
| U2 バックエンド + app インフラ | PR-2 | マージは U1 の apply 後(デプロイが shared の出力を参照するため)。#413 とは独立 | 今すぐ開発できる | 下の一覧 |
| U3 フロント | PR-3 | #413(PR #453)のマージ後。stg 実機の確認は U2 のデプロイ後 | U1/U2 と並行して開発できる(ui-check はモックで動く) | 下の一覧 |

**U2 の変更予定ファイル**:
- 新規: `internal/autorefresh/{autorefresh.go, passphrase.go, launcher.go, *_test.go}`、`internal/firestore/autorefresh.go`、`internal/server/{oidc.go, autorefresh.go, oidc_test.go, autorefresh_test.go}`、`cmd/auto-refresh/main.go`、`cmd/hash-passphrase/main.go`
- 変更: `internal/firestore/{session.go, scores.go}`、`internal/model/types.go`(+ `types_test.go`)、`internal/scraper/scraper.go`(+ `scraper_test.go`)、`internal/pipeline/pipeline.go`(+ `pipeline_test.go`)、`internal/server/server.go`、`go.mod`、`go.sum`、`Dockerfile`(2 本目のバイナリをビルドして COPY)、`infra/app/index.ts`、`CLAUDE.md`(コード構成・エンドポイント)、`README.md`(プロジェクト構成)

**U3 の変更予定ファイル**:
- 新規: `static/lib/autorefresh.js`、`static/__tests__/autorefresh.test.js`
- 変更: `static/components/shell.js`(MoreView に「自動更新」Panel)、`static/components/report/report.js`(MoreView の呼び出し 2 箇所に props を渡す。ナレッジ props-injection に従い、呼び出し箇所の数を grep で突き合わせる)、`static/app.js`(initSession と visibilitychange で touch → `/matches?after=` の差分 → `saveMatchesToDB` → `loadMatchesFromDB` → `renderReport`。手動分析中(`activeJobId`)と前回の取り込みから 20 秒以内は飛ばす)、`tools/ui-check/server.js`(`GET /auto-refresh` と `POST /auto-refresh/touch` のモック)、`tools/ui-check/screens.js`(more 系の row-list の件数 2→3、新しい画面 `mobile-more-auto-refresh`)、`tools/ui-check/baseline/*`、`CLAUDE.md`(画面数)

**U2 の HTTP API**(いずれも session Cookie が必要。SameSite=Strict で CSRF を防ぐ):
- `GET /auto-refresh` → 200 `{"available","passphrase_required","enabled","status":"off|active|idle|stopped","reason":"|session_expired|access_denied|error|no_session","active_until"}` / 401
- `POST /auto-refresh` `{"enabled":true,"passphrase":"..."}` → 200(GET と同じ形)/ 400 / 401 / 403 `{"error":"合言葉が違います"}` / 409(セッション保持なしでログインしている)/ 429 / 503(機能が無効)。`{"enabled":false}` → 200
- `POST /auto-refresh/touch` → 200 `{"enabled","status"}` / 401
- `POST /internal/auto-refresh/tick` → 200 `{"targets":n,"launched":bool}` / 401 / 403 / 404(未設定)/ 502(起動に失敗)
  - `newTickHandler(list func(context.Context, time.Time) ([]model.AutoRefreshState, error), launch func(context.Context) error, env string, now func() time.Time) http.Handler` として、依存を注入できる形にする

---

## 9. 完了条件とテスト方針

### 9.1 テスト方針
- Firestore と公式サイトに触る部分は、注入した偽物で振る舞いを固定する。lease の判定は `model.LeaseFree`、分類は `classify`/`nextUpdate`/`classifyRankpageResponse`/`shouldDeleteSession` という純粋関数で機械的に検証する
- Firestore のトランザクションそのものの意味(実際の原子性)はユニットテストでは検証しない。stg の S4 で確かめる
- 追加するトップレベルのテスト(19 本):
  - server: `TestRequireSchedulerOIDC`(トークン無し 401 / Bearer でない 401 / 検証エラー 401 / 別 SA 403 / email_verified=false 403 / issuer 不正 403 / 正常 200 / 未設定 404)、`TestCheckPassphrase`(空・誤り 403、正解 200、6 回目は正解でも 429、別ユーザーは影響を受けない、IP キーも効く、開放モードは照合しない)、`TestTickHandler`(対象 0 → launch 0 回で launched:false / 対象あり → 1 回 / launch 失敗 → 502)
  - autorefresh: `TestHashVerifyPassphrase`、`TestGate`、`TestClassify`、`TestNextUpdate`、`TestEligible`、`TestRunJob_LeaseExclusion`(lease が他者に取られたユーザーは scrape 0 回、他のユーザーは処理される、jar の保存が Finish より先)、`TestRefreshUser_SessionExpired`(DeleteSession 1 回、ClearSessionToken)、`TestRefreshUser_TransientKeepsSession`(DeleteSession 0 回)、`TestRefreshUser_NoLatestSkips`、`TestRefreshUser_SinceAndSkipIDs`(since=latest−1 分 と skip 集合 / legacy なら since=latest)、`TestLaunchJob`(httptest で POST `/v2/<job>:run`、200 なら nil、403 ならエラー)
  - model: `TestAutoRefreshStateLeaseFree`
  - scraper: `TestClassifyRankpageResponse`、`TestIsSessionExpired`、`TestSkipKnownEntries`
  - pipeline: `TestShouldDeleteSession`

### 9.2 完了条件

U1:

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| shared の型チェック | `cd infra/shared && npm ci && npx tsc --noEmit` | exit 0 |
| shared の preview(要 ADC) | `make pulumi-shared-preview` | exit 0。create に cloudscheduler API・SA 2 個・projects.IAMMember 2 個・serviceaccount.IAMMember 2 個の計 7 件が含まれ、これらの由来で delete/replace が 0 件 |

U2:

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| ビルド | `go build ./...` | exit 0 |
| Go テスト | `go test -race -count=1 ./internal/...` | exit 0 |
| テスト数 | `go test -count=1 -json ./internal/... \| grep -c '"Action":"pass","Package":"[^"]*","Test":"[^"/]*","Elapsed"'` | 84 → **103**(基線が変わっていれば基線 + 19) |
| 新規テストの合格 | `go test -count=1 -v -run '^Test(RequireSchedulerOIDC\|CheckPassphrase\|TickHandler\|HashVerifyPassphrase\|Gate\|Classify\|NextUpdate\|Eligible\|RunJob_LeaseExclusion\|RefreshUser_SessionExpired\|RefreshUser_TransientKeepsSession\|RefreshUser_NoLatestSkips\|RefreshUser_SinceAndSkipIDs\|LaunchJob\|AutoRefreshStateLeaseFree\|ClassifyRankpageResponse\|IsSessionExpired\|SkipKnownEntries\|ShouldDeleteSession)$' ./internal/... 2>&1 \| grep -c '^--- PASS'` | 19 |
| lint | `golangci-lint run` | 指摘 0 件 |
| フォーマット | `gofmt -l .` | 出力が空 |
| 新しいモジュールを足していない | `git diff origin/develop -- go.mod \| grep -E '^\+\s+[a-z]' \| grep -vE 'google.golang.org/api\|golang.org/x/crypto\|golang.org/x/oauth2' \| wc -l` | 0 |
| ハッシュ生成ツール | `printf 'test-pass' \| go run ./cmd/hash-passphrase \| grep -cE '^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'` | 1 |
| イメージに 2 本のバイナリ | `docker build -t catalyzer-ar-check . && docker run --rm --entrypoint /bin/sh catalyzer-ar-check -c 'test -x /app/server && test -x /app/auto-refresh'` | exit 0 |
| app の型チェック | `cd infra/app && npm ci && npx tsc --noEmit` | exit 0 |
| app の preview(要 ADC。U1 の apply 後) | `STACK=stg make pulumi-app-preview` | exit 0。`+ gcp:cloudrunv2:Job` と `+ gcp:cloudscheduler:Job` が各 1 件、`~ gcp:cloudrunv2:Service` が 1 件、delete が 0 件 |
| 機能を無効にしたままの起動(ローカル) | `PORT=8099 go run ./cmd/server &` の後 `curl -s -o /dev/null -w '%{http_code}' -X POST localhost:8099/internal/auto-refresh/tick` | 404 |

U3:

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| JS テスト | `make test-js` | exit 0 |
| 新規 JS テスト | `node --test static/__tests__/autorefresh.test.js 2>&1 \| grep -E '^# pass'` | `# pass 6` 以上(`diffAfterParam` の通常・日付またぎ・空、`shouldPull` の境界 2 件、状態表示の文言の対応) |
| UI | `make ui-check` | 全画面 OK(新しい画面 `mobile-more-auto-refresh` を含む。console エラー 0) |

### 9.3 stg 検証手順(完了条件ではない。PR-2 のデプロイ後にオーナーと main が実施)
- S1: `gcloud scheduler jobs run <tick名> --location=<region>` → tick のログが 200、`gcloud scheduler jobs describe ... --format="value(status)"` が空(成功)。ここで **Authorization ヘッダが届くこと**と、サービスエージェントがトークンを発行できることを確かめる
- S2: 外部から叩く `curl -s -o /dev/null -w '%{http_code}' -X POST https://<stg-domain>/internal/auto-refresh/tick` → 401。`gcloud auth print-identity-token` で得たユーザーのトークンを付けても 401 か 403(audience か email が違う)
- S3: 誰も有効にしていない状態で 30 分待つ → tick のログが `targets=0 launched=false`、その時間帯の `gcloud run jobs executions list` が 0 件(受け入れ条件「誰も有効でない時間は Job が起動しない」)
- S4: オーナーが合言葉で有効にして実機で 1 試合する → 次の tick の Job で Firestore に入り、アプリを前面に戻すと表示される。同じ時刻に手動の再分析を押すと 409 か正常(重複して取得しない)。Job のログに lease 取得のスキップが出る
- S5: §6.2 の手順で T_exec の中央値を記録し、§6.1 の式で月額を出し直す(30 分間で 6 回以上)
- S6: セッション失効の再現(オーナーが公式サイトでログアウトするなど)→ last_result=session_expired、次にアクセスするとログイン画面になる

### 9.4 reviewer の観点(主観なので完了条件には入れない)
- `renderReport` の再描画で `class_record` などの state が消えないか(ナレッジ report-rerender-props-ignored)
- 409 の文言と、自動更新パネルの文言・配置。#448 の設定画面と整合するか
- 403 のときに手動分析でセッションを消さなくなった振る舞いの変化が妥当か
- トークンや合言葉がログに出ていないか

---

## 10. 決定事項(2026-10-05 ユーザー判断)

- **U1 合言葉を変えたとき**: B 一斉無効化
- **U2 反映の目安**: (a) 5 分間隔のまま次の tick で反映
- **U3 実行 SA**: Job 用 SA を新設し最小権限(`roles/datastore.user` 相当)にする。既存の Cloud Run サービスの実行 SA(compute デフォルト・editor)と github-actions SA の最小化も行う(別 issue。本設計の PR-1 と合わせて設計し直す)
- **U4 stg**: Scheduler と Job は **prod にだけ置く**。stg と prod は Firestore DB を共有しているので、prod が取り込んだ試合は stg の画面にも出る。これにより `auto_refresh.env` による環境分離は不要。動作確認は prod でオーナーのアカウントで行う
- **U5 有効化の条件**: セッションの無いユーザーは有効化不可(409)

---

## 11. 実装時の差分
- env 関連(`auto_refresh.env`)は §10 U4 のとおり実装していない
- colly は 4xx で OnResponse が呼ばれないため、ランクページの判定は `classifyRankpageResponse` に置き換えた
- U3(フロント): 実装済み。状態 API に最終更新時刻が無いため、画面の「最終取り込み」はこの端末の最終取り込み時刻(メモリ上)を出す。ui-check は新画面 2 枚(`mobile-more-auto-refresh`・`-error`)を追加し 23 画面。エラー画面は 403 を console に出すため `expectConsole` で許可している
- 起動時の取り込みは hasSession だけを条件にする。キャッシュが無いと差分の起点が無く touch だけで終わるため、reanalyzeWithSession と衝突しない
- `POST /auto-refresh` の 401/409: Cookie 無しは 409、Cookie 有でセッション解決不可は 401
- app の Job・Scheduler は config `autoRefreshEnabled`(prod のみ true)で作る。Job の `APP_ENV` は不要になり入れていない
- デプロイ順(§7)の stg 手順は prod に読み替える(合言葉は prod にのみ設定)。§9.2 の app preview は `STACK=prod`(stg は無効なので Service の `~` のみ)
- §9.2 の「新しいモジュールを足していない」許可リストに `google.golang.org/grpc`(indirect→direct の昇格のみ)を足す
