package main

import (
	"context"
	"flag"
	"log"
	"os"
	"sort"
	"strconv"
	"time"

	"cloud.google.com/go/firestore"
)

type playerDoc struct {
	PlayerNo        int        `firestore:"player_no"`
	City            string     `firestore:"city"`
	Name            string     `firestore:"name"`
	Win             bool       `firestore:"win"`
	MsName          string     `firestore:"ms_name"`
	MsImageURL      string     `firestore:"ms_image_url"`
	Score           int        `firestore:"score"`
	Kills           int        `firestore:"kills"`
	Deaths          int        `firestore:"deaths"`
	GiveDamage      int        `firestore:"give_damage"`
	ReceiveDamage   int        `firestore:"receive_damage"`
	ExDamage        int        `firestore:"ex_damage"`
	MsProficiency   string     `firestore:"ms_proficiency"`
	TeamName        string     `firestore:"team_name"`
	PlayerLevelURL  string     `firestore:"player_level_url"`
	RankBadgeURL    string     `firestore:"rank_badge_url"`
	ProfileURL      string     `firestore:"profile_url"`
	ShuffleGradeURL string     `firestore:"shuffle_grade_url"`
	TeamGradeURL    string     `firestore:"team_grade_url"`
	ScoreRanking    int        `firestore:"score_ranking"`
	ArcadeName      string     `firestore:"arcade_name"`
	Actions         []actionDoc `firestore:"actions"`
}

type actionDoc struct {
	Action         string  `firestore:"action"`
	ActionStartSec float64 `firestore:"action_start_sec"`
	ActionEndSec   float64 `firestore:"action_end_sec"`
}

type matchDoc struct {
	Datetime   time.Time   `firestore:"datetime"`
	GameEndSec float64     `firestore:"game_end_sec"`
	Players    []playerDoc `firestore:"players"`
}

func main() {
	execute := flag.Bool("execute", false, "実際にマイグレーションを実行する（省略時はドライラン）")
	deleteOld := flag.Bool("delete-old", false, "マイグレーション後に旧コレクションを削除する（-execute と併用）")
	flag.Parse()

	if *deleteOld && !*execute {
		log.Fatal("--delete-old requires --execute")
	}

	projectID := os.Getenv("GCP_PROJECT")
	dbID := os.Getenv("FIRESTORE_DATABASE")
	if projectID == "" || dbID == "" {
		log.Fatal("GCP_PROJECT and FIRESTORE_DATABASE are required")
	}

	ctx := context.Background()
	client, err := firestore.NewClientWithDatabase(ctx, projectID, dbID)
	if err != nil {
		log.Fatalf("Failed to init Firestore: %v", err)
	}
	defer client.Close()

	// 全ユーザーを取得
	userDocs, err := client.Collection("users").Documents(ctx).GetAll()
	if err != nil {
		log.Fatalf("Failed to list users: %v", err)
	}
	log.Printf("[INFO] Found %d users", len(userDocs))

	var totalScores, totalTimelines, totalMatches, totalSkipped int

	for _, userDoc := range userDocs {
		userKey := userDoc.Ref.ID
		log.Printf("[INFO] Processing user: %s", userKey)

		scores, timelines, matches, skipped := migrateUser(ctx, client, userKey, *execute, *deleteOld)
		totalScores += scores
		totalTimelines += timelines
		totalMatches += matches
		totalSkipped += skipped
	}

	log.Printf("[SUMMARY] scores: %d, timelines: %d → matches: %d (skipped: %d)",
		totalScores, totalTimelines, totalMatches, totalSkipped)
	if !*execute {
		log.Printf("[DRY RUN] No changes made. Add -execute to migrate.")
	}
}

func migrateUser(ctx context.Context, client *firestore.Client, userKey string, execute, deleteOld bool) (int, int, int, int) {
	userRef := client.Collection("users").Doc(userKey)

	// scores を読み取り
	scoreDocs, err := userRef.Collection("scores").OrderBy("datetime", firestore.Asc).Documents(ctx).GetAll()
	if err != nil {
		log.Printf("[ERROR] User %s: failed to load scores: %v", userKey, err)
		return 0, 0, 0, 0
	}

	// timelines を読み取り
	timelineDocs, err := userRef.Collection("timelines").Documents(ctx).GetAll()
	if err != nil {
		log.Printf("[WARN] User %s: failed to load timelines: %v", userKey, err)
	}

	log.Printf("  scores: %d docs, timelines: %d docs", len(scoreDocs), len(timelineDocs))

	// timelines を datetime でインデックス化
	type timelineData struct {
		GameEndSec float64
		Players    map[string][]actionDoc
	}
	timelineMap := make(map[string]timelineData)
	for _, doc := range timelineDocs {
		data := doc.Data()
		dt, ok := data["datetime"].(time.Time)
		if !ok {
			continue
		}
		key := dt.Format("2006-01-02T1504")
		gameEndSec, _ := toFloat64(data["game_end_sec"])
		players := make(map[string][]actionDoc)
		if p, ok := data["players"].(map[string]interface{}); ok {
			for playerNo, actions := range p {
				if actionList, ok := actions.([]interface{}); ok {
					for _, a := range actionList {
						if am, ok := a.(map[string]interface{}); ok {
							action, _ := am["action"].(string)
							startSec, _ := toFloat64(am["action_start_sec"])
							endSec, _ := toFloat64(am["action_end_sec"])
							players[playerNo] = append(players[playerNo], actionDoc{
								Action:         action,
								ActionStartSec: startSec,
								ActionEndSec:   endSec,
							})
						}
					}
				}
			}
		}
		timelineMap[key] = timelineData{GameEndSec: gameEndSec, Players: players}
	}

	// scores を datetime でグルーピング
	type scoreEntry struct {
		Datetime  time.Time
		PlayerNo  int
		Data      map[string]interface{}
	}
	groups := make(map[string][]scoreEntry)
	for _, doc := range scoreDocs {
		data := doc.Data()
		dt, ok := data["datetime"].(time.Time)
		if !ok {
			continue
		}
		playerNo, _ := toInt(data["player_no"])
		key := dt.Format("2006-01-02T1504")
		groups[key] = append(groups[key], scoreEntry{
			Datetime: dt,
			PlayerNo: playerNo,
			Data:     data,
		})
	}

	// matches ドキュメントを構築
	matchesCol := userRef.Collection("matches")
	var matchDocs []struct {
		id  string
		doc matchDoc
	}
	var skipped int

	for key, entries := range groups {
		if len(entries) != 4 {
			log.Printf("  [WARN] %s: expected 4 players, got %d (skipped)", key, len(entries))
			skipped++
			continue
		}

		sort.Slice(entries, func(i, j int) bool {
			return entries[i].PlayerNo < entries[j].PlayerNo
		})

		tl := timelineMap[key]
		players := make([]playerDoc, 4)
		for i, e := range entries {
			actions := buildActions(tl.Players, e.PlayerNo)
			players[i] = playerDoc{
				PlayerNo:        e.PlayerNo,
				City:            toString(e.Data["city"]),
				Name:            toString(e.Data["name"]),
				Win:             toBool(e.Data["win"]),
				MsName:          toString(e.Data["ms_name"]),
				MsImageURL:      toString(e.Data["ms_image_url"]),
				Score:           toIntVal(e.Data["score"]),
				Kills:           toIntVal(e.Data["kills"]),
				Deaths:          toIntVal(e.Data["deaths"]),
				GiveDamage:      toIntVal(e.Data["give_damage"]),
				ReceiveDamage:   toIntVal(e.Data["receive_damage"]),
				ExDamage:        toIntVal(e.Data["ex_damage"]),
				MsProficiency:   toString(e.Data["ms_proficiency"]),
				TeamName:        toString(e.Data["team_name"]),
				PlayerLevelURL:  toString(e.Data["player_level_url"]),
				RankBadgeURL:    toString(e.Data["rank_badge_url"]),
				ProfileURL:      toString(e.Data["profile_url"]),
				ShuffleGradeURL: toString(e.Data["shuffle_grade_url"]),
				TeamGradeURL:    toString(e.Data["team_grade_url"]),
				ScoreRanking:    toIntVal(e.Data["score_ranking"]),
				ArcadeName:      toString(e.Data["arcade_name"]),
				Actions:         actions,
			}
		}

		matchDocs = append(matchDocs, struct {
			id  string
			doc matchDoc
		}{
			id: key,
			doc: matchDoc{
				Datetime:   entries[0].Datetime,
				GameEndSec: tl.GameEndSec,
				Players:    players,
			},
		})
	}

	log.Printf("  matches to create: %d, skipped: %d", len(matchDocs), skipped)

	// 検証
	expectedMatches := len(scoreDocs) / 4
	if len(matchDocs) != expectedMatches {
		log.Printf("  [WARN] Expected %d matches (scores %d / 4), got %d (diff due to skipped incomplete data)",
			expectedMatches, len(scoreDocs), len(matchDocs))
	}

	if !execute {
		return len(scoreDocs), len(timelineDocs), len(matchDocs), skipped
	}

	// matches を書き込み
	const batchLimit = 500
	for i := 0; i < len(matchDocs); i += batchLimit {
		end := i + batchLimit
		if end > len(matchDocs) {
			end = len(matchDocs)
		}
		batch := client.Batch()
		for _, m := range matchDocs[i:end] {
			batch.Set(matchesCol.Doc(m.id), m.doc)
		}
		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("  [ERROR] Failed to write matches batch (%d-%d): %v", i, end, err)
			return len(scoreDocs), len(timelineDocs), 0, skipped
		}
	}
	log.Printf("  [OK] Wrote %d matches", len(matchDocs))

	// 旧コレクション削除
	if deleteOld {
		deleted := deleteCollection(ctx, client, scoreDocs)
		log.Printf("  [OK] Deleted %d scores documents", deleted)
		deleted = deleteCollection(ctx, client, timelineDocs)
		log.Printf("  [OK] Deleted %d timelines documents", deleted)
	}

	return len(scoreDocs), len(timelineDocs), len(matchDocs), skipped
}

func deleteCollection(ctx context.Context, client *firestore.Client, docs []*firestore.DocumentSnapshot) int {
	const batchLimit = 500
	count := 0
	for i := 0; i < len(docs); i += batchLimit {
		end := i + batchLimit
		if end > len(docs) {
			end = len(docs)
		}
		batch := client.Batch()
		for _, doc := range docs[i:end] {
			batch.Delete(doc.Ref)
		}
		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("  [ERROR] Failed to delete batch: %v", err)
			return count
		}
		count += end - i
	}
	return count
}

func buildActions(timelinePlayers map[string][]actionDoc, playerNo int) []actionDoc {
	if timelinePlayers == nil {
		return []actionDoc{}
	}
	key := strconv.Itoa(playerNo)
	actions := timelinePlayers[key]
	if actions == nil {
		return []actionDoc{}
	}
	return actions
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func toBool(v interface{}) bool {
	if v == nil {
		return false
	}
	b, _ := v.(bool)
	return b
}

func toInt(v interface{}) (int, bool) {
	if v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case int:
		return n, true
	}
	return 0, false
}

func toIntVal(v interface{}) int {
	n, _ := toInt(v)
	return n
}

func toFloat64(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case int64:
		return float64(n), true
	}
	return 0, false
}

func init() {
	log.SetFlags(log.Ltime)
}
