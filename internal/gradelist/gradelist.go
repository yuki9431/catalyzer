// Package gradelist handles grade list loading and unknown grade detection.
package gradelist

import (
	"encoding/json"
	"log"
	"net/url"
	"os"

	"github.com/yuki9431/catalyzer/internal/model"
)

// GradeInfo は階級画像URLと階級名のマッピング
type GradeInfo struct {
	ImageURL string `json:"image_url"`
	Class    string `json:"class"` // Pilot, Valiant, Ace, Extreme
	Grade    int    `json:"grade"` // 1-10 (0 = ∞)
}

func stripQuery(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	u.RawQuery = ""
	return u.String()
}

// LoadGradeList はJSONファイルからグレードリストを読み込む
func LoadGradeList(path string) ([]GradeInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var list []GradeInfo
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	return list, nil
}

// BuildGradeMap はグレードリストからURL→GradeInfoのマップを構築する
func BuildGradeMap(list []GradeInfo) map[string]GradeInfo {
	m := make(map[string]GradeInfo, len(list))
	for _, g := range list {
		m[stripQuery(g.ImageURL)] = g
	}
	return m
}

var classBase = map[string]int{"Pilot": 0, "Valiant": 10, "Ace": 20, "Extreme": 30}

// rank は階級の通し番号を返す(Pilot 10=1 … Extreme 1=40、Extreme ∞=41)。段位は10が下で1が上。不正な値は0
func (g GradeInfo) rank() int {
	base, ok := classBase[g.Class]
	if !ok || g.Grade < 0 || g.Grade > 10 {
		return 0
	}
	if g.Grade == 0 {
		if g.Class == "Extreme" {
			return 41
		}
		return 0
	}
	return base + 11 - g.Grade
}

// BuildRankMap はグレードリストからURL→通し番号(Pilot 10=1 … Extreme 1=40、∞=41)のマップを構築する
func BuildRankMap(list []GradeInfo) map[string]int {
	m := make(map[string]int, len(list))
	for _, g := range list {
		if r := g.rank(); r > 0 {
			m[stripQuery(g.ImageURL)] = r
		}
	}
	return m
}

// RankOf は階級画像URLの通し番号を返す。空・未登録は0
func RankOf(ranks map[string]int, rawURL string) int {
	if rawURL == "" {
		return 0
	}
	return ranks[stripQuery(rawURL)]
}

// FindUnknownGrades はgrade_list.jsonに未登録のグレード画像URLを返す。
// キーはクエリパラメータ除去済みのURL、値は出現回数。
func FindUnknownGrades(ds model.DatedScores, gradeMap map[string]GradeInfo) map[string]int {
	unknown := make(map[string]int)
	for _, d := range ds {
		if u := d.PlayerScore.ShuffleGradeURL; u != "" {
			stripped := stripQuery(u)
			if _, ok := gradeMap[stripped]; !ok {
				unknown[stripped]++
			}
		}
		if u := d.PlayerScore.TeamGradeURL; u != "" {
			stripped := stripQuery(u)
			if _, ok := gradeMap[stripped]; !ok {
				unknown[stripped]++
			}
		}
	}
	return unknown
}

// CheckUnknownGrades はgrade_list.jsonに未登録のグレード画像URLをログに出力する
func CheckUnknownGrades(ds model.DatedScores, gradeMap map[string]GradeInfo) {
	unknown := FindUnknownGrades(ds, gradeMap)
	for u, count := range unknown {
		log.Printf("[ALERT] Unknown grade (appeared %d times): %s", count, u)
	}
	if len(unknown) > 0 {
		log.Printf("[ALERT] %d unknown grade URLs found. Add them to data/grade_list.json.", len(unknown))
	}
}
