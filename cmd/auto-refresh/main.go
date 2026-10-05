package main

import (
	"context"
	"log"

	"github.com/yuki9431/catalyzer/internal/autorefresh"
	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/mslist"
	"github.com/yuki9431/catalyzer/internal/pipeline"
)

func main() {
	ctx := context.Background()
	if err := firestore.InitFromEnv(ctx); err != nil {
		log.Fatalf("[ERROR] Firestore initialization failed: %v", err)
	}
	defer func() { _ = firestore.Close() }()

	msList, err := mslist.LoadMSList(pipeline.DefaultMSListPath)
	if err != nil {
		log.Printf("[WARN] MS list not found, MS names will be empty")
	}
	if err := autorefresh.RunJob(ctx, "", mslist.BuildMSNameMap(msList)); err != nil {
		log.Fatalf("[ERROR] auto-refresh failed: %v", err)
	}
}
