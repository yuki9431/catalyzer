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
	userRef := c.Collection("users").Doc(userKey)

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
			log.Printf("[WARN] Firestore: failed to save scores batch (%d-%d of %d, partial write): %v", i, end, len(scores), err)
			return
		}
	}

	log.Printf("[INFO] Firestore: saved %d scores for user %s", len(scores), userKey)
}

// LoadScores はFirestoreからユーザーの全scoresを読み取り、datetime昇順で返す。
func LoadScores(userKey string) (model.DatedScores, error) {
	c := getClient()
	if c == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("scores").OrderBy("datetime", firestore.Asc).Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("query scores: %w", err)
	}

	scores := make(model.DatedScores, 0, len(docs))
	for _, doc := range docs {
		var sd scoreDoc
		if err := doc.DataTo(&sd); err != nil {
			log.Printf("[WARN] Firestore: failed to parse score doc %s: %v", doc.Ref.ID, err)
			continue
		}
		scores = append(scores, fromScoreDoc(sd))
	}

	return scores, nil
}

// GetLatestDatetime はFirestoreからユーザーの最新試合日時を取得する。
// データがない場合はゼロ値のtimeを返す。
func GetLatestDatetime(userKey string) (time.Time, error) {
	c := getClient()
	if c == nil {
		return time.Time{}, fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("scores").OrderBy("datetime", firestore.Desc).Limit(1).Documents(ctx).GetAll()
	if err != nil {
		return time.Time{}, fmt.Errorf("query latest datetime: %w", err)
	}
	if len(docs) == 0 {
		return time.Time{}, nil
	}

	var sd scoreDoc
	if err := docs[0].DataTo(&sd); err != nil {
		return time.Time{}, fmt.Errorf("parse latest score: %w", err)
	}
	return sd.Datetime, nil
}

// NeedsBackfill は直近30日以内のscoresにms_proficiencyが空のドキュメントがあるか判定する。
func NeedsBackfill(userKey string) bool {
	c := getClient()
	if c == nil {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	cutoff := time.Now().AddDate(0, 0, -30)
	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("scores").Where("datetime", ">=", cutoff).Documents(ctx).GetAll()
	if err != nil {
		log.Printf("[WARN] Firestore: failed to check backfill: %v", err)
		return false
	}

	for _, doc := range docs {
		var sd scoreDoc
		if err := doc.DataTo(&sd); err != nil {
			continue
		}
		if sd.MsProficiency == "" {
			return true
		}
	}
	return false
}

// BackfillDates は直近30日以内でms_proficiencyが空のscoresの日付セットを返す。
// 日付は "2006/01/02" 形式（スクレイパーのdailyLink.dateと同じ形式）。
func BackfillDates(userKey string) map[string]bool {
	dates := make(map[string]bool)

	c := getClient()
	if c == nil {
		return dates
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	cutoff := time.Now().AddDate(0, 0, -30)
	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("scores").Where("datetime", ">=", cutoff).Documents(ctx).GetAll()
	if err != nil {
		log.Printf("[WARN] Firestore: failed to get backfill dates: %v", err)
		return dates
	}

	for _, doc := range docs {
		var sd scoreDoc
		if err := doc.DataTo(&sd); err != nil {
			continue
		}
		if sd.MsProficiency == "" {
			dates[sd.Datetime.Format("2006/01/02")] = true
		}
	}
	return dates
}

// fromScoreDoc はFirestoreドキュメントをDatedScoreに変換する。
func fromScoreDoc(sd scoreDoc) model.DatedScore {
	return model.DatedScore{
		PlayerNo: sd.PlayerNo,
		Datetime: sd.Datetime,
		PlayerScore: model.PlayerScore{
			City:            sd.City,
			Name:            sd.Name,
			Win:             sd.Win,
			MsName:          sd.MsName,
			MsImageURL:      sd.MsImageURL,
			Score:           sd.Score,
			Kills:           sd.Kills,
			Deaths:          sd.Deaths,
			GiveDamage:      sd.GiveDamage,
			ReceiveDamage:   sd.ReceiveDamage,
			ExDamage:        sd.ExDamage,
			MsProficiency:   sd.MsProficiency,
			TeamName:        sd.TeamName,
			PlayerLevelURL:  sd.PlayerLevelURL,
			RankBadgeURL:    sd.RankBadgeURL,
			ProfileURL:      sd.ProfileURL,
			ShuffleGradeURL: sd.ShuffleGradeURL,
			TeamGradeURL:    sd.TeamGradeURL,
			ScoreRanking:    sd.ScoreRanking,
			ArcadeName:      sd.ArcadeName,
		},
	}
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
