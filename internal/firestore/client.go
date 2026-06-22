package firestore

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"cloud.google.com/go/compute/metadata"
	"cloud.google.com/go/firestore"
)

const defaultTimeout = 30 * time.Second

// emulatorProjectID はFirestoreエミュレータ接続時に使うダミーのプロジェクトID。
// エミュレータはプロジェクトIDを検証しないため、実プロジェクトIDが不要なローカル開発で使う。
const emulatorProjectID = "local-dev"

var (
	client   *firestore.Client
	clientMu sync.RWMutex
)

// Init はFirestoreクライアントを初期化する。
// 環境変数 FIRESTORE_DATABASE でデータベースIDを指定する。
// プロジェクトIDは次の優先順で解決する:
//  1. 環境変数 GCP_PROJECT / GOOGLE_CLOUD_PROJECT（ローカル開発向け）
//  2. FIRESTORE_EMULATOR_HOST 設定時はダミーのプロジェクトID（エミュレータ接続）
//  3. Cloud Runのメタデータサーバーからの自動検出
func Init(ctx context.Context) error {
	projectID := projectIDFromEnv()
	if projectID == "" {
		if os.Getenv("FIRESTORE_EMULATOR_HOST") != "" {
			projectID = emulatorProjectID
		} else {
			id, err := metadata.ProjectIDWithContext(ctx)
			if err != nil {
				return fmt.Errorf("detect project ID: %w", err)
			}
			projectID = id
		}
	}
	return initClient(ctx, projectID)
}

// projectIDFromEnv は環境変数からプロジェクトIDを取得する。未設定なら空文字を返す。
func projectIDFromEnv() string {
	for _, key := range []string{"GCP_PROJECT", "GOOGLE_CLOUD_PROJECT"} {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return ""
}

// InitWithProjectID はプロジェクトIDを指定してFirestoreクライアントを初期化する。
// メタデータサーバーが利用できないローカル環境やCLIツールから使用する。
func InitWithProjectID(ctx context.Context, projectID string) error {
	return initClient(ctx, projectID)
}

func initClient(ctx context.Context, projectID string) error {
	dbID := os.Getenv("FIRESTORE_DATABASE")
	if dbID == "" {
		return fmt.Errorf("FIRESTORE_DATABASE environment variable is required")
	}

	c, err := firestore.NewClientWithDatabase(ctx, projectID, dbID)
	if err != nil {
		return fmt.Errorf("firestore client init: %w", err)
	}

	clientMu.Lock()
	client = c
	clientMu.Unlock()

	if host := os.Getenv("FIRESTORE_EMULATOR_HOST"); host != "" {
		log.Printf("[INFO] Firestore client initialized against emulator %s (project: %s, database: %s)", host, projectID, dbID)
	} else {
		log.Printf("[INFO] Firestore client initialized (project: %s, database: %s)", projectID, dbID)
	}
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