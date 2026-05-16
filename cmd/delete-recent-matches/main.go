package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/firestore"
)

func main() {
	userKey := flag.String("user", "", "対象ユーザーキー（必須）")
	days := flag.Int("days", 2, "削除する日数（最新日から遡る。最大30）")
	execute := flag.Bool("execute", false, "実際に削除を実行する（省略時はドライラン）")
	flag.Parse()

	if *userKey == "" {
		fmt.Fprintln(os.Stderr, "Usage: delete-recent-scores -user <userKey> [-days N] [-execute]")
		flag.PrintDefaults()
		os.Exit(1)
	}
	if *days < 1 || *days > 30 {
		log.Fatal("-days は 1〜30 の範囲で指定してください")
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

	userRef := client.Collection("users").Doc(*userKey)

	// 最新日時を取得
	latestDocs, err := userRef.Collection("matches").OrderBy("datetime", firestore.Desc).Limit(1).Documents(ctx).GetAll()
	if err != nil || len(latestDocs) == 0 {
		log.Fatalf("Failed to get latest datetime: %v", err)
	}
	latestTime := latestDocs[0].Data()["datetime"].(time.Time)
	log.Printf("[INFO] Latest datetime: %s", latestTime.Format("2006-01-02 15:04"))

	// cutoff = 最新日の0:00から (days-1) 日前
	cutoff := latestTime.Truncate(24 * time.Hour).AddDate(0, 0, -(*days - 1))
	log.Printf("[INFO] Cutoff (deleting >= %s): %d days", cutoff.Format("2006-01-02"), *days)

	// 削除対象を収集
	matchDocs, err := userRef.Collection("matches").Where("datetime", ">=", cutoff).Documents(ctx).GetAll()
	if err != nil {
		log.Fatalf("Failed to query matches: %v", err)
	}

	log.Printf("[INFO] Matches to delete: %d documents", len(matchDocs))
	for _, doc := range matchDocs {
		data := doc.Data()
		dt := data["datetime"].(time.Time)
		players, _ := data["players"].([]interface{})
		var names []string
		for _, p := range players {
			if pm, ok := p.(map[string]interface{}); ok {
				if name, ok := pm["name"].(string); ok {
					names = append(names, name)
				}
			}
		}
		log.Printf("  - %s [%d players] %v (doc: %s)", dt.Format("2006-01-02 15:04"), len(names), names, doc.Ref.ID)
	}

	if !*execute {
		log.Printf("[DRY RUN] No changes made. Add -execute to delete.")
		return
	}

	// 削除実行
	const batchLimit = 500
	for i := 0; i < len(matchDocs); i += batchLimit {
		end := i + batchLimit
		if end > len(matchDocs) {
			end = len(matchDocs)
		}
		batch := client.Batch()
		for _, doc := range matchDocs[i:end] {
			batch.Delete(doc.Ref)
		}
		if _, err := batch.Commit(ctx); err != nil {
			log.Fatalf("Batch delete failed (%d-%d): %v", i, end, err)
		}
	}

	log.Printf("[INFO] Deleted %d matches", len(matchDocs))
}
