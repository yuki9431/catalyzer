package firestore

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
)

const defaultTimeout = 30 * time.Second

var (
	client   *firestore.Client
	clientMu sync.RWMutex
)

// Init はFirestoreクライアントを初期化する。
// 環境変数 FIRESTORE_DATABASE でデータベースIDを指定する。
// プロジェクトIDはCloud Run上では自動検出される。
func Init(ctx context.Context) error {
	dbID := os.Getenv("FIRESTORE_DATABASE")
	if dbID == "" {
		return fmt.Errorf("FIRESTORE_DATABASE environment variable is required")
	}

	c, err := firestore.NewClientWithDatabase(ctx, "", dbID)
	if err != nil {
		return fmt.Errorf("firestore client init: %w", err)
	}

	clientMu.Lock()
	client = c
	clientMu.Unlock()

	log.Printf("[INFO] Firestore client initialized (database: %s)", dbID)
	return nil
}

// Close はFirestoreクライアントを閉じる。
func Close() error {
	clientMu.Lock()
	defer clientMu.Unlock()

	if client == nil {
		return nil
	}
	err := client.Close()
	client = nil
	return err
}

// getClient はFirestoreクライアントを返す。未初期化の場合はnilを返す。
func getClient() *firestore.Client {
	clientMu.RLock()
	defer clientMu.RUnlock()
	return client
}