package firestore

import (
	"context"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/yuki9431/exvs-analyzer/internal/model"
)

// actionMapping はHTMLクラス名からFirestoreのaction値へのマッピング
var actionMapping = map[string]string{
	"ex":       "ex_standby",
	"exbst-f":  "ex_f_using",
	"exbst-s":  "ex_s_using",
	"exbst-e":  "ex_e_using",
	"ov":       "ol_standby",
	"exbst-ov": "ol_using",
}

// timelineDoc はFirestoreに保存するtimelinesドキュメントの構造体
type timelineDoc struct {
	Datetime   time.Time              `firestore:"datetime"`
	GameEndSec float64                `firestore:"game_end_sec"`
	Players    map[string][]actionDoc `firestore:"players"`
}

// actionDoc はタイムライン内の各アクション
type actionDoc struct {
	Action        string  `firestore:"action"`
	ActionStartSec float64 `firestore:"action_start_sec"`
	ActionEndSec  float64 `firestore:"action_end_sec"`
}

// SaveTimelines はDatedScoresからタイムラインを抽出し、Firestoreに書き込む。
func SaveTimelines(userKey string, scores model.DatedScores) {
	c := getClient()
	if c == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := userDoc(userKey)
	timelinesCol := userRef.Collection("timelines")

	const batchLimit = 500
	var docs []struct {
		id  string
		doc timelineDoc
	}

	for _, s := range scores {
		if s.MatchTimeline == nil {
			continue
		}
		docID := s.Datetime.Format("2006-01-02T1504")
		doc := toTimelineDoc(s.Datetime, s.MatchTimeline)
		docs = append(docs, struct {
			id  string
			doc timelineDoc
		}{docID, doc})
	}

	if len(docs) == 0 {
		return
	}

	for i := 0; i < len(docs); i += batchLimit {
		end := i + batchLimit
		if end > len(docs) {
			end = len(docs)
		}

		batch := c.Batch()
		for _, d := range docs[i:end] {
			ref := timelinesCol.Doc(d.id)
			batch.Set(ref, d.doc)
		}

		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("[WARN] Firestore: failed to save timelines batch (%d-%d): %v", i, end, err)
			return
		}
	}

	log.Printf("[INFO] Firestore: saved %d timelines for user %s", len(docs), userKey)
}

// toTimelineDoc はMatchTimelineをFirestoreドキュメント用の構造体に変換する。
// Events内のgroupをプレイヤー番号(1-4)に変換し、playersマップにまとめる。
func toTimelineDoc(datetime time.Time, mt *model.MatchTimeline) timelineDoc {
	players := make(map[string][]actionDoc)

	for _, e := range mt.Events {
		playerNo := groupToPlayerNo(e.Group)
		if playerNo == "" {
			continue
		}

		action := convertAction(e)
		players[playerNo] = append(players[playerNo], action)
	}

	return timelineDoc{
		Datetime:   datetime,
		GameEndSec: mt.GameEndSec,
		Players:    players,
	}
}

// groupToPlayerNo はvis.jsのgroup名をプレイヤー番号に変換する。
// "team1-1" → "1", "team1-2" → "2", "team2-1" → "3", "team2-2" → "4"
func groupToPlayerNo(group string) string {
	// "com" プレイヤーは保存しない
	if !strings.HasPrefix(group, "team") {
		return ""
	}

	switch group {
	case "team1-1":
		return "1"
	case "team1-2":
		return "2"
	case "team2-1":
		return "3"
	case "team2-2":
		return "4"
	default:
		// "team1-1" 以外のフォーマットの場合、数値解析を試みる
		parts := strings.Split(strings.TrimPrefix(group, "team"), "-")
		if len(parts) != 2 {
			return ""
		}
		teamNo, err1 := strconv.Atoi(parts[0])
		memberNo, err2 := strconv.Atoi(parts[1])
		if err1 != nil || err2 != nil {
			return ""
		}
		return strconv.Itoa((teamNo-1)*2 + memberNo)
	}
}

// convertAction はMatchEventをactionDocに変換する。
func convertAction(e model.MatchEvent) actionDoc {
	action := mapActionName(e.ClassName, e.IsPoint)
	return actionDoc{
		Action:         action,
		ActionStartSec: e.StartSec,
		ActionEndSec:   e.EndSec,
	}
}

// mapActionName はHTMLクラス名とisPointフラグからaction名を決定する。
func mapActionName(className string, isPoint bool) string {
	if isPoint {
		return "death"
	}
	if mapped, ok := actionMapping[className]; ok {
		return mapped
	}
	// 未知のクラス名はそのまま返す
	return className
}
