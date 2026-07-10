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

func TestBuildMatchData_PopulatesPlayerNames(t *testing.T) {
	base := time.Date(2026, 7, 4, 21, 30, 0, 0, time.UTC)

	got := BuildMatchData(match(base, true), nil, time.Time{})
	if len(got) != 1 {
		t.Fatalf("want 1 match, got %d", len(got))
	}
	// match ヘルパーは PlayerNo 1..4 に 'a'..'d' を割り当てる。
	// 相方=PlayerNo2='b'、敵1=PlayerNo3='c'、敵2=PlayerNo4='d'。
	if got[0].PartnerName != "b" {
		t.Errorf("PartnerName: want %q, got %q", "b", got[0].PartnerName)
	}
	if got[0].Opponent1Name != "c" {
		t.Errorf("Opponent1Name: want %q, got %q", "c", got[0].Opponent1Name)
	}
	if got[0].Opponent2Name != "d" {
		t.Errorf("Opponent2Name: want %q, got %q", "d", got[0].Opponent2Name)
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
