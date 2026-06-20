package firestore

import (
	"context"
	"fmt"
	"log"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// SaveReportCache は分析レポートJSONをFirestoreにキャッシュとして保存する。
func SaveReportCache(userKey string, reportJSON string) {
	c := getClient()
	if c == nil {
		return
	}

	if len(reportJSON) > 900000 {
		log.Printf("[WARN] Firestore: report cache for user %s is %d bytes (approaching 1MB limit)", userKey, len(reportJSON))
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	ref := c.Collection("users").Doc(userKey).Collection("cache").Doc("report")
	_, err := ref.Set(ctx, map[string]interface{}{
		"report":     reportJSON,
		"updated_at": firestore.ServerTimestamp,
	})
	if err != nil {
		log.Printf("[WARN] Firestore: failed to save report cache: %v", err)
		return
	}

	log.Printf("[INFO] Firestore: saved report cache for user %s (%d bytes)", userKey, len(reportJSON))
}

// LoadReportCache はFirestoreからキャッシュされた分析レポートJSONを読み取る。
// キャッシュが存在しない場合は空文字列とnilを返す。
func LoadReportCache(userKey string) (string, error) {
	c := getClient()
	if c == nil {
		return "", fmt.Errorf("firestore client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	ref := c.Collection("users").Doc(userKey).Collection("cache").Doc("report")
	doc, err := ref.Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return "", nil
		}
		return "", fmt.Errorf("get report cache: %w", err)
	}

	report, ok := doc.Data()["report"].(string)
	if !ok {
		return "", nil
	}
	return report, nil
}
