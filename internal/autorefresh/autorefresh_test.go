package autorefresh

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/scraper"
)

var t0 = time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

func TestClassify(t *testing.T) {
	tests := []struct {
		err  error
		want Outcome
	}{
		{nil, OutcomeOK},
		{scraper.ErrLoginFailed, OutcomeSessionExpired},
		{fmt.Errorf("x: %w", scraper.ErrLoginFailed), OutcomeSessionExpired},
		{scraper.ErrUnauthorized, OutcomeSessionExpired},
		{scraper.ErrAccessDenied, OutcomeAccessDenied},
		{scraper.ErrServerError, OutcomeError},
		{scraper.ErrHTTPRequestFailed, OutcomeError},
		{scraper.ErrNotFound, OutcomeError},
		{scraper.ErrCanceled, OutcomeError},
		{context.DeadlineExceeded, OutcomeError},
	}
	for _, tt := range tests {
		if got := classify(tt.err); got != tt.want {
			t.Errorf("classify(%v) = %s, want %s", tt.err, got, tt.want)
		}
	}
}

func TestNextUpdate(t *testing.T) {
	prev := model.AutoRefreshState{ConsecutiveFailures: 1}
	tests := []struct {
		name string
		prev model.AutoRefreshState
		o    Outcome
		want model.RefreshUpdate
	}{
		{"ok は失敗回数を戻す", prev, OutcomeOK, model.RefreshUpdate{LastResult: "ok"}},
		{"skipped は失敗回数を保つ", prev, OutcomeSkipped, model.RefreshUpdate{LastResult: "skipped", ConsecutiveFailures: 1}},
		{"no_session は token を空にして止める", prev, OutcomeNoSession, model.RefreshUpdate{LastResult: "no_session", ClearSessionToken: true, StopActive: true}},
		{"session_expired は token を空にして止める", prev, OutcomeSessionExpired, model.RefreshUpdate{LastResult: "session_expired", ClearSessionToken: true, StopActive: true}},
		{"access_denied は止めるが token は残す", prev, OutcomeAccessDenied, model.RefreshUpdate{LastResult: "access_denied", ConsecutiveFailures: 1, StopActive: true}},
		{"error は回数を増やす", model.AutoRefreshState{}, OutcomeError, model.RefreshUpdate{LastResult: "error", ConsecutiveFailures: 1}},
		{"error 2 回目はまだ続ける", prev, OutcomeError, model.RefreshUpdate{LastResult: "error", ConsecutiveFailures: 2}},
		{"error 3 回目で止める", model.AutoRefreshState{ConsecutiveFailures: 2}, OutcomeError, model.RefreshUpdate{LastResult: "error", ConsecutiveFailures: 3, StopActive: true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := nextUpdate(tt.prev, tt.o); got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestEligible(t *testing.T) {
	ok := model.AutoRefreshState{UserKey: "ok", Enabled: true, SessionToken: "t", ActiveUntil: t0.Add(time.Minute)}
	mod := func(f func(*model.AutoRefreshState)) model.AutoRefreshState {
		s := ok
		f(&s)
		return s
	}
	states := []model.AutoRefreshState{
		ok,
		mod(func(s *model.AutoRefreshState) { s.UserKey = "disabled"; s.Enabled = false }),
		mod(func(s *model.AutoRefreshState) { s.UserKey = "notoken"; s.SessionToken = "" }),
		mod(func(s *model.AutoRefreshState) { s.UserKey = "expired"; s.ActiveUntil = t0 }),
		mod(func(s *model.AutoRefreshState) {
			s.UserKey = "leased"
			s.LeaseUntil = t0.Add(time.Minute)
			s.LeaseOwner = "manual:1"
		}),
		mod(func(s *model.AutoRefreshState) {
			s.UserKey = "lease-expired"
			s.LeaseUntil = t0.Add(-time.Second)
			s.LeaseOwner = "job:old"
		}),
	}
	var got []string
	for _, s := range Eligible(states, t0) {
		got = append(got, s.UserKey)
	}
	if want := []string{"ok", "lease-expired"}; !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

// fakeStore は Store の偽物。呼び出しを順に記録する。
type fakeStore struct {
	mu sync.Mutex

	states   []model.AutoRefreshState
	busy     map[string]bool        // lease を他者に取られているユーザー
	sessions map[string]fakeSession // token -> session
	latest   map[string]time.Time   // userKey -> 最新日時
	ids      map[string][]string    // userKey -> 最新日時の MatchID
	legacy   map[string]bool        // userKey -> legacy あり
	finished map[string]model.RefreshUpdate
	deleted  []string
	saved    map[string]int
	events   []string
}

type fakeSession struct {
	userKey string
	jar     []byte
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		busy: map[string]bool{}, sessions: map[string]fakeSession{}, latest: map[string]time.Time{},
		ids: map[string][]string{}, legacy: map[string]bool{}, finished: map[string]model.RefreshUpdate{}, saved: map[string]int{},
	}
}

func (f *fakeStore) rec(format string, a ...any) {
	f.events = append(f.events, fmt.Sprintf(format, a...))
}

func (f *fakeStore) ListActive(context.Context, time.Time) ([]model.AutoRefreshState, error) {
	return f.states, nil
}

func (f *fakeStore) AcquireLease(_ context.Context, userKey, owner string, _ time.Time, _ time.Duration) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.busy[userKey] {
		f.rec("lease-denied:%s", userKey)
		return false, nil
	}
	f.rec("lease:%s:%s", userKey, owner)
	return true, nil
}

func (f *fakeStore) Finish(_ context.Context, userKey, _ string, upd model.RefreshUpdate) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.finished[userKey] = upd
	f.rec("finish:%s", userKey)
	return nil
}

func (f *fakeStore) LoadSession(token string) (string, []byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.sessions[token]
	if !ok {
		return "", nil, nil
	}
	return s.userKey, s.jar, nil
}

func (f *fakeStore) DeleteSession(token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleted = append(f.deleted, token)
	return nil
}

func (f *fakeStore) UpdateSessionJar(_ context.Context, token string, _ []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rec("jar:%s", token)
	return nil
}

func (f *fakeStore) LatestDatetime(userKey string) (time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.latest[userKey], nil
}

func (f *fakeStore) MatchIDsAt(_ context.Context, userKey string, _ time.Time) ([]string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ids[userKey], f.legacy[userKey], nil
}

func (f *fakeStore) SaveScores(userKey string, scores model.DatedScores) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.saved[userKey] += len(scores)
	f.rec("save:%s", userKey)
}

type scrapeCall struct {
	since time.Time
	skip  map[string]bool
}

type fakeScraper struct {
	mu     sync.Mutex
	calls  []scrapeCall
	scores model.DatedScores
	err    error
}

func (s *fakeScraper) scrape(since time.Time, opt scraper.ScrapingOption) (model.DatedScores, http.CookieJar, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, scrapeCall{since, opt.SkipMatchIDs})
	jar, _ := cookiejar.New(nil)
	return s.scores, jar, s.err
}

func testDeps(st *fakeStore, sc *fakeScraper) deps {
	return deps{
		store:   st,
		scrape:  sc.scrape,
		openJar: func([]byte) (http.CookieJar, error) { return cookiejar.New(nil) },
		sealJar: func(http.CookieJar) ([]byte, error) { return []byte("sealed"), nil },
		now:     func() time.Time { return t0 },
	}
}

func activeState(userKey string) model.AutoRefreshState {
	return model.AutoRefreshState{UserKey: userKey, Enabled: true, SessionToken: "tok-" + userKey, ActiveUntil: t0.Add(10 * time.Minute)}
}

func withSession(st *fakeStore, userKey string, latest time.Time) {
	st.sessions["tok-"+userKey] = fakeSession{userKey: userKey, jar: []byte("enc")}
	st.latest[userKey] = latest
}

func newScores() model.DatedScores {
	return model.DatedScores{{PlayerNo: 1, Datetime: t0, MatchID: "new"}}
}

func TestRunJob_LeaseExclusion(t *testing.T) {
	st := newFakeStore()
	st.states = []model.AutoRefreshState{activeState("a"), activeState("b")}
	withSession(st, "a", t0.Add(-time.Hour))
	withSession(st, "b", t0.Add(-time.Hour))
	st.busy["a"] = true
	sc := &fakeScraper{scores: newScores()}

	if err := runJob(context.Background(), testDeps(st, sc), "job:x", nil); err != nil {
		t.Fatal(err)
	}
	if len(sc.calls) != 1 {
		t.Fatalf("lease を取れた b だけ scrape するはずが %d 回", len(sc.calls))
	}
	if _, ok := st.finished["a"]; ok {
		t.Error("lease を取れなかった a は Finish しない(他者の lease を壊さない)")
	}
	if _, ok := st.finished["b"]; !ok || st.saved["b"] != 1 {
		t.Errorf("b は処理される: finished=%v saved=%d", st.finished, st.saved["b"])
	}
	// b の記録順: lease → save → jar → finish
	var order []string
	for _, e := range st.events {
		if e == "lease:b:job:x" || e == "save:b" || e == "jar:tok-b" || e == "finish:b" {
			order = append(order, e)
		}
	}
	if want := []string{"lease:b:job:x", "save:b", "jar:tok-b", "finish:b"}; !slices.Equal(order, want) {
		t.Errorf("記録順 %v, want %v", order, want)
	}
}

func TestRefreshUser_SessionExpired(t *testing.T) {
	st := newFakeStore()
	withSession(st, "a", t0.Add(-time.Hour))
	sc := &fakeScraper{err: fmt.Errorf("x: %w", scraper.ErrLoginFailed)}

	refreshUser(context.Background(), testDeps(st, sc), activeState("a"), "job:x", nil)

	if !slices.Equal(st.deleted, []string{"tok-a"}) {
		t.Errorf("DeleteSession は 1 回: %v", st.deleted)
	}
	upd := st.finished["a"]
	if upd.LastResult != "session_expired" || !upd.ClearSessionToken || !upd.StopActive {
		t.Errorf("失効の記録が違う: %+v", upd)
	}
	if st.saved["a"] != 0 || slices.Contains(st.events, "jar:tok-a") {
		t.Error("失効では保存しない")
	}
}

func TestRefreshUser_TransientKeepsSession(t *testing.T) {
	for _, err := range []error{scraper.ErrServerError, scraper.ErrHTTPRequestFailed, scraper.ErrNotFound, context.DeadlineExceeded} {
		st := newFakeStore()
		withSession(st, "a", t0.Add(-time.Hour))
		sc := &fakeScraper{err: err}

		refreshUser(context.Background(), testDeps(st, sc), activeState("a"), "job:x", nil)

		if len(st.deleted) != 0 {
			t.Errorf("%v: 一時障害でセッションを消した", err)
		}
		upd := st.finished["a"]
		if upd.LastResult != "error" || upd.ConsecutiveFailures != 1 || upd.ClearSessionToken || upd.StopActive {
			t.Errorf("%v: 記録が違う: %+v", err, upd)
		}
	}

	// 403 は途中データを保存し、セッションを残して止める
	st := newFakeStore()
	withSession(st, "a", t0.Add(-time.Hour))
	sc := &fakeScraper{scores: newScores(), err: scraper.ErrAccessDenied}
	refreshUser(context.Background(), testDeps(st, sc), activeState("a"), "job:x", nil)
	if len(st.deleted) != 0 || st.saved["a"] != 1 {
		t.Errorf("403: deleted=%v saved=%d", st.deleted, st.saved["a"])
	}
	if upd := st.finished["a"]; upd.LastResult != "access_denied" || !upd.StopActive || upd.ClearSessionToken {
		t.Errorf("403 の記録が違う: %+v", upd)
	}
}

func TestRefreshUser_NoLatestSkips(t *testing.T) {
	st := newFakeStore()
	withSession(st, "a", time.Time{})
	sc := &fakeScraper{scores: newScores()}

	refreshUser(context.Background(), testDeps(st, sc), activeState("a"), "job:x", nil)

	if len(sc.calls) != 0 {
		t.Error("最新試合が無ければ scrape しない(全件取得を防ぐ)")
	}
	if upd := st.finished["a"]; upd.LastResult != "skipped" || upd.StopActive {
		t.Errorf("skipped の記録が違う: %+v", upd)
	}
}

func TestRefreshUser_NoSession(t *testing.T) {
	st := newFakeStore()
	sc := &fakeScraper{}

	refreshUser(context.Background(), testDeps(st, sc), activeState("a"), "job:x", nil)

	if len(sc.calls) != 0 {
		t.Error("セッションが無ければ scrape しない")
	}
	if upd := st.finished["a"]; upd.LastResult != "no_session" || !upd.ClearSessionToken || !upd.StopActive {
		t.Errorf("no_session の記録が違う: %+v", upd)
	}

	// 復号できないセッションは削除する
	st = newFakeStore()
	withSession(st, "a", t0)
	d := testDeps(st, sc)
	d.openJar = func([]byte) (http.CookieJar, error) { return nil, errors.New("bad key") }
	refreshUser(context.Background(), d, activeState("a"), "job:x", nil)
	if !slices.Equal(st.deleted, []string{"tok-a"}) {
		t.Errorf("復号失敗は DeleteSession: %v", st.deleted)
	}
}

func TestRefreshUser_SinceAndSkipIDs(t *testing.T) {
	latest := time.Date(2026, 10, 5, 11, 30, 0, 0, time.UTC)

	st := newFakeStore()
	withSession(st, "a", latest)
	st.ids["a"] = []string{"m1", "m2"}
	sc := &fakeScraper{}
	refreshUser(context.Background(), testDeps(st, sc), activeState("a"), "job:x", nil)
	if len(sc.calls) != 1 {
		t.Fatalf("scrape 回数 %d", len(sc.calls))
	}
	if want := latest.Add(-time.Minute); !sc.calls[0].since.Equal(want) {
		t.Errorf("since = %v, want %v", sc.calls[0].since, want)
	}
	if !sc.calls[0].skip["m1"] || !sc.calls[0].skip["m2"] || len(sc.calls[0].skip) != 2 {
		t.Errorf("skip = %v", sc.calls[0].skip)
	}
	if upd := st.finished["a"]; upd.LastResult != "ok" {
		t.Errorf("成功の記録が違う: %+v", upd)
	}

	// legacy(match_id 無し)があれば since は最新日時のまま
	st = newFakeStore()
	withSession(st, "a", latest)
	st.legacy["a"] = true
	sc = &fakeScraper{}
	refreshUser(context.Background(), testDeps(st, sc), activeState("a"), "job:x", nil)
	if !sc.calls[0].since.Equal(latest) {
		t.Errorf("legacy では since = latest のはずが %v", sc.calls[0].since)
	}
}
