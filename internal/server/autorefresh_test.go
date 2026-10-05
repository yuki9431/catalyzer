package server

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/autorefresh"
	"github.com/yuki9431/catalyzer/internal/model"
	"golang.org/x/time/rate"
)

func newTestLimiter() *rateLimiter { return newRateLimiter(rate.Every(12*time.Minute), 5) }

func TestCheckPassphrase(t *testing.T) {
	phc, err := autorefresh.HashPassphrase("right-pass")
	if err != nil {
		t.Fatal(err)
	}
	g := autorefresh.Gate{Hash: phc}

	t.Run("空と誤りは 403、正解は 200", func(t *testing.T) {
		l := newTestLimiter()
		if got := checkPassphrase(g, l, "u", "1.1.1.1", ""); got != http.StatusForbidden {
			t.Errorf("空 = %d", got)
		}
		if got := checkPassphrase(g, l, "u", "1.1.1.1", "wrong"); got != http.StatusForbidden {
			t.Errorf("誤り = %d", got)
		}
		if got := checkPassphrase(g, l, "u", "1.1.1.1", "right-pass"); got != http.StatusOK {
			t.Errorf("正解 = %d", got)
		}
	})

	t.Run("長すぎる入力は 400", func(t *testing.T) {
		if got := checkPassphrase(g, newTestLimiter(), "u", "1.1.1.1", strings.Repeat("a", 129)); got != http.StatusBadRequest {
			t.Errorf("= %d", got)
		}
	})

	t.Run("6 回目は正解でも 429、別ユーザー別 IP は影響を受けない", func(t *testing.T) {
		l := newTestLimiter()
		for i := 0; i < 5; i++ {
			checkPassphrase(g, l, "u", "1.1.1.1", "wrong")
		}
		if got := checkPassphrase(g, l, "u", "2.2.2.2", "right-pass"); got != http.StatusTooManyRequests {
			t.Errorf("同じユーザーの 6 回目 = %d", got)
		}
		if got := checkPassphrase(g, l, "other", "3.3.3.3", "right-pass"); got != http.StatusOK {
			t.Errorf("別ユーザーが巻き込まれた = %d", got)
		}
	})

	t.Run("IP キーも効く", func(t *testing.T) {
		l := newTestLimiter()
		for _, u := range []string{"a", "b", "c", "d", "e"} {
			checkPassphrase(g, l, u, "9.9.9.9", "wrong")
		}
		if got := checkPassphrase(g, l, "f", "9.9.9.9", "right-pass"); got != http.StatusTooManyRequests {
			t.Errorf("同じ IP の 6 回目 = %d", got)
		}
	})

	t.Run("開放モードは照合も制限もしない", func(t *testing.T) {
		l := newTestLimiter()
		open := autorefresh.Gate{Open: true}
		for i := 0; i < 10; i++ {
			if got := checkPassphrase(open, l, "u", "1.1.1.1", ""); got != http.StatusOK {
				t.Fatalf("%d 回目 = %d", i+1, got)
			}
		}
	})
}

func TestTickHandler(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	active := model.AutoRefreshState{UserKey: "a", Enabled: true, SessionToken: "t", ActiveUntil: now.Add(time.Minute)}

	run := func(states []model.AutoRefreshState, listErr, launchErr error) (code int, body string, launches int) {
		h := newTickHandler(
			func(context.Context, time.Time) ([]model.AutoRefreshState, error) { return states, listErr },
			func(context.Context) error { launches++; return launchErr },
			clock,
		)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/internal/auto-refresh/tick", nil))
		return rec.Code, strings.TrimSpace(rec.Body.String()), launches
	}

	if code, body, n := run(nil, nil, nil); code != 200 || n != 0 || body != `{"launched":false,"targets":0}` {
		t.Errorf("対象 0: code=%d launches=%d body=%s", code, n, body)
	}
	// lease が取られている・無効のユーザーだけなら起動しない
	leased := active
	leased.LeaseUntil, leased.LeaseOwner = now.Add(time.Minute), "manual:x"
	if code, _, n := run([]model.AutoRefreshState{leased}, nil, nil); code != 200 || n != 0 {
		t.Errorf("lease 中のみ: code=%d launches=%d", code, n)
	}
	if code, body, n := run([]model.AutoRefreshState{active}, nil, nil); code != 200 || n != 1 || body != `{"launched":true,"targets":1}` {
		t.Errorf("対象あり: code=%d launches=%d body=%s", code, n, body)
	}
	if code, _, n := run([]model.AutoRefreshState{active}, nil, errors.New("boom")); code != http.StatusBadGateway || n != 1 {
		t.Errorf("起動失敗: code=%d launches=%d", code, n)
	}
	if code, _, n := run(nil, errors.New("boom"), nil); code != http.StatusInternalServerError || n != 0 {
		t.Errorf("一覧失敗: code=%d launches=%d", code, n)
	}
}

type fakeARStore struct {
	state    *model.AutoRefreshState
	enabled  []string // 有効化した fp
	disabled int
}

func (f *fakeARStore) Get(context.Context, string) (*model.AutoRefreshState, error) {
	return f.state, nil
}

func (f *fakeARStore) Enable(_ context.Context, _, _, fp string, _ time.Time) error {
	f.enabled = append(f.enabled, fp)
	return nil
}

func (f *fakeARStore) Disable(context.Context, string) error {
	f.disabled++
	f.state = nil
	return nil
}

func (f *fakeARStore) Touch(context.Context, string, string, time.Time) (*model.AutoRefreshState, error) {
	return f.state, nil
}

func testAPI(t *testing.T, gate autorefresh.Gate) (*autoRefreshAPI, *fakeARStore) {
	t.Helper()
	st := &fakeARStore{}
	return &autoRefreshAPI{
		cfg:       autorefresh.Config{JobName: "projects/p/locations/l/jobs/j", Gate: gate},
		sessionOn: true,
		limiter:   newTestLimiter(),
		store:     st,
		now:       func() time.Time { return time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) },
		loadSession: func(token string) (string, []byte, error) {
			if token == "good" {
				return "user1", []byte("jar"), nil
			}
			return "", nil, nil
		},
	}, st
}

func arRequest(method, path, body, cookie string) *http.Request {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: cookie})
	}
	return req
}

func TestAutoRefreshEnable(t *testing.T) {
	phc, _ := autorefresh.HashPassphrase("right-pass")
	gate := autorefresh.Gate{Hash: phc}
	tests := []struct {
		name   string
		body   string
		cookie string
		api    func(*autoRefreshAPI)
		want   int
	}{
		{"Cookie が無ければ 409", `{"enabled":true,"passphrase":"right-pass"}`, "", nil, 409},
		{"解決できないセッションは 401", `{"enabled":true,"passphrase":"right-pass"}`, "stale", nil, 401},
		{"誤った合言葉は 403", `{"enabled":true,"passphrase":"nope"}`, "good", nil, 403},
		{"正しい合言葉は 200", `{"enabled":true,"passphrase":"right-pass"}`, "good", nil, 200},
		{"機能が無効なら 503", `{"enabled":true,"passphrase":"right-pass"}`, "good", func(a *autoRefreshAPI) { a.cfg.JobName = "" }, 503},
		{"壊れたボディは 400", `{`, "good", nil, 400},
		{"無効化は合言葉不要", `{"enabled":false}`, "good", nil, 200},
		{"無効化でセッション無しは 401", `{"enabled":false}`, "", nil, 401},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, st := testAPI(t, gate)
			if tt.api != nil {
				tt.api(a)
			}
			rec := httptest.NewRecorder()
			a.handleAutoRefresh(rec, arRequest(http.MethodPost, "/auto-refresh", tt.body, tt.cookie))
			if rec.Code != tt.want {
				t.Errorf("status = %d, want %d (%s)", rec.Code, tt.want, rec.Body.String())
			}
			if (tt.want == 200 && strings.Contains(tt.body, `"enabled":true`)) != (len(st.enabled) == 1) {
				t.Errorf("有効化の書き込み回数 = %d", len(st.enabled))
			}
		})
	}
}

func TestAutoRefreshGateChangeRevokes(t *testing.T) {
	phc, _ := autorefresh.HashPassphrase("right-pass")
	gate := autorefresh.Gate{Hash: phc}
	a, st := testAPI(t, gate)
	until := a.now().Add(10 * time.Minute)

	// 同じ合言葉で有効化した状態は維持される
	st.state = &model.AutoRefreshState{Enabled: true, SessionToken: "good", PassphraseFP: gate.Fingerprint(), ActiveUntil: until}
	rec := httptest.NewRecorder()
	a.handleAutoRefresh(rec, arRequest(http.MethodGet, "/auto-refresh", "", "good"))
	if !strings.Contains(rec.Body.String(), `"status":"active"`) || st.disabled != 0 {
		t.Errorf("維持されるはず: %s disabled=%d", rec.Body.String(), st.disabled)
	}

	// 合言葉が変わると GET と touch の両方で無効化される
	st.state = &model.AutoRefreshState{Enabled: true, SessionToken: "good", PassphraseFP: "oldfingerprint00", ActiveUntil: until}
	rec = httptest.NewRecorder()
	a.handleAutoRefresh(rec, arRequest(http.MethodGet, "/auto-refresh", "", "good"))
	if !strings.Contains(rec.Body.String(), `"status":"off"`) || st.disabled != 1 {
		t.Errorf("GET で無効化されるはず: %s disabled=%d", rec.Body.String(), st.disabled)
	}
	st.state = &model.AutoRefreshState{Enabled: true, SessionToken: "good", PassphraseFP: "oldfingerprint00", ActiveUntil: until}
	rec = httptest.NewRecorder()
	a.handleTouch(rec, arRequest(http.MethodPost, "/auto-refresh/touch", "", "good"))
	if !strings.Contains(rec.Body.String(), `"enabled":false`) || st.disabled != 2 {
		t.Errorf("touch で無効化されるはず: %s disabled=%d", rec.Body.String(), st.disabled)
	}
}

func TestAutoRefreshStatusOf(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		st         *model.AutoRefreshState
		wantStatus string
		wantReason string
	}{
		{"未登録", nil, "off", ""},
		{"無効", &model.AutoRefreshState{}, "off", ""},
		{"期間内", &model.AutoRefreshState{Enabled: true, ActiveUntil: now.Add(time.Minute)}, "active", ""},
		{"期間切れ", &model.AutoRefreshState{Enabled: true, LastResult: "ok"}, "idle", ""},
		{"失効で停止", &model.AutoRefreshState{Enabled: true, LastResult: "session_expired"}, "stopped", "session_expired"},
		{"403 で停止", &model.AutoRefreshState{Enabled: true, LastResult: "access_denied"}, "stopped", "access_denied"},
		{"error 3 回で停止", &model.AutoRefreshState{Enabled: true, LastResult: "error", ConsecutiveFailures: 3}, "stopped", "error"},
		{"error 2 回は待機", &model.AutoRefreshState{Enabled: true, LastResult: "error", ConsecutiveFailures: 2}, "idle", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, r := statusOf(tt.st, now)
			if s != tt.wantStatus || r != tt.wantReason {
				t.Errorf("= (%s, %s), want (%s, %s)", s, r, tt.wantStatus, tt.wantReason)
			}
		})
	}
}

func TestAcquireManualLease(t *testing.T) {
	orig := refreshLeases
	t.Cleanup(func() { refreshLeases = orig })
	acquire := func(acquired bool, err error) {
		refreshLeases.acquire = func(context.Context, string, string, time.Time, time.Duration) (bool, error) {
			return acquired, err
		}
	}

	acquire(true, nil)
	if owner, ok := acquireManualLease("u"); !ok || !strings.HasPrefix(owner, "manual:") {
		t.Errorf("取得できるはず: owner=%q ok=%v", owner, ok)
	}
	acquire(false, nil)
	if _, ok := acquireManualLease("u"); ok {
		t.Error("他者が保持中なら取れない")
	}
	acquire(false, errors.New("firestore down"))
	if _, ok := acquireManualLease("u"); !ok {
		t.Error("Firestore 障害では fail-open で続行する")
	}
}

func TestLazyLauncherRetriesAfterClientFailure(t *testing.T) {
	calls := 0
	newClient := func(context.Context) (*http.Client, error) {
		calls++
		if calls == 1 {
			return nil, errors.New("adc unavailable")
		}
		return &http.Client{}, nil
	}
	launched := 0
	launch := func(context.Context, *http.Client, string) error { launched++; return nil }
	l := newLazyLauncher(newClient, launch, "job")

	if err := l(context.Background()); err == nil {
		t.Fatal("1 回目は失敗するはず")
	}
	if err := l(context.Background()); err != nil {
		t.Fatalf("2 回目は再試行して成功するはず: %v", err)
	}
	if err := l(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || launched != 2 {
		t.Errorf("newClient=%d launch=%d, want 2/2(成功後はキャッシュ)", calls, launched)
	}
}
