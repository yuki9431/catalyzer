package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/aidiagnosis"
	"github.com/yuki9431/catalyzer/internal/model"
	"golang.org/x/time/rate"
)

const (
	aiOwnerKey = "0123456789abcdef"
	aiOtherKey = "fedcba9876543210"
)

type fakeAIStore struct {
	st        *model.AIDiagnosisState
	global    int
	requests  int
	failCodes []string
	failID    string
	getErr    error
}

func (f *fakeAIStore) Get(context.Context, string) (*model.AIDiagnosisState, error) {
	return f.st, f.getErr
}

func (f *fakeAIStore) Request(_ context.Context, userKey, day string, now time.Time, inputJSON, requestID string,
	decide func(*model.AIDiagnosisState, int) (string, int)) (string, error) {
	v, attempts := decide(f.st, f.global)
	if v == "ok" {
		f.requests++
		f.failID = requestID
		f.st = &model.AIDiagnosisState{
			UserKey: userKey, RequestID: requestID, Status: "pending", PlayDay: day, InputJSON: inputJSON,
			Attempts: attempts, RequestedAt: now,
		}
		f.global++
	}
	return v, nil
}

func (f *fakeAIStore) Fail(_ context.Context, _, requestID, code string) error {
	if requestID == f.failID {
		f.failCodes = append(f.failCodes, code)
		f.st.Status, f.st.ErrorCode = "error", code
	}
	return nil
}

type aiHarness struct {
	api       *aiDiagnosisAPI
	store     *fakeAIStore
	launches  int
	launchErr error
	now       time.Time
}

func newAIHarness(t *testing.T, cfg aidiagnosis.Config) *aiHarness {
	t.Helper()
	h := &aiHarness{store: &fakeAIStore{}, now: time.Date(2026, 11, 18, 12, 0, 0, 0, time.FixedZone("JST", 9*3600))}
	h.api = &aiDiagnosisAPI{
		cfg: cfg, sessionOn: true, msNames: map[string]bool{"ガンダム": true, "ザク": true, "ジオング": true},
		limiter: newRateLimiter(rate.Every(10*time.Minute), 6), store: h.store,
		launch: func(context.Context) error { h.launches++; return h.launchErr },
		now:    func() time.Time { return h.now },
		newID:  func() string { return "req-1" },
		loadSession: func(token string) (string, []byte, error) {
			switch token {
			case "owner":
				return aiOwnerKey, nil, nil
			case "other":
				return aiOtherKey, nil, nil
			}
			return "", nil, errors.New("unknown session")
		},
	}
	return h
}

func ownerCfg() aidiagnosis.Config {
	return aidiagnosis.Config{JobName: "projects/p/locations/l/jobs/j", Allowed: map[string]bool{aiOwnerKey: true}}
}

func (h *aiHarness) do(method, token, body string) *httptest.ResponseRecorder {
	var rd *bytes.Reader
	if body != "" {
		rd = bytes.NewReader([]byte(body))
	} else {
		rd = bytes.NewReader(nil)
	}
	r := httptest.NewRequest(method, "/ai-diagnosis", rd)
	r.RemoteAddr = "192.0.2.1:1234"
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		r.AddCookie(&http.Cookie{Name: "catalyzer_session", Value: token})
	}
	rec := httptest.NewRecorder()
	h.api.handle(rec, r)
	return rec
}

func decodeAI(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("JSON でない応答: %q", rec.Body.String())
	}
	return m
}

func validAIBody(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../aidiagnosis/prompt/sample_input.json")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestAIDiagnosisGet(t *testing.T) {
	today := aidiagnosis.PlayDay(newAIHarness(t, ownerCfg()).now)
	t.Run("セッション無しは 401", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		if rec := h.do(http.MethodGet, "", ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("code = %d", rec.Code)
		}
		if rec := h.do(http.MethodGet, "unknown", ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("不明なセッション code = %d", rec.Code)
		}
	})
	t.Run("Job 未設定・許可リスト外・暗号化無効は available:false", func(t *testing.T) {
		noJob := newAIHarness(t, aidiagnosis.Config{Allowed: map[string]bool{aiOwnerKey: true}})
		notAllowed := newAIHarness(t, ownerCfg())
		sessionOff := newAIHarness(t, ownerCfg())
		sessionOff.api.sessionOn = false
		for name, c := range map[string]struct {
			h     *aiHarness
			token string
		}{"Job 未設定": {noJob, "owner"}, "許可リスト外": {notAllowed, "other"}, "暗号化無効": {sessionOff, "owner"}} {
			rec := c.h.do(http.MethodGet, c.token, "")
			if rec.Code != http.StatusOK || decodeAI(t, rec)["available"] != false {
				t.Errorf("%s: %d %s", name, rec.Code, rec.Body.String())
			}
		}
	})
	t.Run("状態ごとの本文", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		rec := h.do(http.MethodGet, "owner", "")
		if m := decodeAI(t, rec); rec.Code != 200 || m["available"] != true || m["status"] != "none" || m["min_matches"] != float64(10) {
			t.Errorf("none: %d %v", rec.Code, m)
		}

		h.store.st = &model.AIDiagnosisState{Status: "running", PlayDay: today, LeaseUntil: h.now.Add(time.Minute)}
		if m := decodeAI(t, h.do(http.MethodGet, "owner", "")); m["status"] != "running" {
			t.Errorf("running: %v", m)
		}

		h.store.st = &model.AIDiagnosisState{Status: "done", PlayDay: today, Attempts: 1, ResultJSON: `{"headline":{"text":"H","evidence":["a"]},"tendencies":[{"text":"t1","evidence":["a"]}],"cautions":[],"strengths":[{"text":"s1","evidence":["a"]}]}`}
		rec = h.do(http.MethodGet, "owner", "")
		m := decodeAI(t, rec)
		res, _ := m["result"].(map[string]any)
		if m["status"] != "done" || res["headline"] != "H" || m["next_at"] != "2026-11-19T05:00:00+09:00" || m["retry"] != nil {
			t.Errorf("done: %v", m)
		}
		if strings.Contains(rec.Body.String(), "evidence") {
			t.Errorf("evidence が漏れている: %s", rec.Body.String())
		}

		h.store.st = &model.AIDiagnosisState{Status: "error", PlayDay: today, Attempts: 1, ErrorCode: "claude_failed"}
		m = decodeAI(t, h.do(http.MethodGet, "owner", ""))
		if m["status"] != "error" || m["retry"] != true || m["attempts_left"] != float64(2) || m["error"] != "AIの応答を受け取れませんでした" || m["next_at"] != nil {
			t.Errorf("error 再試行可: %v", m)
		}

		h.store.st = &model.AIDiagnosisState{Status: "error", PlayDay: today, Attempts: 3, ErrorCode: "weird"}
		m = decodeAI(t, h.do(http.MethodGet, "owner", ""))
		if m["retry"] != false || m["error"] != "診断できませんでした" || m["next_at"] == nil {
			t.Errorf("error 再試行不可: %v", m)
		}
	})
	t.Run("結果が壊れていると 500", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		h.store.st = &model.AIDiagnosisState{Status: "done", PlayDay: today, ResultJSON: "{"}
		if rec := h.do(http.MethodGet, "owner", ""); rec.Code != http.StatusInternalServerError {
			t.Errorf("code = %d", rec.Code)
		}
	})
	t.Run("メソッド違いは 405", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		if rec := h.do(http.MethodPut, "owner", ""); rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("code = %d", rec.Code)
		}
	})
}

func TestAIDiagnosisPost(t *testing.T) {
	t.Run("セッション無しは 401", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		if rec := h.do(http.MethodPost, "", "{}"); rec.Code != http.StatusUnauthorized {
			t.Errorf("code = %d", rec.Code)
		}
	})
	t.Run("許可リスト外は 403", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		if rec := h.do(http.MethodPost, "other", validAIBody(t)); rec.Code != http.StatusForbidden {
			t.Errorf("code = %d", rec.Code)
		}
		if h.launches != 0 {
			t.Error("Job を起動した")
		}
	})
	t.Run("Job 未設定・暗号化無効も 403", func(t *testing.T) {
		noJob := newAIHarness(t, aidiagnosis.Config{Allowed: map[string]bool{aiOwnerKey: true}})
		sessionOff := newAIHarness(t, ownerCfg())
		sessionOff.api.sessionOn = false
		for name, h := range map[string]*aiHarness{"Job 未設定": noJob, "暗号化無効": sessionOff} {
			if rec := h.do(http.MethodPost, "owner", validAIBody(t)); rec.Code != http.StatusForbidden {
				t.Errorf("%s: code = %d", name, rec.Code)
			}
			if h.launches != 0 || h.store.requests != 0 {
				t.Errorf("%s: 保存・起動した", name)
			}
		}
	})
	t.Run("Content-Type が JSON でないと 415", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		r := httptest.NewRequest(http.MethodPost, "/ai-diagnosis", strings.NewReader("a=b"))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.AddCookie(&http.Cookie{Name: "catalyzer_session", Value: "owner"})
		rec := httptest.NewRecorder()
		h.api.handle(rec, r)
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Errorf("code = %d", rec.Code)
		}
	})
	t.Run("不正な入力は 400", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		for _, body := range []string{"{}", `{"v":1,"unknown":1}`, strings.Repeat("x", 9000)} {
			rec := h.do(http.MethodPost, "owner", body)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("code = %d (%.20s)", rec.Code, body)
			}
			if errMsg, _ := decodeAI(t, rec)["error"].(string); errMsg != "入力が不正です" {
				t.Errorf("error = %q", errMsg)
			}
		}
		if h.store.requests != 0 || h.launches != 0 {
			t.Error("不正な入力で保存・起動した")
		}
	})
	t.Run("202 で Job を1回起動する", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		rec := h.do(http.MethodPost, "owner", validAIBody(t))
		m := decodeAI(t, rec)
		if rec.Code != http.StatusAccepted || m["status"] != "pending" || m["available"] != true {
			t.Errorf("%d %v", rec.Code, m)
		}
		if h.launches != 1 || h.store.requests != 1 {
			t.Errorf("launches=%d requests=%d", h.launches, h.store.requests)
		}
		want, err := aidiagnosis.ValidateInput([]byte(validAIBody(t)), h.api.msNames)
		if err != nil {
			t.Fatal(err)
		}
		if h.store.st.InputJSON != string(want) {
			t.Errorf("保存された入力が正規化結果と違う: %s", h.store.st.InputJSON)
		}
		if h.store.st.InputJSON == "" || h.store.st.Attempts != 1 {
			t.Errorf("保存内容が不正: %+v", h.store.st)
		}
	})
	t.Run("実行中・成功済みは 409 と状態", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		h.do(http.MethodPost, "owner", validAIBody(t))
		rec := h.do(http.MethodPost, "owner", validAIBody(t))
		if m := decodeAI(t, rec); rec.Code != http.StatusConflict || m["status"] != "pending" {
			t.Errorf("busy: %d %v", rec.Code, m)
		}
		h.store.st.Status = "done"
		h.store.st.ResultJSON = `{"headline":{"text":"H"},"tendencies":[],"cautions":[],"strengths":[]}`
		rec = h.do(http.MethodPost, "owner", validAIBody(t))
		if m := decodeAI(t, rec); rec.Code != http.StatusConflict || m["status"] != "done" {
			t.Errorf("done: %d %v", rec.Code, m)
		}
		if h.launches != 1 {
			t.Errorf("launches = %d", h.launches)
		}
	})
	t.Run("上限は 429", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		h.store.global = aidiagnosis.GlobalDailyMax
		rec := h.do(http.MethodPost, "owner", validAIBody(t))
		if rec.Code != http.StatusTooManyRequests || decodeAI(t, rec)["error"] != aiDiagnosisCapMessage {
			t.Errorf("global_cap: %d %s", rec.Code, rec.Body.String())
		}
		h.store.global = 0
		h.store.st = &model.AIDiagnosisState{Status: "error", PlayDay: aidiagnosis.PlayDay(h.now), Attempts: 3}
		if rec := h.do(http.MethodPost, "owner", validAIBody(t)); rec.Code != http.StatusTooManyRequests {
			t.Errorf("attempts_exhausted: %d", rec.Code)
		}
		if h.launches != 0 {
			t.Error("Job を起動した")
		}
	})
	t.Run("起動失敗は 502 と launch_failed の記録", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		h.launchErr = errors.New("boom")
		rec := h.do(http.MethodPost, "owner", validAIBody(t))
		if rec.Code != http.StatusBadGateway {
			t.Errorf("code = %d", rec.Code)
		}
		if len(h.store.failCodes) != 1 || h.store.failCodes[0] != "launch_failed" {
			t.Errorf("failCodes = %v", h.store.failCodes)
		}
	})
	t.Run("7回目は 429", func(t *testing.T) {
		h := newAIHarness(t, ownerCfg())
		for i := 0; i < 6; i++ {
			if rec := h.do(http.MethodPost, "", "{}"); rec.Code != http.StatusUnauthorized {
				t.Fatalf("%d 回目 code = %d", i+1, rec.Code)
			}
		}
		if rec := h.do(http.MethodPost, "", "{}"); rec.Code != http.StatusTooManyRequests {
			t.Errorf("7回目 code = %d", rec.Code)
		}
	})
}
