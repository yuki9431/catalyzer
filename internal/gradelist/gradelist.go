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
