package firestore

import (
	"context"
	"fmt"
	"log"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/yuki9431/exvs-analyzer/internal/model"
)

// scoreDoc はFirestoreに保存するscoresドキュメントの構造体
type scoreDoc struct {
	Datetime       time.Time `firestore:"datetime"`
	PlayerNo       int       `firestore:"player_no"`
	City           string    `firestore:"city"`
	Name           string    `firestore:"name"`
	Win            bool      `firestore:"win"`
	MsName         string    `firestore:"ms_name"`
	MsImageURL     string    `firestore:"ms_image_url"`
	Score          int       `firestore:"score"`
	Kills          int       `firestore:"kills"`
	Deaths         int       `firestore:"deaths"`
	GiveDamage     int       `firestore:"give_damage"`
	ReceiveDamage  int       `firestore:"receive_damage"`
	ExDamage       int       `firestore:"ex_damage"`
	MsProficiency  string    `firestore:"ms_proficiency"`
	TeamName       string    `firestore:"team_name"`
	PlayerLevelURL string    `firestore:"player_level_url"`
	RankBadgeURL   string    `firestore:"rank_badge_url"`
	ProfileURL     string    `firestore:"profile_url"`
	ShuffleGradeURL string   `firestore:"shuffle_grade_url"`
	TeamGradeURL   string    `firestore:"team_grade_url"`
	ScoreRanking   int       `firestore:"score_ranking"`
	ArcadeName     string    `firestore:"arcade_name"`
}

// SaveScores はDatedScoresをFirestoreのscoresサブコレクションに書き込む。
func SaveScores(userKey string, scores model.DatedScores) {
	c := getClient()
	if c == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	// Firestoreのバッチは最大500操作
	const batchLimit = 500
	userRef := userDoc(userKey)

	// ユーザードキュメントの作成（存在しなければ）
	_, err := userRef.Set(ctx, map[string]interface{}{
		"created_at": firestore.ServerTimestamp,
	}, firestore.MergeAll)
	if err != nil {
		log.Printf("[WARN] Firestore: failed to create user doc: %v", err)
		return
	}

	scoresCol := userRef.Collection("scores")

	for i := 0; i < len(scores); i += batchLimit {
		end := i + batchLimit
		if end > len(scores) {
			end = len(scores)
		}
		chunk := scores[i:end]

		batch := c.Batch()
		for _, s := range chunk {
			docID := scoreDocID(s)
			doc := scoresCol.Doc(docID)
			batch.Set(doc, toScoreDoc(s))
		}

		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("[WARN] Firestore: failed to save scores batch (%d-%d): %v", i, end, err)
			return
		}
	}

	log.Printf("[INFO] Firestore: saved %d scores for user %s", len(scores), userKey)
}

// scoreDocID はscoresドキュメントのIDを生成する（{datetime}_{playerNo}）
func scoreDocID(s model.DatedScore) string {
	return fmt.Sprintf("%s_%d", s.Datetime.Format("2006-01-02T1504"), s.PlayerNo)
}

// toScoreDoc はDatedScoreをFirestoreドキュメント用の構造体に変換する
func toScoreDoc(s model.DatedScore) scoreDoc {
	return scoreDoc{
		Datetime:        s.Datetime,
		PlayerNo:        s.PlayerNo,
		City:            s.PlayerScore.City,
		Name:            s.PlayerScore.Name,
		Win:             s.PlayerScore.Win,
		MsName:          s.PlayerScore.MsName,
		MsImageURL:      s.PlayerScore.MsImageURL,
		Score:           s.PlayerScore.Score,
		Kills:           s.PlayerScore.Kills,
		Deaths:          s.PlayerScore.Deaths,
		GiveDamage:      s.PlayerScore.GiveDamage,
		ReceiveDamage:   s.PlayerScore.ReceiveDamage,
		ExDamage:        s.PlayerScore.ExDamage,
		MsProficiency:   s.PlayerScore.MsProficiency,
		TeamName:        s.PlayerScore.TeamName,
		PlayerLevelURL:  s.PlayerScore.PlayerLevelURL,
		RankBadgeURL:    s.PlayerScore.RankBadgeURL,
		ProfileURL:      s.PlayerScore.ProfileURL,
		ShuffleGradeURL: s.PlayerScore.ShuffleGradeURL,
		TeamGradeURL:    s.PlayerScore.TeamGradeURL,
		ScoreRanking:    s.PlayerScore.ScoreRanking,
		ArcadeName:      s.PlayerScore.ArcadeName,
	}
}
