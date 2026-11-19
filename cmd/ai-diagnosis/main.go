package main

import (
	"context"
	"flag"
	"log"
	"os"

	"github.com/yuki9431/catalyzer/internal/aidiagnosis"
	"github.com/yuki9431/catalyzer/internal/firestore"
)

func main() {
	smoke := flag.Bool("smoke", false, "サンプル入力で claude を1回実行して検査する(Firestore は使わない)")
	flag.Parse()
	ctx := context.Background()
	if *smoke {
		if err := aidiagnosis.Smoke(ctx, os.Stdout); err != nil {
			log.Fatalf("[ERROR] ai-diagnosis smoke failed: %v", err)
		}
		return
	}
	if err := firestore.InitFromEnv(ctx); err != nil {
		log.Fatalf("[ERROR] Firestore initialization failed: %v", err)
	}
	defer func() { _ = firestore.Close() }()
	if err := aidiagnosis.RunJob(ctx, ""); err != nil {
		log.Fatalf("[ERROR] ai-diagnosis failed: %v", err)
	}
}
