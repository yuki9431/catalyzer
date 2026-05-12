package pipeline

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	fs "github.com/yuki9431/exvs-analyzer/internal/firestore"
	"github.com/yuki9431/exvs-analyzer/internal/gradelist"
	"github.com/yuki9431/exvs-analyzer/internal/model"
	"github.com/yuki9431/exvs-analyzer/internal/mslist"
	"github.com/yuki9431/exvs-analyzer/internal/scraper"
	"github.com/yuki9431/exvs-analyzer/internal/storage"
)

// DefaultMSListPath はデフォルトのMSリストパス
const DefaultMSListPath = "data/ms_list.json"

// DefaultGradeListPath はデフォルトのグレードリストパス
const DefaultGradeListPath = "data/grade_list.json"

// Job はバックグラウンドジョブの情報
type Job struct {
	ID                 string           `json:"id"`
	Status             model.JobStatus  `json:"status"`
	Message            string           `json:"message,omitempty"`
	Progress           int              `json:"progress,omitempty"`
	ProgressTotal      int              `json:"progress_total,omitempty"`
	Report             string           `json:"report,omitempty"`
	PreliminaryReport  string           `json:"preliminary_report,omitempty"`
	Error              string           `json:"error,omitempty"`
	PartialData        bool             `json:"partial_data,omitempty"`
	UserKey            string           `json:"-"`
	completedAt        time.Time
}

// ジョブストア（インメモリ）
var (
	jobs   = make(map[string]*Job)
	jobsMu sync.RWMutex
)

// NewJob はジョブを作成してストアに登録する
func NewJob() *Job {
	j := &Job{
		ID:     uuid.New().String(),
		Status: model.StatusPending,
	}
	jobsMu.Lock()
	jobs[j.ID] = j
	jobsMu.Unlock()
	return j
}

// GetJob はIDからジョブを取得する
func GetJob(id string) (*Job, bool) {
	jobsMu.RLock()
	j, ok := jobs[id]
	jobsMu.RUnlock()
	return j, ok
}

// Snapshot はジョブ状態のスナップショットを返す
func (j *Job) Snapshot() model.JobSnapshot {
	jobsMu.RLock()
	defer jobsMu.RUnlock()
	return model.JobSnapshot{
		ID:                j.ID,
		Status:            j.Status,
		Message:           j.Message,
		Progress:          j.Progress,
		ProgressTotal:     j.ProgressTotal,
		Report:            j.Report,
		PreliminaryReport: j.PreliminaryReport,
		Error:             j.Error,
		PartialData:       j.PartialData,
		UserKey:           j.UserKey,
	}
}

// On403Func は403検出時に呼び出されるコールバック型
type On403Func func(userHash string)

// Run はスクレイピング→分析を実行し、レポートをジョブに保存する
func Run(j *Job, username, password string, on403 ...On403Func) {
	jobsMu.Lock()
	j.UserKey = storage.UserKey(username)
	jobsMu.Unlock()
	updateStatus(j, model.StatusScraping)

	tmpDir, err := os.MkdirTemp("", "exvs-*")
	if err != nil {
		setError(j, "内部エラーが発生しました", fmt.Sprintf("failed to create temp dir: %v", err))
		return
	}
	defer os.RemoveAll(tmpDir)

	csvPath := filepath.Join(tmpDir, "scores.csv")

	// Firestoreから既存scoresを読み取り
	var since time.Time
	existingScores, err := fs.LoadScores(j.UserKey)
	if err != nil {
		log.Printf("[WARN] Failed to load scores from Firestore: %v", err)
	}
	exists := len(existingScores) > 0

	// Firestoreから既存タッグ相方情報を読み取り（速報レポートで使用）
	cachedTagPartnersPath := ""
	cachedPartners, err := fs.LoadTagPartners(j.UserKey)
	if err != nil {
		log.Printf("[WARN] Failed to load tag partners from Firestore: %v", err)
	}
	if len(cachedPartners) > 0 {
		cachedTagPartnersPath = filepath.Join(tmpDir, "cached_tag_partners.json")
		if err := saveTagPartners(cachedPartners, cachedTagPartnersPath); err != nil {
			log.Printf("[WARN] Failed to save cached tag partners: %v", err)
			cachedTagPartnersPath = ""
		}
	}

	// バックフィル判定: Firestoreから新フィールドが空のレコードがある日付を特定
	var backfillDates map[string]bool
	if exists {
		backfillDates = fs.BackfillDates(j.UserKey)
		if len(backfillDates) > 0 {
			log.Printf("[INFO] Backfill needed: %d dates with missing data", len(backfillDates))
		}
	}

	if exists {
		if len(backfillDates) > 0 {
			// バックフィル: since=ゼロで対象日付のみ再スクレイプ
			log.Printf("[INFO] Backfill mode: targeting specific dates")
		} else {
			since, err = fs.GetLatestDatetime(j.UserKey)
			if err != nil {
				log.Printf("[WARN] Failed to read latest datetime from Firestore: %v", err)
			}
			if !since.IsZero() {
				log.Printf("[INFO] Fetching scores after %s", since.Format("2006-01-02 15:04"))
			}
		}

		// 既存データでCSVを生成して速報レポートを作成
		if err := storage.SaveAllScoresCSV(existingScores, csvPath); err != nil {
			log.Printf("[WARN] Failed to generate CSV for preliminary report: %v", err)
		} else {
			prelimReport := runAnalysis(csvPath, tmpDir, cachedTagPartnersPath, "")
			if prelimReport != "" {
				jobsMu.Lock()
				j.PreliminaryReport = prelimReport
				jobsMu.Unlock()
				log.Printf("[INFO] Job %s: preliminary report ready", j.ID)
			}
		}
	}

	// スクレイピング
	log.Printf("[INFO] Scraping for user (hash: %s)", storage.UserKey(username))
	onProgress := func(current, total int) {
		jobsMu.Lock()
		j.Message = "戦歴データを取得中"
		j.Progress = current
		j.ProgressTotal = total
		jobsMu.Unlock()
	}

	var datedScores model.DatedScores
	var jar http.CookieJar
	if len(backfillDates) > 0 {
		datedScores, jar, err = scraper.ScrapingWithOption(username, password, since, scraper.ScrapingOption{
			OnProgress:    onProgress,
			BackfillDates: backfillDates,
		})
	} else {
		datedScores, jar, err = scraper.Scraping(username, password, since, onProgress)
	}
	// 403の場合でも途中データがあれば保存・分析を続行する
	is403WithPartialData := errors.Is(err, scraper.ErrAccessDenied) && len(datedScores) > 0
	if err != nil && !is403WithPartialData {
		switch {
		case errors.Is(err, scraper.ErrLoginFailed):
			setError(j, "ログインに失敗しました。メールアドレスとパスワードを確認してください。", err.Error())
		case errors.Is(err, scraper.ErrAccessDenied):
			setError(j, "対戦履歴ページへのアクセスが拒否されました。ブラウザからガンダムモバイル(https://web.vsmobile.jp)にログインし、対戦履歴が閲覧できるか確認してください。", err.Error())
			if len(on403) > 0 && on403[0] != nil {
				on403[0](storage.UserKey(username))
			}
		case errors.Is(err, scraper.ErrUnauthorized):
			setError(j, "認証の有効期限が切れました。再度ログインしてお試しください。", err.Error())
		case errors.Is(err, scraper.ErrNotFound):
			setError(j, "対戦履歴ページが見つかりませんでした。サイトの仕様が変更された可能性があります。", err.Error())
		case errors.Is(err, scraper.ErrServerError):
			setError(j, "ガンダムモバイルのサーバーでエラーが発生しています。しばらく時間をおいてから再度お試しください。", err.Error())
		default:
			setError(j, "データの取得に失敗しました。時間をおいて再度お試しいただき、解決しない場合は開発者までお問い合わせください。", err.Error())
		}
		return
	}
	if is403WithPartialData {
		log.Printf("[WARN] Job %s: 403 occurred but %d partial scores available, saving partial data", j.ID, len(datedScores))
		if len(on403) > 0 && on403[0] != nil {
			on403[0](storage.UserKey(username))
		}
	}
	if len(datedScores) == 0 && !exists {
		setError(j, "戦績データが見つかりませんでした", "no scores found")
		return
	}

	// 新規データがない場合はタッグ情報を付与して最終レポートにする
	// csvPathには速報レポート用に生成したCSVが残っており、ここでそのまま再利用する
	if len(datedScores) == 0 && j.PreliminaryReport != "" {
		var tagPartnersPath string
		tagPartners := scraper.ScrapeTagPartners(jar)
		if len(tagPartners) > 0 {
			tagPartnersPath = filepath.Join(tmpDir, "tag_partners.json")
			if err := saveTagPartners(tagPartners, tagPartnersPath); err != nil {
				log.Printf("[WARN] Failed to save tag partners: %v", err)
				tagPartnersPath = ""
			} else {
				log.Printf("[INFO] Found %d tag partners (no new data path)", len(tagPartners))
				// タッグ相方情報をGCSにアップロード
				if err := storage.UploadTagPartners(username, tagPartnersPath); err != nil {
					log.Printf("[WARN] Failed to upload tag partners to GCS: %v", err)
				}
				// Firestoreにtag_partnersを書き込み
				fs.SaveTagPartners(j.UserKey, tagPartners)
			}
		} else {
			log.Printf("[INFO] No tag partners found (no new data path)")
		}

		// タッグ情報がある場合は再分析、なければ速報レポートをそのまま使う
		finalReport := j.PreliminaryReport
		if tagPartnersPath != "" {
			report := runAnalysis(csvPath, tmpDir, tagPartnersPath, "")
			if report != "" {
				finalReport = report
			}
		}

		jobsMu.Lock()
		j.Status = model.StatusDone
		j.Report = finalReport
		j.completedAt = time.Now()
		jobsMu.Unlock()
		log.Printf("[INFO] Job %s completed (no new data)", j.ID)
		return
	}

	// 同梱のMSリストから機体名マッピングを読み込み
	msList, err := mslist.LoadMSList(DefaultMSListPath)
	if err != nil {
		log.Printf("[WARN] MS list not found, MS names will be empty")
	}

	msMap := mslist.BuildMSNameMap(msList)
	mslist.FillMsNames(datedScores, msMap)
	mslist.CheckUnknownMS(datedScores)

	// グレードリストから未知のグレード画像URLを検出
	gradeList, err := gradelist.LoadGradeList(DefaultGradeListPath)
	if err != nil {
		log.Printf("[WARN] Grade list not found: %v", err)
	} else {
		gradeMap := gradelist.BuildGradeMap(gradeList)
		gradelist.CheckUnknownGrades(datedScores, gradeMap)
	}

	// Firestoreにscoresを書き込み
	fs.SaveScores(j.UserKey, datedScores)

	// Firestoreから全scoresを読み取り、CSV生成（GCSアップロード用 + Python分析用）
	allScores, err := fs.LoadScores(j.UserKey)
	if err != nil {
		log.Printf("[WARN] Failed to reload scores from Firestore: %v", err)
		// フォールバック: 既存 + 新規で組み立て
		allScores = append(existingScores, datedScores...)
	}

	// CSVを生成してGCSにアップロード（二重書き込み維持）
	if err := os.Remove(csvPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[WARN] Failed to remove temp CSV: %v", err)
	}
	if err := storage.SaveAllScoresCSV(allScores, csvPath); err != nil {
		setError(j, "内部エラーが発生しました", fmt.Sprintf("failed to save CSV: %v", err))
		return
	}
	if err := storage.UploadCSV(username, csvPath); err != nil {
		log.Printf("[WARN] Failed to upload CSV to Cloud Storage: %v", err)
	}

	// タイムラインデータの保存
	timelinePath := saveTimelines(datedScores, username, j.UserKey, tmpDir)

	// タッグ相方名を取得（403途中保存時はセッションが無効なのでキャッシュを使用）
	var tagPartnersPath string
	if is403WithPartialData {
		if cachedTagPartnersPath != "" {
			tagPartnersPath = cachedTagPartnersPath
			log.Printf("[INFO] Using cached tag partners (403 partial save)")
		}
	} else {
		tagPartners := scraper.ScrapeTagPartners(jar)
		if len(tagPartners) > 0 {
			tagPartnersPath = filepath.Join(tmpDir, "tag_partners.json")
			if err := saveTagPartners(tagPartners, tagPartnersPath); err != nil {
				log.Printf("[WARN] Failed to save tag partners: %v", err)
				tagPartnersPath = ""
			} else {
				log.Printf("[INFO] Found %d tag partners", len(tagPartners))
				// タッグ相方情報をGCSにアップロード
				if err := storage.UploadTagPartners(username, tagPartnersPath); err != nil {
					log.Printf("[WARN] Failed to upload tag partners to GCS: %v", err)
				}
				// Firestoreにtag_partnersを書き込み
				fs.SaveTagPartners(j.UserKey, tagPartners)
			}
		} else {
			log.Printf("[INFO] No tag partners found")
		}
	}

	// Python分析実行
	updateStatus(j, model.StatusAnalyzing)
	report := runAnalysis(csvPath, tmpDir, tagPartnersPath, timelinePath)
	if report == "" {
		setError(j, "分析処理に失敗しました", "analysis returned empty report")
		return
	}

	jobsMu.Lock()
	j.Status = model.StatusDone
	j.Report = report
	j.PartialData = is403WithPartialData
	j.completedAt = time.Now()
	jobsMu.Unlock()
	if is403WithPartialData {
		log.Printf("[INFO] Job %s completed with partial data (403 during scraping)", j.ID)
	} else {
		log.Printf("[INFO] Job %s completed", j.ID)
	}
}

// RunCustomPeriod はカスタム日時範囲で再分析を実行してJSON文字列を返す
func RunCustomPeriod(userKey, start, end string) (string, error) {
	tmpDir, err := os.MkdirTemp("", "exvs-period-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Firestoreからscoresを読み取り
	scores, err := fs.LoadScores(userKey)
	if err != nil {
		return "", fmt.Errorf("failed to load scores from Firestore: %w", err)
	}
	if len(scores) == 0 {
		return "", fmt.Errorf("no scores found for user")
	}

	// CSVを生成
	csvPath := filepath.Join(tmpDir, "scores.csv")
	if err := storage.SaveAllScoresCSV(scores, csvPath); err != nil {
		return "", fmt.Errorf("failed to generate CSV: %w", err)
	}

	cmd := exec.Command("python3", "scripts/analyze.py", csvPath, "--start", start, "--end", end)
	cmd.Dir = "/app"
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("analysis failed: %v\n%s", err, string(output))
	}

	reportPath := filepath.Join(tmpDir, "report.json")
	report, err := os.ReadFile(reportPath)
	if err != nil {
		return "", fmt.Errorf("failed to read report: %w", err)
	}
	return string(report), nil
}

// saveTagPartners はタッグ相方情報をJSONファイルに保存する
func saveTagPartners(partners []model.TagPartner, path string) error {
	type tagPartnerJSON struct {
		TeamName   string `json:"team_name"`
		PlayerName string `json:"player_name"`
	}

	data := make([]tagPartnerJSON, len(partners))
	for i, p := range partners {
		data[i] = tagPartnerJSON{TeamName: p.TeamName, PlayerName: p.PlayerName}
	}

	b, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal tag partners: %w", err)
	}
	return os.WriteFile(path, b, 0644)
}

// saveTimelines はDatedScoresからタイムラインデータを抽出し、Firestoreに保存・GCSにアップロードする
func saveTimelines(scores model.DatedScores, username, userKey, tmpDir string) string {
	// Firestoreにtimelinesを書き込み
	fs.SaveTimelines(userKey, scores)

	// Firestoreから全タイムラインを読み取り（GCSアップロード用 + Python分析用）
	entries, err := fs.LoadTimelines(userKey)
	if err != nil {
		log.Printf("[WARN] Failed to load timelines from Firestore: %v", err)
		return ""
	}

	if len(entries) == 0 {
		return ""
	}

	timelinePath := filepath.Join(tmpDir, "timelines.json")
	b, err := json.Marshal(entries)
	if err != nil {
		log.Printf("[WARN] Failed to marshal timelines: %v", err)
		return ""
	}
	if err := os.WriteFile(timelinePath, b, 0644); err != nil {
		log.Printf("[WARN] Failed to save timelines: %v", err)
		return ""
	}

	// GCSにアップロード（二重書き込み維持）
	if err := storage.UploadTimeline(username, timelinePath); err != nil {
		log.Printf("[WARN] Failed to upload timelines to GCS: %v", err)
	}

	log.Printf("[INFO] Loaded %d timelines from Firestore", len(entries))
	return timelinePath
}

// runAnalysis はPython分析を実行してJSON形式のレポートを返す。失敗時は空文字を返す。
func runAnalysis(csvPath, tmpDir, tagPartnersPath, timelinePath string) string {
	args := []string{"scripts/analyze.py", csvPath}
	if tagPartnersPath != "" {
		args = append(args, "--tag-partners", tagPartnersPath)
	}
	if timelinePath != "" {
		args = append(args, "--timeline", timelinePath)
	}
	cmd := exec.Command("python3", args...)
	cmd.Dir = "/app"
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[WARN] Analysis failed: %v\n%s", err, string(output))
		return ""
	}

	reportPath := filepath.Join(tmpDir, "report.json")
	report, err := os.ReadFile(reportPath)
	if err != nil {
		log.Printf("[WARN] Failed to read report: %v", err)
		return ""
	}
	return string(report)
}

func updateStatus(j *Job, s model.JobStatus) {
	jobsMu.Lock()
	j.Status = s
	jobsMu.Unlock()
}

func setError(j *Job, clientMsg, detail string) {
	jobsMu.Lock()
	j.Status = model.StatusError
	j.Error = clientMsg
	j.completedAt = time.Now()
	jobsMu.Unlock()
	log.Printf("[ERROR] Job %s failed: %s", j.ID, detail)
}

// CleanupJobs は完了済みジョブを定期的に削除する
func CleanupJobs(ttl time.Duration) {
	ticker := time.NewTicker(ttl)
	defer ticker.Stop()
	for range ticker.C {
		jobsMu.Lock()
		before := len(jobs)
		for id, j := range jobs {
			if !j.completedAt.IsZero() && time.Since(j.completedAt) > ttl {
				delete(jobs, id)
			}
		}
		after := len(jobs)
		jobsMu.Unlock()
		if before != after {
			log.Printf("[INFO] Job cleanup: %d -> %d jobs", before, after)
		}
	}
}
