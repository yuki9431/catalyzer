package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/yuki9431/catalyzer/internal/autorefresh"
	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/session"
	"golang.org/x/time/rate"
)

const (
	maxPassphraseLen = 128
	storeTimeout     = 10 * time.Second
)

// 合言葉の試行は 1 時間 5 回(ユーザー単位と IP 単位の両方)。インメモリなのでインスタンスごとに数える
var passphraseLimiter = newRateLimiter(rate.Every(12*time.Minute), 5)

// checkPassphrase は有効化の合言葉を照合して HTTP ステータスを返す(200 なら通過)。
// 試行制限は argon2 の計算より前に判定する。照合が不要な開放モードでは制限もかけない。
func checkPassphrase(g autorefresh.Gate, l *rateLimiter, userKey, ip, passphrase string) int {
	if !g.Required() {
		return http.StatusOK
	}
	userOK := l.getLimiter("user:" + userKey).Allow()
	ipOK := l.getLimiter("ip:" + ip).Allow()
	if !userOK || !ipOK {
		return http.StatusTooManyRequests
	}
	if n := utf8.RuneCountInString(passphrase); n == 0 {
		return http.StatusForbidden
	} else if n > maxPassphraseLen {
		return http.StatusBadRequest
	}
	ok, err := g.Verify(passphrase)
	if err != nil {
		log.Printf("[ERROR] auto-refresh: 合言葉の照合に失敗: %v", err)
		return http.StatusInternalServerError
	}
	if !ok {
		return http.StatusForbidden
	}
	return http.StatusOK
}

// autoRefreshStore はハンドラが使う自動更新の永続化操作。
type autoRefreshStore interface {
	Get(ctx context.Context, userKey string) (*model.AutoRefreshState, error)
	Enable(ctx context.Context, userKey, token, fp string, now time.Time) error
	Disable(ctx context.Context, userKey string) error
	Touch(ctx context.Context, userKey, token string, now time.Time) (*model.AutoRefreshState, error)
}

type firestoreAutoRefreshStore struct{}

func (firestoreAutoRefreshStore) Get(ctx context.Context, userKey string) (*model.AutoRefreshState, error) {
	return firestore.GetAutoRefresh(ctx, userKey)
}

func (firestoreAutoRefreshStore) Enable(ctx context.Context, userKey, token, fp string, now time.Time) error {
	return firestore.EnableAutoRefresh(ctx, userKey, token, fp, now, autorefresh.ActiveWindow)
}

func (firestoreAutoRefreshStore) Disable(ctx context.Context, userKey string) error {
	return firestore.DisableAutoRefresh(ctx, userKey)
}

func (firestoreAutoRefreshStore) Touch(ctx context.Context, userKey, token string, now time.Time) (*model.AutoRefreshState, error) {
	return firestore.TouchAutoRefresh(ctx, userKey, token, now, autorefresh.ActiveWindow)
}

// autoRefreshAPI は /auto-refresh 系ハンドラの依存をまとめる。
type autoRefreshAPI struct {
	cfg         autorefresh.Config
	sessionOn   bool
	limiter     *rateLimiter
	store       autoRefreshStore
	now         func() time.Time
	loadSession func(token string) (userKey string, encryptedJar []byte, err error)
}

func newAutoRefreshAPI(cfg autorefresh.Config) *autoRefreshAPI {
	return &autoRefreshAPI{
		cfg: cfg, sessionOn: session.Enabled(), limiter: passphraseLimiter,
		store: firestoreAutoRefreshStore{}, now: time.Now, loadSession: firestore.LoadSession,
	}
}

// available は機能が使える状態か(Job・セッション暗号化・合言葉または開放設定がそろっている)。
func (a *autoRefreshAPI) available() bool {
	return a.cfg.JobName != "" && a.sessionOn && a.cfg.Gate.Available()
}

type autoRefreshStatus struct {
	Available          bool       `json:"available"`
	PassphraseRequired bool       `json:"passphrase_required"`
	Enabled            bool       `json:"enabled"`
	Status             string     `json:"status"` // off / active / idle / stopped
	Reason             string     `json:"reason,omitempty"`
	ActiveUntil        *time.Time `json:"active_until,omitempty"`
}

// statusOf は保存状態を画面向けの状態にする。stopped は問題で止まったまま次のアクセスを待っている状態。
func statusOf(st *model.AutoRefreshState, now time.Time) (status, reason string) {
	switch {
	case st == nil || !st.Enabled:
		return "off", ""
	case st.ActiveUntil.After(now):
		return "active", ""
	}
	switch autorefresh.Outcome(st.LastResult) {
	case autorefresh.OutcomeSessionExpired, autorefresh.OutcomeAccessDenied, autorefresh.OutcomeNoSession:
		return "stopped", st.LastResult
	case autorefresh.OutcomeError:
		if st.ConsecutiveFailures >= autorefresh.MaxFailures {
			return "stopped", st.LastResult
		}
	}
	return "idle", ""
}

func (a *autoRefreshAPI) statusBody(st *model.AutoRefreshState) autoRefreshStatus {
	now := a.now()
	body := autoRefreshStatus{Available: a.available(), PassphraseRequired: a.cfg.Gate.Required()}
	if !body.Available || st == nil || !st.Enabled {
		body.Status = "off"
		return body
	}
	body.Enabled = true
	body.Status, body.Reason = statusOf(st, now)
	if st.ActiveUntil.After(now) {
		t := st.ActiveUntil
		body.ActiveUntil = &t
	}
	return body
}

// revokedByGate は合言葉の設定が有効化時から変わっていて、既存の有効化を無効にすべきかを返す。
func (a *autoRefreshAPI) revokedByGate(st *model.AutoRefreshState) bool {
	return st != nil && st.Enabled && a.available() && st.PassphraseFP != a.cfg.Gate.Fingerprint()
}

// sessionOf は Cookie から本人のセッションを解決する。hasCookie は Cookie の有無。
func (a *autoRefreshAPI) sessionOf(r *http.Request) (token, userKey string, hasCookie bool) {
	token = getSessionToken(r)
	if token == "" {
		return "", "", false
	}
	uk, _, err := a.loadSession(token)
	if err != nil {
		log.Printf("[WARN] auto-refresh: セッションの読み込みに失敗: %v", err)
		return token, "", true
	}
	return token, uk, true
}

// handleAutoRefresh は GET(状態取得)と POST(有効化・無効化)を扱う。
func (a *autoRefreshAPI) handleAutoRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token, userKey, hasCookie := a.sessionOf(r)
	if r.Method == http.MethodPost {
		a.postAutoRefresh(w, r, token, userKey, hasCookie)
		return
	}
	if userKey == "" {
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "ログイン状態が保持されていません"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()
	st, err := a.store.Get(ctx, userKey)
	if err != nil {
		log.Printf("[ERROR] auto-refresh: 状態の取得に失敗: %v", err)
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "自動更新の状態を取得できませんでした"})
		return
	}
	if a.revokedByGate(st) {
		st = a.revoke(ctx, userKey)
	}
	sendJSON(w, http.StatusOK, a.statusBody(st))
}

// revoke は合言葉の変更で無効になった有効化を戻す。書き込みに失敗しても無効として返す。
func (a *autoRefreshAPI) revoke(ctx context.Context, userKey string) *model.AutoRefreshState {
	if err := a.store.Disable(ctx, userKey); err != nil {
		log.Printf("[WARN] auto-refresh: 無効化に失敗: %v", err)
	}
	return nil
}

type autoRefreshRequest struct {
	Enabled    bool   `json:"enabled"`
	Passphrase string `json:"passphrase"`
}

func (a *autoRefreshAPI) postAutoRefresh(w http.ResponseWriter, r *http.Request, token, userKey string, hasCookie bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var req autoRefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()

	if !req.Enabled {
		if userKey == "" {
			sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "ログイン状態が保持されていません"})
			return
		}
		if err := a.store.Disable(ctx, userKey); err != nil {
			log.Printf("[ERROR] auto-refresh: 無効化に失敗: %v", err)
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "自動更新を停止できませんでした"})
			return
		}
		sendJSON(w, http.StatusOK, a.statusBody(nil))
		return
	}

	if !a.available() {
		sendJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "自動更新は現在利用できません"})
		return
	}
	// Cookie が無い=ログイン状態を保持せずにログインしている。保存済み Cookie が無いと自動更新できない
	if !hasCookie {
		sendJSON(w, http.StatusConflict, map[string]string{"error": "自動更新にはログイン状態の保持が必要です。「ログイン状態を保持する」を選んでログインし直してください"})
		return
	}
	if userKey == "" {
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "ログイン状態が保持されていません"})
		return
	}
	switch checkPassphrase(a.cfg.Gate, a.limiter, userKey, clientIP(r), req.Passphrase) {
	case http.StatusOK:
	case http.StatusTooManyRequests:
		sendJSON(w, http.StatusTooManyRequests, map[string]string{"error": "合言葉の試行回数の上限に達しました。しばらく時間をおいてから再度お試しください"})
		return
	case http.StatusBadRequest:
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "合言葉が長すぎます"})
		return
	case http.StatusForbidden:
		sendJSON(w, http.StatusForbidden, map[string]string{"error": "合言葉が違います"})
		return
	default:
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "合言葉を確認できませんでした"})
		return
	}

	now := a.now()
	if err := a.store.Enable(ctx, userKey, token, a.cfg.Gate.Fingerprint(), now); err != nil {
		log.Printf("[ERROR] auto-refresh: 有効化に失敗: %v", err)
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "自動更新を有効にできませんでした"})
		return
	}
	sendJSON(w, http.StatusOK, a.statusBody(&model.AutoRefreshState{
		Enabled: true, SessionToken: token, ActiveUntil: now.Add(autorefresh.ActiveWindow),
	}))
}

// handleTouch は最終アクセスを記録して自動更新の継続時間を延ばす。有効にしていないユーザーには何もしない。
func (a *autoRefreshAPI) handleTouch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token, userKey, _ := a.sessionOf(r)
	if userKey == "" {
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "ログイン状態が保持されていません"})
		return
	}
	if !a.available() {
		sendJSON(w, http.StatusOK, map[string]interface{}{"enabled": false, "status": "off"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()
	st, err := a.store.Touch(ctx, userKey, token, a.now())
	if err != nil {
		log.Printf("[ERROR] auto-refresh: touch に失敗: %v", err)
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "自動更新の状態を更新できませんでした"})
		return
	}
	if a.revokedByGate(st) {
		st = a.revoke(ctx, userKey)
	}
	body := a.statusBody(st)
	sendJSON(w, http.StatusOK, map[string]interface{}{"enabled": body.Enabled, "status": body.Status})
}

// newTickHandler は Scheduler の tick を処理する。対象がいるときだけ Job を起動する。
func newTickHandler(
	list func(context.Context, time.Time) ([]model.AutoRefreshState, error),
	launch func(context.Context) error,
	now func() time.Time,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		t := now()
		states, err := list(r.Context(), t)
		if err != nil {
			log.Printf("[ERROR] auto-refresh tick: 対象の取得に失敗: %v", err)
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "list failed"})
			return
		}
		targets := len(autorefresh.Eligible(states, t))
		launched := false
		if targets > 0 {
			if err := launch(r.Context()); err != nil {
				log.Printf("[ERROR] auto-refresh tick: Job の起動に失敗 targets=%d: %v", targets, err)
				sendJSON(w, http.StatusBadGateway, map[string]string{"error": "launch failed"})
				return
			}
			launched = true
		}
		log.Printf("[INFO] auto-refresh tick targets=%d launched=%v", targets, launched)
		sendJSON(w, http.StatusOK, map[string]interface{}{"targets": targets, "launched": launched})
	})
}

// registerAutoRefresh は自動更新のエンドポイントを mux に登録する。
func registerAutoRefresh(mux *http.ServeMux, cfg autorefresh.Config) {
	a := newAutoRefreshAPI(cfg)
	mux.HandleFunc("/auto-refresh", a.handleAutoRefresh)
	mux.HandleFunc("/auto-refresh/touch", a.handleTouch)

	const tickPath = "/internal/auto-refresh/tick"
	if cfg.JobName == "" {
		mux.Handle(tickPath, http.NotFoundHandler())
		return
	}
	launch := lazyLauncher(cfg.JobName)
	tick := newTickHandler(firestore.ListActiveAutoRefresh, launch, time.Now)
	mux.Handle(tickPath, requireSchedulerOIDC(tick, cfg.Audience, cfg.Invoker, validateIDToken))
}

// lazyLauncher は初回の起動時に ADC のクライアントを作る(ADC が無いローカルでもサーバーを起動できるようにする)。
func lazyLauncher(jobName string) func(context.Context) error {
	return newLazyLauncher(autorefresh.NewLaunchClient, autorefresh.LaunchJob, jobName)
}

// newLazyLauncher は client の作成に成功したときだけキャッシュする(失敗は次回再試行する)。
func newLazyLauncher(newClient func(context.Context) (*http.Client, error), launch func(context.Context, *http.Client, string) error, jobName string) func(context.Context) error {
	var (
		mu     sync.Mutex
		client *http.Client
	)
	return func(ctx context.Context) error {
		mu.Lock()
		if client == nil {
			c, err := newClient(context.Background())
			if err != nil {
				mu.Unlock()
				return err
			}
			client = c
		}
		c := client
		mu.Unlock()
		return launch(ctx, c, jobName)
	}
}

// refreshLeases は手動分析と自動更新の排他に使う lease の操作(テストで差し替える)。
var refreshLeases = struct {
	acquire func(ctx context.Context, userKey, owner string, now time.Time, ttl time.Duration) (bool, error)
	release func(ctx context.Context, userKey, owner string) error
}{firestore.AcquireRefreshLease, firestore.ReleaseRefreshLease}

const manualLeaseBusyMessage = "自動更新で最新の試合を取得中です。30秒ほど待ってから再度お試しください。"

// acquireManualLease は手動分析の lease を取る。自動更新が取得中なら ok=false。
// Firestore 障害のときは主機能を優先して ok=true(fail-open)。
func acquireManualLease(userKey string) (owner string, ok bool) {
	owner = "manual:" + uuid.NewString()
	ctx, cancel := context.WithTimeout(context.Background(), storeTimeout)
	defer cancel()
	acquired, err := refreshLeases.acquire(ctx, userKey, owner, time.Now(), autorefresh.ManualLeaseTTL)
	if err != nil {
		log.Printf("[WARN] auto-refresh: 手動分析の lease 取得に失敗、そのまま続行: %v", err)
		return owner, true
	}
	return owner, acquired
}

// releaseManualLease は手動分析の lease を解放する。
func releaseManualLease(userKey, owner string) {
	ctx, cancel := context.WithTimeout(context.Background(), storeTimeout)
	defer cancel()
	if err := refreshLeases.release(ctx, userKey, owner); err != nil {
		log.Printf("[WARN] auto-refresh: 手動分析の lease 解放に失敗: %v", err)
	}
}
