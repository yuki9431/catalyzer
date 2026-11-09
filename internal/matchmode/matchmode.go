// Package matchmode は対戦形式を記録する前に取り込んだ試合の形式を推定する。
package matchmode

import "github.com/yuki9431/catalyzer/internal/model"

// Inferrer はユーザーのタッグ相方から試合の対戦形式を推定する
type Inferrer struct {
	players map[string]bool
	teams   map[string]bool
}

// New はタッグ相方の一覧から Inferrer を作る
func New(tags []model.TagPartner) *Inferrer {
	in := &Inferrer{players: map[string]bool{}, teams: map[string]bool{}}
	for _, t := range tags {
		in.players[t.PlayerName] = true
		if namedTeam(t.TeamName) {
			in.teams[t.TeamName] = true
		}
	}
	return in
}

// Infer は相方がタッグ登録済み(名前付きタッグ名の一致を含む)なら固定、それ以外はシャッフルを返す
func (in *Inferrer) Infer(partnerName, teamName string) string {
	if in.players[partnerName] || (namedTeam(teamName) && in.teams[teamName]) {
		return model.MatchModeFixed
	}
	return model.MatchModeShuffle
}

// namedTeam は名前の付いたタッグか。公式は名前なしのタッグを NO_NAME_TAG(全角)で表示する
func namedTeam(name string) bool {
	return name != "" && name != "NO_NAME_TAG" && name != "ＮＯ＿ＮＡＭＥ＿ＴＡＧ"
}
