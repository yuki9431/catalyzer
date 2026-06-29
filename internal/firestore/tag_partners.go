package firestore

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"

	"github.com/yuki9431/catalyzer/internal/model"
)

// tagPartnerDoc はFirestoreに保存するtag_partnersドキュメントの構造体
type tagPartnerDoc struct {
	TeamName   string `firestore:"team_name"`
	PlayerName string `firestore:"player_name"`
}

// LoadTagPartners はFirestoreからユーザーのタッグ相方情報を読み取る。
func LoadTagPartners(userKey string) ([]model.TagPartner, error) {
	c := getClient()
	if c == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)
	docs, err := userRef.Collection("tag_partners").Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("query tag partners: %w", err)
	}

	partners := make([]model.TagPartner, 0, len(docs))
	for _, doc := range docs {
		var td tagPartnerDoc
		if err := doc.DataTo(&td); err != nil {
			log.Printf("[WARN] Firestore: failed to parse tag partner doc %s: %v", doc.Ref.ID, err)
			continue
		}
		partners = append(partners, model.TagPartner{
			TeamName:   td.TeamName,
			PlayerName: td.PlayerName,
		})
	}

	return partners, nil
}

// SaveTagPartners はタッグ相方情報をFirestoreのtag_partnersサブコレクションに書き込む。
func SaveTagPartners(userKey string, partners []model.TagPartner) {
	c := getClient()
	if c == nil {
		return
	}
	if len(partners) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := c.Collection("users").Doc(userKey)
	partnersCol := userRef.Collection("tag_partners")

	bw := c.BulkWriter(ctx)
	for _, p := range partners {
		docID := partnerDocID(p)
		doc := partnersCol.Doc(docID)
		if _, err := bw.Set(doc, tagPartnerDoc{
			TeamName:   p.TeamName,
			PlayerName: p.PlayerName,
		}); err != nil {
			log.Printf("[WARN] Firestore: failed to enqueue tag partner %s: %v", docID, err)
			continue
		}
	}
	bw.End()

	log.Printf("[INFO] Firestore: saved %d tag partners for user %s", len(partners), userKey)
}

// partnerDocID はtag_partnersドキュメントのIDを生成する。
// チーム名+プレイヤー名のSHA256ハッシュ先頭16文字を使用。
func partnerDocID(p model.TagPartner) string {
	h := sha256.Sum256([]byte(p.TeamName + ":" + p.PlayerName))
	return fmt.Sprintf("%x", h[:8])
}
