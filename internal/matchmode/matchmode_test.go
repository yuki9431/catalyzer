package matchmode

import (
	"testing"

	"github.com/yuki9431/catalyzer/internal/model"
)

func TestInfer(t *testing.T) {
	in := New([]model.TagPartner{
		{PlayerName: "固定相方", TeamName: "煙草休憩"},
		{PlayerName: "無名相方", TeamName: "ＮＯ＿ＮＡＭＥ＿ＴＡＧ"},
	})
	tests := []struct {
		name, partner, team, want string
	}{
		{"タッグ登録済みの相方は固定", "固定相方", "", model.MatchModeFixed},
		{"名前なしタッグの相方も固定", "無名相方", "ＮＯ＿ＮＡＭＥ＿ＴＡＧ", model.MatchModeFixed},
		{"改名した相方は名前付きのタッグ名で固定", "改名後", "煙草休憩", model.MatchModeFixed},
		{"未登録の相方はシャッフル", "野良", "", model.MatchModeShuffle},
		{"名前なしタッグ名は照合しない", "野良", "ＮＯ＿ＮＡＭＥ＿ＴＡＧ", model.MatchModeShuffle},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := in.Infer(tt.partner, tt.team); got != tt.want {
				t.Errorf("Infer(%q, %q) = %q, want %q", tt.partner, tt.team, got, tt.want)
			}
		})
	}
}

func TestInfer_NoTagPartners(t *testing.T) {
	if got := New(nil).Infer("誰か", "煙草休憩"); got != model.MatchModeShuffle {
		t.Errorf("タッグ相方が無ければシャッフル: got %q", got)
	}
}
