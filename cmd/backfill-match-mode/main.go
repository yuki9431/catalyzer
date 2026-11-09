package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/matchmode"
)

func main() {
	userKey := flag.String("user", "", "対象ユーザーキー（省略時は全ユーザー）")
	execute := flag.Bool("execute", false, "実際に書き込む（省略時はドライラン）")
	flag.Parse()

	projectID := os.Getenv("GCP_PROJECT")
	if projectID == "" || os.Getenv("FIRESTORE_DATABASE") == "" {
		fmt.Fprintln(os.Stderr, "Usage: GCP_PROJECT=<project> FIRESTORE_DATABASE=<db> backfill-match-mode [-user <userKey>] [-execute]")
		os.Exit(1)
	}

	ctx := context.Background()
	if err := firestore.InitWithProjectID(ctx, projectID); err != nil {
		log.Fatalf("Firestore初期化失敗: %v", err)
	}
	defer func() {
		if err := firestore.Close(); err != nil {
			log.Printf("[WARN] Firestore close error: %v", err)
		}
	}()

	keys := []string{*userKey}
	if *userKey == "" {
		var err error
		if keys, err = firestore.ListUserKeys(ctx); err != nil {
			log.Fatalf("ユーザー一覧取得失敗: %v", err)
		}
	}
	if !*execute {
		log.Printf("[INFO] ドライラン（書き込むには -execute）")
	}

	var total firestore.BackfillResult
	failed := 0
	for _, key := range keys {
		tags, err := firestore.LoadTagPartners(key)
		if err != nil {
			log.Printf("[WARN] ユーザー %s のタッグ相方の読み込み失敗: %v", key, err)
			failed++
			continue
		}
		res, err := firestore.BackfillMatchModes(ctx, key, matchmode.New(tags).Infer, *execute)
		if err != nil {
			log.Printf("[WARN] ユーザー %s の補完失敗: %v", key, err)
			failed++
			continue
		}
		log.Printf("[INFO] ユーザー %s: タッグ相方 %d人 / 固定 %d / シャッフル %d / 推定不可 %d", key, len(tags), res.Fixed, res.Shuffle, res.Skipped)
		total.Fixed += res.Fixed
		total.Shuffle += res.Shuffle
		total.Skipped += res.Skipped
	}
	log.Printf("[INFO] 合計(%d人): 固定 %d / シャッフル %d / 推定不可 %d / 失敗ユーザー %d", len(keys), total.Fixed, total.Shuffle, total.Skipped, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
