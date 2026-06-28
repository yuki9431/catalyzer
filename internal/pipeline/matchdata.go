package pipeline

import (
	"fmt"
	"sort"
	"time"

	fs "github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/mslist"
)

// MatchData はフロントエンド向けの試合データ（プレイヤー視点）
type MatchData struct {
	Date            string  `json:"date"`
	MS              string  `json:"ms"`
	MSCost          int     `json:"ms_cost,omitempty"`
	PartnerMS       string  `json:"partner_ms"`
	PartnerCost     int     `json:"partner_cost,omitempty"`
	Opponent1MS     string  `json:"opponent1_ms"`
	Opponent1Cost   int     `json:"opponent1_cost,omitempty"`
	Opponent2MS     string  `json:"opponent2_ms"`
	Opponent2Cost   int     `json:"opponent2_cost,omitempty"`
	Win             bool    `json:"win"`
	Score           int     `json:"score"`
	Kills           int     `json:"kills"`
	Deaths          int     `json:"deaths"`
	DmgGiven        int     `json:"dmg_given"`
	DmgTaken        int     `json:"dmg_taken"`
	ExDmg           int     `json:"ex_dmg"`
	PartnerName     string  `json:"partner_name"`
	PartnerScore    int     `json:"partner_score"`
	PartnerKills    int     `json:"partner_kills"`
	PartnerDeaths   int     `json:"partner_deaths"`
	PartnerDmgGiven int     `json:"partner_dmg_given"`
	PartnerDmgTaken int     `json:"partner_dmg_taken"`
	PartnerExDmg    int     `json:"partner_ex_dmg"`
	Bursts          int     `json:"bursts"`
	PartnerBursts   int     `json:"partner_bursts"`
	GameEndSec      float64 `json:"game_end_sec,omitempty"`
}

// countBursts はタイムラインから指定グループの覚醒回数を数える。
func countBursts(timeline *model.MatchTimeline, group string) int {
	if timeline == nil {
		return 0
	}
	count := 0
	for _, e := range timeline.Events {
		if e.Group == group && (e.ClassName == "exbst-f" || e.ClassName == "exbst-s" || e.ClassName == "exbst-e") {
			count++
		}
	}
	return count
}

// BuildMatchData はDatedScoresをフロントエンド向けの試合データに変換する。
// costsMap は画像URL→コストのマッピング。afterが非ゼロの場合、その日時より後の試合のみ返す。
func BuildMatchData(ds model.DatedScores, costsMap map[string]int, after time.Time) []MatchData {
	groups := make(map[string][]model.DatedScore)
	for _, d := range ds {
		if !after.IsZero() && !d.Datetime.After(after) {
			continue
		}
		key := d.Datetime.Format(model.MatchKeyFormat)
		groups[key] = append(groups[key], d)
	}

	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	matches := make([]MatchData, 0, len(keys))
	for _, key := range keys {
		entries := groups[key]
		if len(entries) != 4 {
			continue
		}
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].PlayerNo < entries[j].PlayerNo
		})

		me := entries[0].PlayerScore      // PlayerNo 1
		partner := entries[1].PlayerScore // PlayerNo 2
		opp1 := entries[2].PlayerScore    // PlayerNo 3
		opp2 := entries[3].PlayerScore    // PlayerNo 4

		var gameEndSec float64
		var timeline *model.MatchTimeline
		for _, e := range entries {
			if e.MatchTimeline != nil {
				gameEndSec = e.MatchTimeline.GameEndSec
				timeline = e.MatchTimeline
				break
			}
		}

		matches = append(matches, MatchData{
			Date:            entries[0].Datetime.Format("2006-01-02 15:04"),
			MS:              me.MsName,
			MSCost:          costsMap[mslist.StripQuery(me.MsImageURL)],
			PartnerMS:       partner.MsName,
			PartnerCost:     costsMap[mslist.StripQuery(partner.MsImageURL)],
			Opponent1MS:     opp1.MsName,
			Opponent1Cost:   costsMap[mslist.StripQuery(opp1.MsImageURL)],
			Opponent2MS:     opp2.MsName,
			Opponent2Cost:   costsMap[mslist.StripQuery(opp2.MsImageURL)],
			Win:             me.Win,
			Score:           me.Score,
			Kills:           me.Kills,
			Deaths:          me.Deaths,
			DmgGiven:        me.GiveDamage,
			DmgTaken:        me.ReceiveDamage,
			ExDmg:           me.ExDamage,
			PartnerName:     partner.Name,
			PartnerScore:    partner.Score,
			PartnerKills:    partner.Kills,
			PartnerDeaths:   partner.Deaths,
			PartnerDmgGiven: partner.GiveDamage,
			PartnerDmgTaken: partner.ReceiveDamage,
			PartnerExDmg:    partner.ExDamage,
			Bursts:          countBursts(timeline, "team1-1"),
			PartnerBursts:   countBursts(timeline, "team1-2"),
			GameEndSec:      gameEndSec,
		})
	}

	return matches
}

// GetMatchData はFirestoreからscoresを読み取り、フロントエンド向けの試合データを返す。
func GetMatchData(userKey string, after time.Time) ([]MatchData, error) {
	scores, err := fs.LoadScores(userKey)
	if err != nil {
		return nil, fmt.Errorf("load scores: %w", err)
	}

	msList, err := mslist.LoadMSList(DefaultMSListPath)
	if err != nil {
		msList = nil
	}
	msMap := mslist.BuildMSNameMap(msList)
	mslist.FillMsNames(scores, msMap)

	costsMap := mslist.BuildMSCostMap(msList)
	return BuildMatchData(scores, costsMap, after), nil
}
