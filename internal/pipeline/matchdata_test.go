package pipeline

import (
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

// match は4人分のDatedScoreを同一datetimeで生成するテストヘルパー。
// PlayerNo 1..4 に p1Win を自分(PlayerNo 1)の勝敗として割り当てる。
func match(dt time.Time, p1Win bool) model.DatedScores {
	ds := make(model.DatedScores, 4)
	for i := 0; i < 4; i++ {
		ds[i] = model.DatedScore{
			PlayerNo: i + 1,
			Datetime: dt,
			PlayerScore: model.PlayerScore{
				Name: string(rune('a' + i)),
				Win:  (i < 2) == p1Win, // team1(PlayerNo 1,2)はp1Winと同じ勝敗
			},
		}
	}
	return ds
}

// matchWithID はmatch()の結果にMatchIDを付与するテストヘルパー
// （同一分の複数試合を区別するケースの検証用。#358）。
func matchWithID(dt time.Time, p1Win bool, matchID string) model.DatedScores {
	ds := match(dt, p1Win)
	for i := range ds {
		ds[i].MatchID = matchID
	}
	return ds
}

func TestBuildMatchData_AfterBoundaryIsStrict(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	var scores model.DatedScores
	// after と完全一致（境界そのもの）— 厳密な > なので除外されるべき
	scores = append(scores, match(base, true)...)
	// after より1分後 — 含まれるべき
	scores = append(scores, match(base.Add(time.Minute), false)...)
	// after より前 — 除外されるべき
	scores = append(scores, match(base.Add(-time.Minute), true)...)

	got := BuildMatchData(scores, nil, base)

	if len(got) != 1 {
		t.Fatalf("境界(=after)と過去は除外し、after超のみ返すはず: want 1 match, got %d", len(got))
	}
	wantDate := base.Add(time.Minute).Format("2006-01-02 15:04")
	if got[0].Date != wantDate {
		t.Errorf("返された試合の日時が不正: want %q, got %q", wantDate, got[0].Date)
	}
}

func TestBuildMatchData_ZeroAfterReturnsAll(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	var scores model.DatedScores
	scores = append(scores, match(base, true)...)
	scores = append(scores, match(base.Add(time.Hour), false)...)

	got := BuildMatchData(scores, nil, time.Time{})

	if len(got) != 2 {
		t.Fatalf("afterゼロ値なら全試合を返すはず: want 2 matches, got %d", len(got))
	}
	// datetime昇順で返ること
	if got[0].Date >= got[1].Date {
		t.Errorf("試合はdatetime昇順で返るはず: got[0]=%q got[1]=%q", got[0].Date, got[1].Date)
	}
}

func TestBuildMatchData_IncompleteMatchDropped(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	// 3人しかいない試合はスキップされる（4人揃わないと集計できない）
	scores := match(base, true)[:3]

	got := BuildMatchData(scores, nil, time.Time{})

	if len(got) != 0 {
		t.Fatalf("4人揃わない試合はスキップされるはず: want 0, got %d", len(got))
	}
}

// TestBuildMatchData_SameMinuteTwoMatches は#358の核リグレッション。
// 同一分に2試合あっても、MatchIDが異なれば両方とも集計に含まれるべき（欠落ゼロ）。
func TestBuildMatchData_SameMinuteTwoMatches(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	var scores model.DatedScores
	scores = append(scores, matchWithID(base, true, "match-a")...)
	scores = append(scores, matchWithID(base, false, "match-b")...)

	got := BuildMatchData(scores, nil, time.Time{})

	if len(got) != 2 {
		t.Fatalf("同一分でもMatchIDが異なれば両試合とも集計に含まれるはず(#358): want 2 matches, got %d", len(got))
	}
	if got[0].MatchID == got[1].MatchID {
		t.Errorf("2試合のMatchIDは異なるはず: got[0]=%q got[1]=%q", got[0].MatchID, got[1].MatchID)
	}
}
