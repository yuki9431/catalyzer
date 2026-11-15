// Command extract-proficiencies は Firestore の全ユーザーの試合から機体熟練度(公式の class 名)の出現数を集計する。
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sort"

	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
)

// proficiencyCount は熟練度の値と出現数
type proficiencyCount struct {
	Value string
	Count int
}

// tallyProficiencies は全プレイヤー行の MsProficiency を数える。空値は "(empty)" に寄せる
func tallyProficiencies(ds model.DatedScores, acc map[string]int) {
	for _, d := range ds {
		v := d.PlayerScore.MsProficiency
		if v == "" {
			v = "(empty)"
		}
		acc[v]++
	}
}

// sortedCounts は出現数の降順(同数は値の昇順)に並べる
func sortedCounts(acc map[string]int) []proficiencyCount {
	out := make([]proficiencyCount, 0, len(acc))
	for v, c := range acc {
		out = append(out, proficiencyCount{Value: v, Count: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Value < out[j].Value
	})
	return out
}

func main() {
	projectID := os.Getenv("GCP_PROJECT")
	if projectID == "" {
		fmt.Fprintln(os.Stderr, "Usage: GCP_PROJECT=<project> FIRESTORE_DATABASE=<db> extract-proficiencies")
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

	userKeys, err := firestore.ListUserKeys(ctx)
	if err != nil {
		log.Fatalf("ユーザー一覧取得失敗: %v", err)
	}
	log.Printf("[INFO] %d人のユーザーを検出", len(userKeys))

	acc := make(map[string]int)
	for _, userKey := range userKeys {
		scores, err := firestore.LoadScores(userKey)
		if err != nil {
			log.Printf("[WARN] ユーザー %s のスコア読み込み失敗: %v", userKey, err)
			continue
		}
		tallyProficiencies(scores, acc)
	}

	counts := sortedCounts(acc)
	fmt.Printf("\n=== 機体熟練度の値 (%d種類) ===\n", len(counts))
	for _, c := range counts {
		fmt.Printf("  %-12s %d\n", c.Value, c.Count)
	}
}
