package aidiagnosis

import (
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

func jstTime(y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, jst)
}

func TestPlayDay(t *testing.T) {
	tests := []struct {
		name string
		in   time.Time
		want string
	}{
		{"04:59 JST は前日", jstTime(2026, 11, 18, 4, 59), "2026-11-17"},
		{"05:00 JST は当日", jstTime(2026, 11, 18, 5, 0), "2026-11-18"},
		{"UTC 20:00 は翌日の JST 05:00", time.Date(2026, 11, 17, 20, 0, 0, 0, time.UTC), "2026-11-18"},
	}
	for _, tt := range tests {
		if got := PlayDay(tt.in); got != tt.want {
			t.Errorf("%s: PlayDay = %s, want %s", tt.name, got, tt.want)
		}
	}
}

func TestNextReset(t *testing.T) {
	tests := []struct {
		name     string
		in, want time.Time
	}{
		{"朝5時前は当日5時", jstTime(2026, 11, 18, 4, 59), jstTime(2026, 11, 18, 5, 0)},
		{"5時ちょうどは翌日5時", jstTime(2026, 11, 18, 5, 0), jstTime(2026, 11, 19, 5, 0)},
		{"夜は翌日5時", jstTime(2026, 11, 18, 23, 0), jstTime(2026, 11, 19, 5, 0)},
		{"UTC でも JST の5時", time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC), jstTime(2026, 11, 19, 5, 0)},
	}
	for _, tt := range tests {
		if got := NextReset(tt.in); !got.Equal(tt.want) {
			t.Errorf("%s: NextReset = %v, want %v", tt.name, got, tt.want)
		}
	}
}

func TestDecide(t *testing.T) {
	now := jstTime(2026, 11, 18, 12, 0)
	today := PlayDay(now)
	st := func(status string, attempts int, mod func(*model.AIDiagnosisState)) *model.AIDiagnosisState {
		s := &model.AIDiagnosisState{Status: status, PlayDay: today, Attempts: attempts}
		if mod != nil {
			mod(s)
		}
		return s
	}
	tests := []struct {
		name         string
		st           *model.AIDiagnosisState
		global       int
		want         Verdict
		wantAttempts int
	}{
		{"状態なし", nil, 0, VerdictOK, 1},
		{"前日の done", &model.AIDiagnosisState{Status: "done", PlayDay: "2026-11-17", Attempts: 1}, 0, VerdictOK, 1},
		{"同日 done", st("done", 1, nil), 0, VerdictDoneToday, 0},
		{"done は global_cap より優先", st("done", 1, nil), 10, VerdictDoneToday, 0},
		{"pending(新しい)", st("pending", 1, func(s *model.AIDiagnosisState) { s.RequestedAt = now.Add(-time.Minute) }), 0, VerdictBusy, 0},
		{"pending(stale)", st("pending", 1, func(s *model.AIDiagnosisState) { s.RequestedAt = now.Add(-11 * time.Minute) }), 0, VerdictOK, 2},
		{"running(lease 内)", st("running", 1, func(s *model.AIDiagnosisState) { s.LeaseUntil = now.Add(time.Minute) }), 0, VerdictBusy, 0},
		{"running(stale)", st("running", 2, func(s *model.AIDiagnosisState) { s.LeaseUntil = now.Add(-time.Second) }), 0, VerdictOK, 3},
		{"error 2回目", st("error", 1, nil), 0, VerdictOK, 2},
		{"error 3回済み", st("error", 3, nil), 0, VerdictAttemptsExhausted, 0},
		{"attempts_exhausted は global_cap より優先", st("error", 3, nil), 10, VerdictAttemptsExhausted, 0},
		{"状態なしで global_cap", nil, 10, VerdictGlobalCap, 0},
		{"error でも global_cap", st("error", 1, nil), 10, VerdictGlobalCap, 0},
		{"global 9 は通る", nil, 9, VerdictOK, 1},
	}
	for _, tt := range tests {
		got, attempts := Decide(tt.st, tt.global, now)
		if got != tt.want || attempts != tt.wantAttempts {
			t.Errorf("%s: Decide = (%s, %d), want (%s, %d)", tt.name, got, attempts, tt.want, tt.wantAttempts)
		}
	}
}

func TestView(t *testing.T) {
	now := jstTime(2026, 11, 18, 12, 0)
	today := PlayDay(now)
	next := NextReset(now)
	tests := []struct {
		name string
		st   *model.AIDiagnosisState
		want ViewState
	}{
		{"nil", nil, ViewState{Status: "none"}},
		{"別の日", &model.AIDiagnosisState{Status: "done", PlayDay: "2026-11-17"}, ViewState{Status: "none"}},
		{"pending", &model.AIDiagnosisState{Status: "pending", PlayDay: today, RequestedAt: now.Add(-time.Minute)}, ViewState{Status: "pending"}},
		{"running", &model.AIDiagnosisState{Status: "running", PlayDay: today, LeaseUntil: now.Add(time.Minute)}, ViewState{Status: "running"}},
		{"pending stale は timeout の error", &model.AIDiagnosisState{Status: "pending", PlayDay: today, Attempts: 1, RequestedAt: now.Add(-time.Hour)},
			ViewState{Status: "error", ErrorCode: "timeout", Retry: true, AttemptsLeft: 2}},
		{"running stale", &model.AIDiagnosisState{Status: "running", PlayDay: today, Attempts: 3, LeaseUntil: now.Add(-time.Minute)},
			ViewState{Status: "error", ErrorCode: "timeout", NextAt: next}},
		{"done", &model.AIDiagnosisState{Status: "done", PlayDay: today, Attempts: 1}, ViewState{Status: "done", NextAt: next}},
		{"error 再試行可", &model.AIDiagnosisState{Status: "error", PlayDay: today, Attempts: 2, ErrorCode: "claude_failed"},
			ViewState{Status: "error", ErrorCode: "claude_failed", Retry: true, AttemptsLeft: 1}},
		{"error 再試行不可", &model.AIDiagnosisState{Status: "error", PlayDay: today, Attempts: 3, ErrorCode: "invalid_output"},
			ViewState{Status: "error", ErrorCode: "invalid_output", NextAt: next}},
	}
	for _, tt := range tests {
		got := View(tt.st, now)
		if got.Status != tt.want.Status || got.Retry != tt.want.Retry || got.AttemptsLeft != tt.want.AttemptsLeft ||
			got.ErrorCode != tt.want.ErrorCode || !got.NextAt.Equal(tt.want.NextAt) {
			t.Errorf("%s: View = %+v, want %+v", tt.name, got, tt.want)
		}
	}
}
