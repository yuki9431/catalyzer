package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"

	"github.com/yuki9431/exvs-analyzer/internal/firestore"
	"github.com/yuki9431/exvs-analyzer/internal/gradelist"
)

func main() {
	gradeListPath := flag.String("grades", "data/grade_list.json", "grade_list.jsonのパス")
	flag.Parse()

	projectID := os.Getenv("GCP_PROJECT")
	if projectID == "" {
		fmt.Fprintln(os.Stderr, "Usage: GCP_PROJECT=<project> FIRESTORE_DATABASE=<db> extract-grades [-grades path]")
		os.Exit(1)
	}

	ctx := context.Background()
	if err := firestore.InitWithProjectID(ctx, projectID); err != nil {
		log.Fatalf("Firestore初期化失敗: %v", err)
	}
	defer firestore.Close()

	gradeList, err := gradelist.LoadGradeList(*gradeListPath)
	if err != nil {
		log.Fatalf("grade_list.json読み込み失敗: %v", err)
	}
	gradeMap := gradelist.BuildGradeMap(gradeList)
	log.Printf("[INFO] %d件の登録済みグレードを読み込み", len(gradeList))

	userKeys, err := firestore.ListUserKeys(ctx)
	if err != nil {
		log.Fatalf("ユーザー一覧取得失敗: %v", err)
	}
	log.Printf("[INFO] %d人のユーザーを検出", len(userKeys))

	allUnknown := make(map[string]int)
	for _, userKey := range userKeys {
		scores, err := firestore.LoadScores(userKey)
		if err != nil {
			log.Printf("[WARN] ユーザー %s のスコア読み込み失敗: %v", userKey, err)
			continue
		}
		unknown := gradelist.FindUnknownGrades(scores, gradeMap)
		for url, count := range unknown {
			allUnknown[url] += count
		}
		log.Printf("[INFO] ユーザー %s: %d件のスコア, %d件の未知グレード", userKey, len(scores), len(unknown))
	}

	if len(allUnknown) == 0 {
		fmt.Println("\n未知のグレードURLはありません。grade_list.jsonは最新です。")
		return
	}

	urls := make([]string, 0, len(allUnknown))
	for u := range allUnknown {
		urls = append(urls, u)
	}
	sort.Strings(urls)

	fmt.Printf("\n=== 未登録グレードURL (%d件) ===\n", len(allUnknown))
	for _, u := range urls {
		fmt.Printf("  %s (出現: %d回)\n", u, allUnknown[u])
	}
}
