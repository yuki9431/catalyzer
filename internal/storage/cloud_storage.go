package storage

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
)

// BucketName は環境変数 GCS_BUCKET から取得するCloud Storageのバケット名
var BucketName = os.Getenv("GCS_BUCKET")

// UserKey はユーザー名からユーザー固有のキーを生成する
func UserKey(username string) string {
	hash := sha256.Sum256([]byte(username))
	return fmt.Sprintf("%x", hash[:8])
}

// CSVObjectPath はユーザーのCSVオブジェクトパスを返す
func CSVObjectPath(username string) string {
	return fmt.Sprintf("users/%s/scores.csv", UserKey(username))
}

// downloadObject はGCSからオブジェクトをローカルファイルにダウンロードする
// オブジェクトが存在しない場合はfalseを返す
func downloadObject(objPath, localPath string) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client, err := storage.NewClient(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to create storage client: %w", err)
	}
	defer client.Close()

	reader, err := client.Bucket(BucketName).Object(objPath).NewReader(ctx)
	if err != nil {
		if err == storage.ErrObjectNotExist {
			return false, nil
		}
		return false, fmt.Errorf("failed to read from GCS: %w", err)
	}
	defer reader.Close()

	f, err := os.Create(localPath)
	if err != nil {
		return false, fmt.Errorf("failed to create local file: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, reader); err != nil {
		return false, fmt.Errorf("failed to download from GCS: %w", err)
	}

	return true, nil
}

// uploadObject はローカルファイルをGCSにアップロードする
func uploadObject(objPath, localPath, contentType string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client, err := storage.NewClient(ctx)
	if err != nil {
		return fmt.Errorf("failed to create storage client: %w", err)
	}
	defer client.Close()

	f, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("failed to open local file: %w", err)
	}
	defer f.Close()

	writer := client.Bucket(BucketName).Object(objPath).NewWriter(ctx)
	writer.ContentType = contentType

	if _, err := io.Copy(writer, f); err != nil {
		return fmt.Errorf("failed to upload to GCS: %w", err)
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("failed to finalize upload: %w", err)
	}

	return nil
}

// DownloadCSV はCloud StorageからCSVをローカルファイルにダウンロードする
// ファイルが存在しない場合はfalseを返す
func DownloadCSV(username, localPath string) (bool, error) {
	found, err := downloadObject(CSVObjectPath(username), localPath)
	if err != nil {
		return false, err
	}
	if found {
		log.Printf("[INFO] Downloaded existing CSV from GCS")
	} else {
		log.Printf("[INFO] No existing CSV found for user")
	}
	return found, nil
}

// DownloadCSVByKey はユーザーキーを使ってCloud StorageからCSVをダウンロードする
func DownloadCSVByKey(userKey, localPath string) (bool, error) {
	return downloadObject(fmt.Sprintf("users/%s/scores.csv", userKey), localPath)
}

// TagPartnersObjectPath はユーザーのタッグ相方JSONオブジェクトパスを返す
func TagPartnersObjectPath(username string) string {
	return fmt.Sprintf("users/%s/tag_partners.json", UserKey(username))
}

// DownloadTagPartners はCloud Storageからタッグ相方JSONをローカルファイルにダウンロードする
// ファイルが存在しない場合はfalseを返す
func DownloadTagPartners(username, localPath string) (bool, error) {
	found, err := downloadObject(TagPartnersObjectPath(username), localPath)
	if err != nil {
		return false, err
	}
	if found {
		log.Printf("[INFO] Downloaded existing tag partners from GCS")
	} else {
		log.Printf("[INFO] No existing tag partners found for user")
	}
	return found, nil
}

// UploadCSV はローカルのCSVファイルをCloud Storageにアップロードする
func UploadCSV(username, localPath string) error {
	if err := uploadObject(CSVObjectPath(username), localPath, "text/csv"); err != nil {
		return err
	}
	log.Printf("[INFO] Uploaded CSV to GCS")
	return nil
}

// UploadTagPartners はローカルのタッグ相方JSONファイルをCloud Storageにアップロードする
func UploadTagPartners(username, localPath string) error {
	if err := uploadObject(TagPartnersObjectPath(username), localPath, "application/json"); err != nil {
		return err
	}
	log.Printf("[INFO] Uploaded tag partners to GCS")
	return nil
}

// TimelineObjectPath はユーザーのタイムラインJSONオブジェクトパスを返す
func TimelineObjectPath(username string) string {
	return fmt.Sprintf("users/%s/timelines.json", UserKey(username))
}

// DownloadTimeline はCloud Storageからタイムラインデータをダウンロードする
func DownloadTimeline(username, localPath string) (bool, error) {
	found, err := downloadObject(TimelineObjectPath(username), localPath)
	if err != nil {
		return false, err
	}
	if found {
		log.Printf("[INFO] Downloaded existing timelines from GCS")
	}
	return found, nil
}

// UploadTimeline はローカルのタイムラインJSONファイルをCloud Storageにアップロードする
func UploadTimeline(username, localPath string) error {
	if err := uploadObject(TimelineObjectPath(username), localPath, "application/json"); err != nil {
		return err
	}
	log.Printf("[INFO] Uploaded timelines to GCS")
	return nil
}

// DownloadByObjectPath はGCSオブジェクトパスを直接指定してダウンロードする
func DownloadByObjectPath(objPath, localPath string) (bool, error) {
	return downloadObject(objPath, localPath)
}

// ListUserKeys はGCSバケットの users/ 配下からユーザーキー一覧を取得する
func ListUserKeys() ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage client: %w", err)
	}
	defer client.Close()

	seen := make(map[string]bool)
	it := client.Bucket(BucketName).Objects(ctx, &storage.Query{Prefix: "users/"})
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list objects: %w", err)
		}
		// "users/{userKey}/scores.csv" → userKey を抽出
		parts := strings.SplitN(attrs.Name, "/", 3)
		if len(parts) >= 2 && parts[1] != "" {
			seen[parts[1]] = true
		}
	}

	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	return keys, nil
}
