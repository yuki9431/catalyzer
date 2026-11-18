package server

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/yuki9431/catalyzer/internal/aidiagnosis"
	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/session"
	"golang.org/x/time/rate"
)

const aiDiagnosisCapMessage = "今日はもう診断できません。明日5時以降にお試しください"

// 診断の要求は IP ごとに 10 分に 1 回回復・バースト 6。インメモリなのでインスタンスごとに数える
var aiDiagnosisLimiter = newRateLimiter(rate.Every(10*time.Minute), 6)

var aiErrorMessages = map[string]string{
	"launch_failed":               "診断を開始できませんでした",
	aidiagnosis.CodeClaudeFailed:  "AIの応答を受け取れませんでした",
	aidiagnosis.CodeInvalidOutput: "AIの診断結果を確認できなかったため表示しません",
	aidiagnosis.CodeTimeout:       "診断が時間内に終わりませんでした",
}

const aiErrorDefault = "診断できませんでした"

// aiDiagnosisStore はハンドラが使う AI 診断の永続化操作。
type aiDiagnosisStore interface {
	Get(ctx context.Context, userKey string) (*model.AIDiagnosisState, error)
	Request(ctx context.Context, userKey, day string, now time.Time, inputJSON, requestID string,
		decide func(*model.AIDiagnosisState, int) (string, int)) (string, error)
	Fail(ctx context.Context, userKey, requestID, code string) error
}

type firestoreAIDiagnosisStore struct{}

func (firestoreAIDiagnosisStore) Get(ctx context.Context, userKey string) (*model.AIDiagnosisState, error) {
	return firestore.GetAIDiagnosis(ctx, userKey)
}

func (firestoreAIDiagnosisStore) Request(ctx context.Context, userKey, day string, now time.Time, inputJSON, requestID string,
	decide func(*model.AIDiagnosisState, int) (string, int)) (string, error) {
	return firestore.RequestAIDiagnosis(ctx, userKey, day, now, inputJSON, requestID, decide)
}

func (firestoreAIDiagnosisStore) Fail(ctx context.Context, userKey, requestID, code string) error {
	return firestore.FailAIDiagnosis(ctx, userKey, requestID, code)
}

// aiDiagnosisAPI は /ai-diagnosis ハンドラの依存をまとめる。
type aiDiagnosisAPI struct {
	cfg         aidiagnosis.Config
	sessionOn   bool
	msNames     map[string]bool
	limiter     *rateLimiter
	store       aiDiagnosisStore
	launch      func(ctx context.Context) error
	now         func() time.Time
	newID       func() string
	loadSession func(token string) (userKey string, encryptedJar []byte, err error)
}

// registerAIDiagnosis は AI 診断のエンドポイントを mux に登録する。
func registerAIDiagnosis(mux *http.ServeMux, cfg aidiagnosis.Config, msNames map[string]bool) {
	a := &aiDiagnosisAPI{
		cfg: cfg, sessionOn: session.Enabled(), msNames: msNames, limiter: aiDiagnosisLimiter,
		store: firestoreAIDiagnosisStore{}, now: time.Now, newID: uuid.NewString, loadSession: firestore.LoadSession,
	}
	if cfg.JobName != "" {
		a.launch = lazyLauncher(cfg.JobName)
	}
	mux.HandleFunc("/ai-diagnosis", a.handle)
}

type aiResult struct {
	Headline   string   `json:"headline"`
	Tendencies []string `json:"tendencies"`
	Cautions   []string `json:"cautions"`
	Strengths  []string `json:"strengths"`
}

type aiBody struct {
	Available    bool      `json:"available"`
	Status       string    `json:"status,omitempty"`
	MinMatches   int       `json:"min_matches,omitempty"`
	Result       *aiResult `json:"result,omitempty"`
	NextAt       string    `json:"next_at,omitempty"`
	Retry        *bool     `json:"retry,omitempty"`
	AttemptsLeft *int      `json:"attempts_left,omitempty"`
	Error        string    `json:"error,omitempty"`
}

// resultTexts は保存した出力から本文だけを取り出す(evidence は返さない)。
func resultTexts(raw string) (*aiResult, error) {
	var out struct {
		Headline   struct{ Text string }   `json:"headline"`
		Tendencies []struct{ Text string } `json:"tendencies"`
		Cautions   []struct{ Text string } `json:"cautions"`
		Strengths  []struct{ Text string } `json:"strengths"`
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	texts := func(items []struct{ Text string }) []string {
		s := make([]string, 0, len(items))
		for _, it := range items {
			s = append(s, it.Text)
		}
		return s
	}
	return &aiResult{
		Headline: out.Headline.Text, Tendencies: texts(out.Tendencies),
		Cautions: texts(out.Cautions), Strengths: texts(out.Strengths),
	}, nil
}

func (a *aiDiagnosisAPI) body(st *model.AIDiagnosisState) (aiBody, error) {
	v := aidiagnosis.View(st, a.now())
	b := aiBody{Available: true, Status: v.Status, MinMatches: aidiagnosis.MinMatches}
	if !v.NextAt.IsZero() {
		b.NextAt = v.NextAt.Format(time.RFC3339)
	}
	switch v.Status {
	case "done":
		r, err := resultTexts(st.ResultJSON)
		if err != nil {
			return aiBody{}, err
		}
		b.Result = r
	case "error":
		retry, left := v.Retry, v.AttemptsLeft
		b.Retry, b.AttemptsLeft = &retry, &left
		b.Error = aiErrorDefault
		if m, ok := aiErrorMessages[v.ErrorCode]; ok {
			b.Error = m
		}
	}
	return b, nil
}

func (a *aiDiagnosisAPI) userKeyOf(r *http.Request) string {
	token := getSessionToken(r)
	if token == "" {
		return ""
	}
	uk, _, err := a.loadSession(token)
	if err != nil {
		log.Printf("[WARN] ai-diagnosis: セッションの読み込みに失敗: %v", err)
		return ""
	}
	return uk
}

// available は機能が使える状態か(Job・セッション暗号化・許可リストがそろっている)。
func (a *aiDiagnosisAPI) available(userKey string) bool {
	return a.cfg.JobName != "" && a.sessionOn && a.cfg.Allowed[userKey]
}

func (a *aiDiagnosisAPI) handle(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.get(w, r)
	case http.MethodPost:
		a.post(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *aiDiagnosisAPI) get(w http.ResponseWriter, r *http.Request) {
	userKey := a.userKeyOf(r)
	if userKey == "" {
		notesError(w, http.StatusUnauthorized, notesNoSession)
		return
	}
	if !a.available(userKey) {
		sendJSON(w, http.StatusOK, aiBody{Available: false})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()
	a.respondState(ctx, w, http.StatusOK, userKey)
}

// respondState は保存状態を読んで code で返す。
func (a *aiDiagnosisAPI) respondState(ctx context.Context, w http.ResponseWriter, code int, userKey string) {
	st, err := a.store.Get(ctx, userKey)
	if err != nil {
		log.Printf("[ERROR] ai-diagnosis: 状態の取得に失敗: %v", err)
		notesError(w, http.StatusInternalServerError, "診断の状態を取得できませんでした")
		return
	}
	b, err := a.body(st)
	if err != nil {
		log.Printf("[ERROR] ai-diagnosis: 結果の読み込みに失敗: %v", err)
		notesError(w, http.StatusInternalServerError, "診断の状態を取得できませんでした")
		return
	}
	sendJSON(w, code, b)
}

func (a *aiDiagnosisAPI) post(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.getLimiter("ip:" + rateLimitKey(r)).Allow() {
		notesError(w, http.StatusTooManyRequests, "リクエストが多すぎます。しばらく待ってからお試しください")
		return
	}
	userKey := a.userKeyOf(r)
	if userKey == "" {
		notesError(w, http.StatusUnauthorized, notesNoSession)
		return
	}
	if !a.available(userKey) {
		notesError(w, http.StatusForbidden, "AI診断は利用できません")
		return
	}
	if !requireJSON(w, r) {
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, aidiagnosis.MaxInputBytes))
	if err == nil {
		raw, err = aidiagnosis.ValidateInput(raw, a.msNames)
	}
	if err != nil {
		log.Printf("[WARN] ai-diagnosis: 入力を拒否: %v", err)
		notesError(w, http.StatusBadRequest, "入力が不正です")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()
	now := a.now()
	requestID := a.newID()
	verdict, err := a.store.Request(ctx, userKey, aidiagnosis.PlayDay(now), now, string(raw), requestID,
		func(st *model.AIDiagnosisState, global int) (string, int) {
			v, attempts := aidiagnosis.Decide(st, global, now)
			return string(v), attempts
		})
	if err != nil {
		log.Printf("[ERROR] ai-diagnosis: 要求の保存に失敗: %v", err)
		notesError(w, http.StatusInternalServerError, "診断を開始できませんでした")
		return
	}
	switch aidiagnosis.Verdict(verdict) {
	case aidiagnosis.VerdictOK:
	case aidiagnosis.VerdictDoneToday, aidiagnosis.VerdictBusy:
		a.respondState(ctx, w, http.StatusConflict, userKey)
		return
	default:
		notesError(w, http.StatusTooManyRequests, aiDiagnosisCapMessage)
		return
	}

	// 保存済みなので、クライアント切断で起動を打ち切らない
	launchCtx, launchCancel := context.WithTimeout(context.WithoutCancel(r.Context()), storeTimeout)
	defer launchCancel()
	if err := a.launch(launchCtx); err != nil {
		log.Printf("[ERROR] ai-diagnosis: Job の起動に失敗: %v", err)
		failCtx, failCancel := context.WithTimeout(context.Background(), storeTimeout)
		defer failCancel()
		if ferr := a.store.Fail(failCtx, userKey, requestID, "launch_failed"); ferr != nil {
			log.Printf("[WARN] ai-diagnosis: launch_failed の記録に失敗: %v", ferr)
		}
		notesError(w, http.StatusBadGateway, aiErrorMessages["launch_failed"])
		return
	}
	sendJSON(w, http.StatusAccepted, aiBody{Available: true, Status: "pending", MinMatches: aidiagnosis.MinMatches})
}
