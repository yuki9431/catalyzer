package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"

	fs "github.com/yuki9431/exvs-analyzer/internal/firestore"
	"github.com/yuki9431/exvs-analyzer/internal/model"
	"github.com/yuki9431/exvs-analyzer/internal/storage"
)

func main() {
	projectID := os.Getenv("GCP_PROJECT")
	if projectID == "" {
		log.Fatal("GCP_PROJECT environment variable is required")
	}
	if storage.BucketName == "" {
		log.Fatal("GCS_BUCKET environment variable is required")
	}

	if err := fs.Init(context.Background(), projectID); err != nil {
		log.Fatalf("Failed to initialize Firestore: %v", err)
	}
	defer fs.Close()

	// GCSから全ユーザーキーを取得
	userKeys, err := storage.ListUserKeys()
	if err != nil {
		log.Fatalf("Failed to list user keys: %v", err)
	}
	log.Printf("[INFO] Found %d users to migrate", len(userKeys))

	tmpDir, err := os.MkdirTemp("", "exvs-migrate-*")
	if err != nil {
		log.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	var succeeded, failed int
	for i, userKey := range userKeys {
		log.Printf("[INFO] Migrating user %d/%d: %s", i+1, len(userKeys), userKey)
		if err := migrateUser(userKey, tmpDir); err != nil {
			log.Printf("[ERROR] Failed to migrate user %s: %v", userKey, err)
			failed++
		} else {
			succeeded++
		}
	}

	log.Printf("[INFO] Migration complete: %d succeeded, %d failed, %d total", succeeded, failed, len(userKeys))
}

func migrateUser(userKey, tmpDir string) error {
	userDir := filepath.Join(tmpDir, userKey)
	if err := os.MkdirAll(userDir, 0755); err != nil {
		return fmt.Errorf("create user dir: %w", err)
	}
	defer os.RemoveAll(userDir)

	// scores.csv → Firestore scores
	csvPath := filepath.Join(userDir, "scores.csv")
	if found, err := storage.DownloadCSVByKey(userKey, csvPath); err != nil {
		return fmt.Errorf("download CSV: %w", err)
	} else if found {
		scores, err := storage.ReadAllScoresCSV(csvPath)
		if err != nil {
			return fmt.Errorf("parse CSV: %w", err)
		}
		if len(scores) > 0 {
			fs.SaveScores(userKey, scores)
		}
	}

	// timelines.json → Firestore timelines
	timelinesPath := filepath.Join(userDir, "timelines.json")
	if found, err := downloadByKey(userKey, "timelines.json", timelinesPath); err != nil {
		log.Printf("[WARN] User %s: failed to download timelines: %v", userKey, err)
	} else if found {
		var entries []fs.TimelineEntry
		data, err := os.ReadFile(timelinesPath)
		if err == nil {
			if err := json.Unmarshal(data, &entries); err != nil {
				log.Printf("[WARN] User %s: failed to parse timelines: %v", userKey, err)
			} else if len(entries) > 0 {
				fs.SaveTimelineEntries(userKey, entries)
			}
		}
	}

	// tag_partners.json → Firestore tag_partners
	tagPartnersPath := filepath.Join(userDir, "tag_partners.json")
	if found, err := downloadByKey(userKey, "tag_partners.json", tagPartnersPath); err != nil {
		log.Printf("[WARN] User %s: failed to download tag partners: %v", userKey, err)
	} else if found {
		type tagPartnerJSON struct {
			TeamName   string `json:"team_name"`
			PlayerName string `json:"player_name"`
		}
		var raw []tagPartnerJSON
		data, err := os.ReadFile(tagPartnersPath)
		if err == nil {
			if err := json.Unmarshal(data, &raw); err != nil {
				log.Printf("[WARN] User %s: failed to parse tag partners: %v", userKey, err)
			} else if len(raw) > 0 {
				partners := make([]model.TagPartner, len(raw))
				for i, r := range raw {
					partners[i] = model.TagPartner{TeamName: r.TeamName, PlayerName: r.PlayerName}
				}
				fs.SaveTagPartners(userKey, partners)
			}
		}
	}

	return nil
}

// downloadByKey はuserKeyを使ってGCSからファイルをダウンロードする
func downloadByKey(userKey, filename, localPath string) (bool, error) {
	objPath := fmt.Sprintf("users/%s/%s", userKey, filename)
	return storage.DownloadByObjectPath(objPath, localPath)
}
