// Package autorefresh implements the background refresh of match data for users who enabled it.
package autorefresh

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	fs "github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/mslist"
	"github.com/yuki9431/catalyzer/internal/scraper"
	"github.com/yuki9431/catalyzer/internal/session"
)

const (
	// ActiveWindow は最終アクセスからの自動更新の継続時間
	ActiveWindow = 30 * time.Minute
	// ManualLeaseTTL は手動分析が取る lease の期限
	ManualLeaseTTL = 15 * time.Minute

	// MaxFailures は error が連続したときに自動更新を止める回数
	MaxFailures = 3

	jobLeaseTTL    = 5 * time.Minute
	perUserTimeout = 200 * time.Second
	finishTimeout  = 30 * time.Second
)

// Config は環境変数から読む自動更新の設定。
type Config struct {
	JobName, Audience, Invoker string
	Gate                       Gate
}

// ConfigFromEnv は AUTO_REFRESH_* 環境変数から設定を組み立てる。
func ConfigFromEnv() Config {
	return Config{
		JobName:  os.Getenv("AUTO_REFRESH_JOB"),
		Audience: os.Getenv("AUTO_REFRESH_AUDIENCE"),
		Invoker:  os.Getenv("AUTO_REFRESH_INVOKER"),
		Gate: Gate{
			Hash: os.Getenv("AUTO_REFRESH_PASSPHRASE_HASH"),
			Open: os.Getenv("AUTO_REFRESH_OPEN") == "true",
		},
	}
}

// Outcome は 1 ユーザー・1 回の自動更新の結果分類。
type Outcome string

const (
	OutcomeOK             Outcome = "ok"
	OutcomeNoSession      Outcome = "no_session"
	OutcomeSessionExpired Outcome = "session_expired"
	OutcomeAccessDenied   Outcome = "access_denied"
	OutcomeError          Outcome = "error"
	OutcomeSkipped        Outcome = "skipped"
)

// classify はスクレイピングのエラーを結果に分類する。
func classify(err error) Outcome {
	switch {
	case err == nil:
		return OutcomeOK
	case scraper.IsSessionExpired(err):
		return OutcomeSessionExpired
	case errors.Is(err, scraper.ErrAccessDenied):
		return OutcomeAccessDenied
	default:
		return OutcomeError
	}
}

// nextUpdate は結果を状態への反映内容にする。
func nextUpdate(prev model.AutoRefreshState, o Outcome) model.RefreshUpdate {
	upd := model.RefreshUpdate{LastResult: string(o), ConsecutiveFailures: prev.ConsecutiveFailures}
	switch o {
	case OutcomeOK:
		upd.ConsecutiveFailures = 0
	case OutcomeNoSession, OutcomeSessionExpired:
		upd.ConsecutiveFailures = 0
		upd.ClearSessionToken = true
		upd.StopActive = true
	case OutcomeAccessDenied:
		upd.StopActive = true
	case OutcomeError:
		upd.ConsecutiveFailures++
		upd.StopActive = upd.ConsecutiveFailures >= MaxFailures
	}
	return upd
}

// Eligible は今の Job が処理すべきユーザー(有効・token あり・期間内・lease 空き)を返す。
func Eligible(states []model.AutoRefreshState, now time.Time) []model.AutoRefreshState {
	var out []model.AutoRefreshState
	for _, s := range states {
		if s.Enabled && s.SessionToken != "" && s.ActiveUntil.After(now) && s.LeaseFree("", now) {
			out = append(out, s)
		}
	}
	return out
}

// Store は Job が使う永続化の操作。
type Store interface {
	ListActive(ctx context.Context, now time.Time) ([]model.AutoRefreshState, error)
	AcquireLease(ctx context.Context, userKey, owner string, now time.Time, ttl time.Duration) (bool, error)
	Finish(ctx context.Context, userKey, owner string, upd model.RefreshUpdate) error
	LoadSession(token string) (userKey string, encryptedJar []byte, err error)
	DeleteSession(token string) error
	UpdateSessionJar(ctx context.Context, token string, encryptedJar []byte) error
	LatestDatetime(userKey string) (time.Time, error)
	MatchIDsAt(ctx context.Context, userKey string, t time.Time) (ids []string, hasLegacy bool, err error)
	SaveScores(userKey string, scores model.DatedScores)
}

// ScrapeFunc はスクレイピング。since より後の試合を返す。
type ScrapeFunc func(since time.Time, opt scraper.ScrapingOption) (model.DatedScores, http.CookieJar, error)

type deps struct {
	store   Store
	scrape  ScrapeFunc
	openJar func(encryptedJar []byte) (http.CookieJar, error)
	sealJar func(jar http.CookieJar) ([]byte, error)
	now     func() time.Time
}

type fsStore struct{}

func (fsStore) ListActive(ctx context.Context, now time.Time) ([]model.AutoRefreshState, error) {
	return fs.ListActiveAutoRefresh(ctx, now)
}

func (fsStore) AcquireLease(ctx context.Context, userKey, owner string, now time.Time, ttl time.Duration) (bool, error) {
	return fs.AcquireRefreshLease(ctx, userKey, owner, now, ttl)
}

func (fsStore) Finish(ctx context.Context, userKey, owner string, upd model.RefreshUpdate) error {
	return fs.FinishRefresh(ctx, userKey, owner, upd)
}

func (fsStore) LoadSession(token string) (string, []byte, error) { return fs.LoadSession(token) }
func (fsStore) DeleteSession(token string) error                 { return fs.DeleteSession(token) }

func (fsStore) UpdateSessionJar(ctx context.Context, token string, enc []byte) error {
	return fs.UpdateSessionJar(ctx, token, enc)
}

func (fsStore) LatestDatetime(userKey string) (time.Time, error) {
	return fs.GetLatestDatetime(userKey)
}

func (fsStore) MatchIDsAt(ctx context.Context, userKey string, t time.Time) ([]string, bool, error) {
	return fs.LoadMatchIDsAt(ctx, userKey, t)
}

func (fsStore) SaveScores(userKey string, scores model.DatedScores) { fs.SaveScores(userKey, scores) }

func openJar(enc []byte) (http.CookieJar, error) {
	data, err := session.Decrypt(enc)
	if err != nil {
		return nil, fmt.Errorf("復号: %w", err)
	}
	jar, err := session.DeserializeJar(data)
	if err != nil {
		return nil, fmt.Errorf("復元: %w", err)
	}
	return jar, nil
}

func sealJar(jar http.CookieJar) ([]byte, error) {
	data, err := session.SerializeJar(jar)
	if err != nil {
		return nil, fmt.Errorf("シリアライズ: %w", err)
	}
	return session.Encrypt(data)
}

// RunJob は有効なユーザー全員の新しい試合を取り込む。Firestore は初期化済みであること。
// owner が空なら CLOUD_RUN_EXECUTION、それも空なら uuid を使う。
func RunJob(ctx context.Context, owner string, msMap map[string]string) error {
	if !session.Enabled() {
		return errors.New("SESSION_ENCRYPTION_KEY が未設定または不正です")
	}
	if owner == "" {
		owner = os.Getenv("CLOUD_RUN_EXECUTION")
	}
	if owner == "" {
		owner = uuid.NewString()
	}
	d := deps{
		store: fsStore{},
		scrape: func(since time.Time, opt scraper.ScrapingOption) (model.DatedScores, http.CookieJar, error) {
			return scraper.ScrapingWithOption("", "", since, opt)
		},
		openJar: openJar,
		sealJar: sealJar,
		now:     time.Now,
	}
	return runJob(ctx, d, "job:"+owner, msMap)
}

func runJob(ctx context.Context, d deps, owner string, msMap map[string]string) error {
	start := d.now()
	states, err := d.store.ListActive(ctx, start)
	if err != nil {
		return fmt.Errorf("対象一覧の取得: %w", err)
	}
	targets := Eligible(states, start)

	var wg sync.WaitGroup
	for _, st := range targets {
		wg.Add(1)
		go func() {
			defer wg.Done()
			refreshUser(ctx, d, st, owner, msMap)
		}()
	}
	wg.Wait()

	log.Printf("[INFO] auto-refresh done users=%d elapsed=%.0fs", len(targets), d.now().Sub(start).Seconds())
	return nil
}

// refreshUser は lease を取って 1 ユーザーを更新し、結果を記録する。失敗は呼び出し元に返さずログに残す。
func refreshUser(ctx context.Context, d deps, st model.AutoRefreshState, owner string, msMap map[string]string) {
	acquired, err := d.store.AcquireLease(ctx, st.UserKey, owner, d.now(), jobLeaseTTL)
	if err != nil {
		log.Printf("[WARN] auto-refresh: lease 取得に失敗 user=%s: %v", st.UserKey, err)
		return
	}
	if !acquired {
		log.Printf("[INFO] auto-refresh: lease が他で取得済みのためスキップ user=%s", st.UserKey)
		return
	}

	outcome, saved, procErr := process(ctx, d, st, msMap)
	if procErr != nil {
		log.Printf("[WARN] auto-refresh: user=%s result=%s: %v", st.UserKey, outcome, procErr)
	} else {
		log.Printf("[INFO] auto-refresh: user=%s result=%s saved_scores=%d", st.UserKey, outcome, saved)
	}

	fctx, cancel := context.WithTimeout(ctx, finishTimeout)
	defer cancel()
	if err := d.store.Finish(fctx, st.UserKey, owner, nextUpdate(st, outcome)); err != nil {
		log.Printf("[WARN] auto-refresh: 結果の記録に失敗 user=%s: %v", st.UserKey, err)
	}
}

// process は lease を持った状態で 1 ユーザーの取り込みを行い、結果・保存したスコア数・原因のエラーを返す。
func process(ctx context.Context, d deps, st model.AutoRefreshState, msMap map[string]string) (Outcome, int, error) {
	userKey, encJar, err := d.store.LoadSession(st.SessionToken)
	if err != nil {
		return OutcomeError, 0, fmt.Errorf("セッション読み込み: %w", err)
	}
	if userKey == "" || encJar == nil || userKey != st.UserKey {
		return OutcomeNoSession, 0, errors.New("セッションが無い")
	}
	jar, err := d.openJar(encJar)
	if err != nil {
		deleteSession(d, st.SessionToken)
		return OutcomeNoSession, 0, fmt.Errorf("セッションの復元: %w", err)
	}

	latest, err := d.store.LatestDatetime(userKey)
	if err != nil {
		return OutcomeError, 0, fmt.Errorf("最新日時の取得: %w", err)
	}
	if latest.IsZero() {
		// 保存済みの試合が無いと全件取得になる。初回取り込みは手動分析に任せる
		return OutcomeSkipped, 0, nil
	}
	ids, hasLegacy, err := d.store.MatchIDsAt(ctx, userKey, latest)
	if err != nil {
		return OutcomeError, 0, fmt.Errorf("同時刻の試合の取得: %w", err)
	}
	// 同じ分に後から出た試合を拾うため 1 分戻し、保存済みは MatchID で捨てる。legacy があると doc ID が変わって重複するので戻さない
	since := latest.Add(-time.Minute)
	if hasLegacy {
		since = latest
	}
	skip := make(map[string]bool, len(ids))
	for _, id := range ids {
		skip[id] = true
	}

	sctx, cancel := context.WithTimeout(ctx, perUserTimeout)
	defer cancel()
	scores, newJar, scrapeErr := d.scrape(since, scraper.ScrapingOption{SavedJar: jar, Context: sctx, SkipMatchIDs: skip})
	is403 := errors.Is(scrapeErr, scraper.ErrAccessDenied)

	// 403 の途中データは古い側の連続分だけが返るので、そのまま保存してよい
	saved := 0
	if (scrapeErr == nil || is403) && len(scores) > 0 {
		mslist.FillMsNames(scores, msMap)
		mslist.CheckUnknownMS(scores)
		d.store.SaveScores(userKey, scores)
		saved = len(scores)
	}
	if (scrapeErr == nil || is403) && newJar != nil {
		saveJar(ctx, d, st.SessionToken, newJar)
	}

	outcome := classify(scrapeErr)
	if outcome == OutcomeSessionExpired {
		deleteSession(d, st.SessionToken)
	}
	return outcome, saved, scrapeErr
}

func deleteSession(d deps, token string) {
	if err := d.store.DeleteSession(token); err != nil {
		log.Printf("[WARN] auto-refresh: セッション削除に失敗: %v", err)
	}
}

// saveJar は更新された jar を保存する。失敗しても取り込み自体は成功なのでログだけ残す。
func saveJar(ctx context.Context, d deps, token string, jar http.CookieJar) {
	enc, err := d.sealJar(jar)
	if err != nil {
		log.Printf("[WARN] auto-refresh: jar の暗号化に失敗: %v", err)
		return
	}
	if err := d.store.UpdateSessionJar(ctx, token, enc); err != nil {
		log.Printf("[WARN] auto-refresh: jar の保存に失敗: %v", err)
	}
}
