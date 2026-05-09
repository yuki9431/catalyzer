package gradelist

import (
	"encoding/json"
	"log"
	"net/url"
	"os"

	"github.com/yuki9431/exvs-analyzer/internal/model"
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

// CheckUnknownGrades はgrade_list.jsonに未登録のグレード画像URLをログに出力する
func CheckUnknownGrades(ds model.DatedScores, gradeMap map[string]GradeInfo) {
	unknown := make(map[string]int)
	for _, d := range ds {
		if d.PlayerScore.ShuffleGradeURL != "" {
			if _, ok := gradeMap[stripQuery(d.PlayerScore.ShuffleGradeURL)]; !ok {
				unknown[d.PlayerScore.ShuffleGradeURL]++
			}
		}
		if d.PlayerScore.TeamGradeURL != "" {
			if _, ok := gradeMap[stripQuery(d.PlayerScore.TeamGradeURL)]; !ok {
				unknown[d.PlayerScore.TeamGradeURL]++
			}
		}
	}
	for u, count := range unknown {
		log.Printf("[ALERT] Unknown grade (appeared %d times): %s", count, u)
	}
	if len(unknown) > 0 {
		log.Printf("[ALERT] %d unknown grade URLs found. Add them to data/grade_list.json.", len(unknown))
	}
}
