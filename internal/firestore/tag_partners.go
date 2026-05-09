package firestore

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
)

// TagPartner はタッグ相方情報（scraper.TagPartnerと同じ構造だが循環依存を避けるため再定義）
type TagPartner struct {
	TeamName   string
	PlayerName string
}

// tagPartnerDoc はFirestoreに保存するtag_partnersドキュメントの構造体
type tagPartnerDoc struct {
	TeamName   string `firestore:"team_name"`
	PlayerName string `firestore:"player_name"`
}

// SaveTagPartners はタッグ相方情報をFirestoreのtag_partnersサブコレクションに書き込む。
func SaveTagPartners(userKey string, partners []TagPartner) {
	c := getClient()
	if c == nil {
		return
	}
	if len(partners) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	userRef := userDoc(userKey)
	partnersCol := userRef.Collection("tag_partners")

	batch := c.Batch()
	for _, p := range partners {
		docID := partnerDocID(p)
		doc := partnersCol.Doc(docID)
		batch.Set(doc, tagPartnerDoc{
			TeamName:   p.TeamName,
			PlayerName: p.PlayerName,
		})
	}

	if _, err := batch.Commit(ctx); err != nil {
		log.Printf("[WARN] Firestore: failed to save tag partners: %v", err)
		return
	}

	log.Printf("[INFO] Firestore: saved %d tag partners for user %s", len(partners), userKey)
}

// partnerDocID はtag_partnersドキュメントのIDを生成する。
// チーム名+プレイヤー名のSHA256ハッシュ先頭16文字を使用。
func partnerDocID(p TagPartner) string {
	h := sha256.Sum256([]byte(p.TeamName + ":" + p.PlayerName))
	return fmt.Sprintf("%x", h[:8])
}
