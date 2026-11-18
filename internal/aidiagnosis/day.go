package aidiagnosis

import (
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

const (
	MaxAttempts    = 3
	GlobalDailyMax = 10
	PendingStale   = 10 * time.Minute
	JobLease       = 5 * time.Minute
	ClaudeTimeout  = 180 * time.Second
	MinMatches     = 10
)

// jst は alpine に tzdata が無いので固定オフセットで持つ。
var jst = time.FixedZone("JST", 9*3600)

const resetHour = 5

// PlayDay は朝5時で切り替わるプレイ日(JST)を "2006-01-02" で返す。
func PlayDay(t time.Time) string {
	return t.In(jst).Add(-resetHour * time.Hour).Format("2006-01-02")
}

// NextReset は次の 05:00 JST を返す。
func NextReset(t time.Time) time.Time {
	l := t.In(jst)
	next := time.Date(l.Year(), l.Month(), l.Day(), resetHour, 0, 0, 0, jst)
	if !next.After(l) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

type Verdict string

const (
	VerdictOK                Verdict = "ok"
	VerdictDoneToday         Verdict = "done_today"
	VerdictBusy              Verdict = "busy"
	VerdictAttemptsExhausted Verdict = "attempts_exhausted"
	VerdictGlobalCap         Verdict = "global_cap"
)

func isStale(st *model.AIDiagnosisState, now time.Time) bool {
	switch st.Status {
	case "pending":
		return now.Sub(st.RequestedAt) > PendingStale
	case "running":
		return now.After(st.LeaseUntil)
	}
	return false
}

func inFlight(st *model.AIDiagnosisState, now time.Time) bool {
	return (st.Status == "pending" || st.Status == "running") && !isStale(st, now)
}

// Decide は診断の要求を受けてよいかを判定する。ok のとき attempts は保存する試行回数。
func Decide(st *model.AIDiagnosisState, globalCount int, now time.Time) (v Verdict, attempts int) {
	sameDay := st != nil && st.PlayDay == PlayDay(now)
	if sameDay {
		switch {
		case st.Status == "done":
			return VerdictDoneToday, 0
		case inFlight(st, now):
			return VerdictBusy, 0
		case st.Attempts >= MaxAttempts:
			return VerdictAttemptsExhausted, 0
		}
	}
	if globalCount >= GlobalDailyMax {
		return VerdictGlobalCap, 0
	}
	if sameDay {
		return VerdictOK, st.Attempts + 1
	}
	return VerdictOK, 1
}

// ViewState は GET /ai-diagnosis が返す状態。
type ViewState struct {
	Status       string
	Retry        bool
	AttemptsLeft int
	NextAt       time.Time
	ErrorCode    string
}

// View は保存状態を画面向けの状態にする。
func View(st *model.AIDiagnosisState, now time.Time) ViewState {
	if st == nil || st.PlayDay != PlayDay(now) {
		return ViewState{Status: "none"}
	}
	v := ViewState{Status: st.Status}
	if isStale(st, now) {
		v.Status, v.ErrorCode = "error", CodeTimeout
	} else if st.Status == "error" {
		v.ErrorCode = st.ErrorCode
	}
	if v.Status == "error" {
		v.AttemptsLeft = max(MaxAttempts-st.Attempts, 0)
		v.Retry = v.AttemptsLeft > 0
	}
	if v.Status == "done" || (v.Status == "error" && !v.Retry) {
		v.NextAt = NextReset(now)
	}
	return v
}
