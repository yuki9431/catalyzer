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
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	fs "github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/gradelist"
	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/mslist"
	"github.com/yuki9431/catalyzer/internal/scraper"
)

// DefaultMSListPath はデフォルトのMSリストパス
const DefaultMSListPath = "data/ms_list.json"

// DefaultGradeListPath はデフォルトのグレードリストパス
const DefaultGradeListPath = "data/grade_list.json"

// prelimBatchSize はスクレイピング中に速報レポートを更新する間隔（試合数）
const prelimBatchSize = 20

// prelimFirstBatchSize は初回速報レポートを発火する試合数。
// 初回だけ早く画面を表示し、以降はprelimBatchSize間隔で更新する（分析の頻発を避ける）
const prelimFirstBatchSize = 5

// Job はバックグラウンドジョブの情報
type Job struct {
	ID                 string           `json:"id"`
	Status             model.JobStatus  `json:"status"`
	Message            string           `json:"message,omitempty"`
	Progress           int              `json:"progress,omitempty"`
	ProgressTotal      int              `json:"progress_total,omitempty"`
	Report             string           `json:"report,omitempty"`
	PreliminaryReport  string           `json:"preliminary_report,omitempty"`
	PreliminaryVersion int              `json:"preliminary_version,omitempty"`
	Error              string           `json:"error,omitempty"`
	PartialData        bool             `json:"partial_data,omitempty"`
	LoggedIn           bool             `json:"logged_in,omitempty"`
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
		ID:                 j.ID,
		Status:             j.Status,
		Message:            j.Message,
		Progress:           j.Progress,
		ProgressTotal:      j.ProgressTotal,
		Report:             j.Report,
		PreliminaryReport:  j.PreliminaryReport,
		PreliminaryVersion: j.PreliminaryVersion,
		Error:              j.Error,
		PartialData:        j.PartialData,
		LoggedIn:           j.LoggedIn,
		UserKey:            j.UserKey,
	}
}

// On403Func は403検出時に呼び出されるコールバック型
type On403Func func(userHash string)

// Run はスクレイピング→分析を実行し、レポートをジョブに保存する
func Run(j *Job, username, password string, on403 ...On403Func) {
	jobsMu.Lock()
	j.UserKey = model.UserKey(username)
	jobsMu.Unlock()
	updateStatus(j, model.StatusScraping)

	tmpDir, err := os.MkdirTemp("", "exvs-*")
	if err != nil {
		setError(j, "内部エラーが発生しました", fmt.Sprintf("failed to create temp dir: %v", err))
		return
	}
	defer os.RemoveAll(tmpDir)

	jsonPath := filepath.Join(tmpDir, "scores.json")

	// キャッシュされたレポートがあれば即座に速報レポートとして表示
	cachedReport, err := fs.LoadReportCache(j.UserKey)
	if err != nil {
		log.Printf("[WARN] Failed to load cached report: %v", err)
	}
	if cachedReport != "" {
		jobsMu.Lock()
		j.PreliminaryReport = cachedReport
		j.PreliminaryVersion++
		jobsMu.Unlock()
		log.Printf("[INFO] Job %s: cached preliminary report ready", j.ID)
	}

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

		// キャッシュがない場合のみ、既存データから速報レポートを生成
		if cachedReport == "" {
			if err := saveScoresJSON(existingScores, jsonPath); err != nil {
				log.Printf("[WARN] Failed to generate JSON for preliminary report: %v", err)
			} else {
				prelimReport := runAnalysis(jsonPath, tmpDir, cachedTagPartnersPath)
				if prelimReport != "" {
					jobsMu.Lock()
					j.PreliminaryReport = prelimReport
					j.PreliminaryVersion++
					jobsMu.Unlock()
					log.Printf("[INFO] Job %s: preliminary report ready", j.ID)
				}
			}
		}
	}

	// スクレイピング
	log.Printf("[INFO] Scraping for user (hash: %s)", model.UserKey(username))
	onProgress := func(current, total int) {
		jobsMu.Lock()
		j.Message = "戦歴データを取得中"
		j.Progress = current
		// totalは単調増加のみ反映。Phase2の遅延ゴルーチンがtotal=0を投げてもバーをちらつかせない
		if total > j.ProgressTotal {
			j.ProgressTotal = total
		}
		jobsMu.Unlock()
	}

	// 同梱のMSリストから機体名マッピングを読み込み（速報・最終レポート両方で使用）
	msList, err := mslist.LoadMSList(DefaultMSListPath)
	if err != nil {
		log.Printf("[WARN] MS list not found, MS names will be empty")
	}
	msMap := mslist.BuildMSNameMap(msList)

	// 20試合ごとに速報レポートを段階的に更新するコールバック
	var batchAnalysisMu sync.Mutex
	var batchWg sync.WaitGroup
	defer batchWg.Wait()
	onBatchReady := func(batchScores model.DatedScores) {
		if !batchAnalysisMu.TryLock() {
			return
		}
		batchWg.Add(1)
		go func() {
			defer batchAnalysisMu.Unlock()
			defer batchWg.Done()

			mslist.FillMsNames(batchScores, msMap)
			merged := mergeScores(existingScores, batchScores)

			batchDir, err := os.MkdirTemp("", "exvs-batch-*")
			if err != nil {
				log.Printf("[WARN] Failed to create batch temp dir: %v", err)
				return
			}
			defer os.RemoveAll(batchDir)

			batchPath := filepath.Join(batchDir, "scores.json")
			if err := saveScoresJSON(merged, batchPath); err != nil {
				log.Printf("[WARN] Failed to save batch JSON: %v", err)
				return
			}

			report := runAnalysis(batchPath, batchDir, cachedTagPartnersPath)
			if report != "" {
				jobsMu.Lock()
				j.PreliminaryReport = report
				j.PreliminaryVersion++
				jobsMu.Unlock()
				log.Printf("[INFO] Job %s: incremental preliminary report ready (%d scores)", j.ID, len(merged))
			}
		}()
	}

	scrapingOpt := scraper.ScrapingOption{
		OnProgress:     onProgress,
		OnBatchReady:   onBatchReady,
		BatchSize:      prelimBatchSize,
		FirstBatchSize: prelimFirstBatchSize,
		OnLoginSuccess: func() {
			jobsMu.Lock()
			j.LoggedIn = true
			jobsMu.Unlock()
			log.Printf("[INFO] Job %s: login succeeded", j.ID)
		},
	}
	if len(backfillDates) > 0 {
		scrapingOpt.BackfillDates = backfillDates
	}

	var datedScores model.DatedScores
	var jar http.CookieJar
	datedScores, jar, err = scraper.ScrapingWithOption(username, password, since, scrapingOpt)
	// 403の場合でも途中データがあれば保存・分析を続行する
	is403WithPartialData := errors.Is(err, scraper.ErrAccessDenied) && len(datedScores) > 0
	if err != nil && !is403WithPartialData {
		switch {
		case errors.Is(err, scraper.ErrLoginFailed):
			setError(j, "ログインに失敗しました。メールアドレスとパスワードを確認してください。", err.Error())
		case errors.Is(err, scraper.ErrAccessDenied):
			setError(j, "対戦履歴ページへのアクセスが拒否されました。ブラウザからガンダムモバイル(https://web.vsmobile.jp)にログインし、対戦履歴が閲覧できるか確認してください。", err.Error())
			if len(on403) > 0 && on403[0] != nil {
				on403[0](model.UserKey(username))
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
			on403[0](model.UserKey(username))
		}
	}
	if len(datedScores) == 0 && !exists {
		setError(j, "戦績データが見つかりませんでした", "no scores found")
		return
	}

	// 新規データがない場合はタッグ情報を付与して再分析する
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
				fs.SaveTagPartners(j.UserKey, tagPartners)
			}
		} else {
			log.Printf("[INFO] No tag partners found (no new data path), using cached")
			tagPartnersPath = cachedTagPartnersPath
		}

		// キャッシュ利用時はjsonPathが未生成なので既存データから生成
		if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
			if err := saveScoresJSON(existingScores, jsonPath); err != nil {
				log.Printf("[WARN] Failed to save scores JSON for re-analysis: %v", err)
			}
		}

		finalReport := j.PreliminaryReport
		report := runAnalysis(jsonPath, tmpDir, tagPartnersPath)
		if report != "" {
			finalReport = report
		}

		jobsMu.Lock()
		j.Status = model.StatusDone
		j.Report = finalReport
		j.completedAt = time.Now()
		jobsMu.Unlock()
		fs.SaveReportCache(j.UserKey, finalReport)
		log.Printf("[INFO] Job %s completed (no new data)", j.ID)
		return
	}

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

	// 既存 + 新規をメモリ上でマージ（Firestoreの再読み取りを省略）
	allScores := mergeScores(existingScores, datedScores)

	if err := os.Remove(jsonPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[WARN] Failed to remove temp JSON: %v", err)
	}
	if err := saveScoresJSON(allScores, jsonPath); err != nil {
		setError(j, "内部エラーが発生しました", fmt.Sprintf("failed to save JSON: %v", err))
		return
	}

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
				// Firestoreにtag_partnersを書き込み
				fs.SaveTagPartners(j.UserKey, tagPartners)
			}
		} else {
			log.Printf("[INFO] No tag partners found")
		}
	}

	// Python分析実行
	updateStatus(j, model.StatusAnalyzing)
	report := runAnalysis(jsonPath, tmpDir, tagPartnersPath)
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
	fs.SaveReportCache(j.UserKey, report)
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

	// JSONを生成
	jsonPath := filepath.Join(tmpDir, "scores.json")
	if err := saveScoresJSON(scores, jsonPath); err != nil {
		return "", fmt.Errorf("failed to generate JSON: %w", err)
	}

	// Firestoreからタッグ相方情報を読み取り
	var tagPartnersPath string
	partners, err := fs.LoadTagPartners(userKey)
	if err != nil {
		log.Printf("[WARN] Failed to load tag partners for custom period: %v", err)
	}
	if len(partners) > 0 {
		tagPartnersPath = filepath.Join(tmpDir, "tag_partners.json")
		if err := saveTagPartners(partners, tagPartnersPath); err != nil {
			log.Printf("[WARN] Failed to save tag partners for custom period: %v", err)
			tagPartnersPath = ""
		}
	}

	args := []string{"scripts/analyze.py", jsonPath, "--start", start, "--end", end, "--ms-list", DefaultMSListPath}
	if tagPartnersPath != "" {
		args = append(args, "--tag-partners", tagPartnersPath)
	}

	cmd := exec.Command("python3", args...)
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

// runAnalysis はPython分析を実行してJSON形式のレポートを返す。失敗時は空文字を返す。
func runAnalysis(jsonPath, tmpDir, tagPartnersPath string) string {
	args := []string{"scripts/analyze.py", jsonPath, "--ms-list", DefaultMSListPath}
	if tagPartnersPath != "" {
		args = append(args, "--tag-partners", tagPartnersPath)
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

// matchJSON はPython分析用の試合単位JSON構造
type matchJSON struct {
	Datetime   string       `json:"datetime"`
	GameEndSec float64      `json:"game_end_sec"`
	Players    []playerJSON `json:"players"`
}

// playerJSON はPython分析用のプレイヤー情報
type playerJSON struct {
	PlayerNo        int          `json:"player_no"`
	Name            string       `json:"name"`
	City            string       `json:"city"`
	Win             bool         `json:"win"`
	MsName          string       `json:"ms_name"`
	MsImageURL      string       `json:"ms_image_url"`
	Score           int          `json:"score"`
	Kills           int          `json:"kills"`
	Deaths          int          `json:"deaths"`
	GiveDamage      int          `json:"give_damage"`
	ReceiveDamage   int          `json:"receive_damage"`
	ExDamage        int          `json:"ex_damage"`
	MsProficiency   string       `json:"ms_proficiency"`
	TeamName        string       `json:"team_name"`
	PlayerLevelURL  string       `json:"player_level_url"`
	RankBadgeURL    string       `json:"rank_badge_url"`
	ProfileURL      string       `json:"profile_url"`
	ShuffleGradeURL string       `json:"shuffle_grade_url"`
	TeamGradeURL    string       `json:"team_grade_url"`
	ScoreRanking    int          `json:"score_ranking"`
	ArcadeName      string       `json:"arcade_name"`
	Actions         []actionJSON `json:"actions"`
}

// actionJSON はタイムラインアクション
type actionJSON struct {
	Action         string  `json:"action"`
	ActionStartSec float64 `json:"action_start_sec"`
	ActionEndSec   float64 `json:"action_end_sec"`
}

// saveScoresJSON はDatedScoresを試合単位JSONファイルに保存する（Python分析用）。
func saveScoresJSON(ds model.DatedScores, path string) error {
	groups := make(map[string][]model.DatedScore)
	for _, d := range ds {
		key := d.Datetime.Format(model.MatchKeyFormat)
		groups[key] = append(groups[key], d)
	}

	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	matches := make([]matchJSON, 0, len(keys))
	for _, key := range keys {
		entries := groups[key]
		if len(entries) != 4 {
			continue
		}
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].PlayerNo < entries[j].PlayerNo
		})

		var gameEndSec float64
		var timeline *model.MatchTimeline
		for _, e := range entries {
			if e.MatchTimeline != nil {
				timeline = e.MatchTimeline
				gameEndSec = timeline.GameEndSec
				break
			}
		}

		players := make([]playerJSON, len(entries))
		for i, e := range entries {
			actions := buildPlayerActions(timeline, e.PlayerNo)
			players[i] = playerJSON{
				PlayerNo:        e.PlayerNo,
				Name:            e.PlayerScore.Name,
				City:            e.PlayerScore.City,
				Win:             e.PlayerScore.Win,
				MsName:          e.PlayerScore.MsName,
				MsImageURL:      e.PlayerScore.MsImageURL,
				Score:           e.PlayerScore.Score,
				Kills:           e.PlayerScore.Kills,
				Deaths:          e.PlayerScore.Deaths,
				GiveDamage:      e.PlayerScore.GiveDamage,
				ReceiveDamage:   e.PlayerScore.ReceiveDamage,
				ExDamage:        e.PlayerScore.ExDamage,
				MsProficiency:   e.PlayerScore.MsProficiency,
				TeamName:        e.PlayerScore.TeamName,
				PlayerLevelURL:  e.PlayerScore.PlayerLevelURL,
				RankBadgeURL:    e.PlayerScore.RankBadgeURL,
				ProfileURL:      e.PlayerScore.ProfileURL,
				ShuffleGradeURL: e.PlayerScore.ShuffleGradeURL,
				TeamGradeURL:    e.PlayerScore.TeamGradeURL,
				ScoreRanking:    e.PlayerScore.ScoreRanking,
				ArcadeName:      e.PlayerScore.ArcadeName,
				Actions:         actions,
			}
		}

		matches = append(matches, matchJSON{
			Datetime:   entries[0].Datetime.Format("2006-01-02 15:04"),
			GameEndSec: gameEndSec,
			Players:    players,
		})
	}

	b, err := json.Marshal(matches)
	if err != nil {
		return fmt.Errorf("marshal scores JSON: %w", err)
	}
	return os.WriteFile(path, b, 0644)
}

// buildPlayerActions はMatchTimelineから特定プレイヤーのアクションを抽出する。
func buildPlayerActions(timeline *model.MatchTimeline, playerNo int) []actionJSON {
	if timeline == nil {
		return []actionJSON{}
	}

	groupName := ""
	switch playerNo {
	case 1:
		groupName = "team1-1"
	case 2:
		groupName = "team1-2"
	case 3:
		groupName = "team2-1"
	case 4:
		groupName = "team2-2"
	}

	var actions []actionJSON
	for _, e := range timeline.Events {
		if e.Group != groupName {
			continue
		}
		action := e.ClassName
		if e.IsPoint {
			action = "death"
		}
		actions = append(actions, actionJSON{
			Action:         action,
			ActionStartSec: e.StartSec,
			ActionEndSec:   e.EndSec,
		})
	}
	if actions == nil {
		return []actionJSON{}
	}
	return actions
}

// mergeScores は既存のscoresに新規scoresをマージする。
// バックフィル時に同じdatetimeのレコードがある場合は新規側で上書きする。
func mergeScores(existing, newScores model.DatedScores) model.DatedScores {
	newKeys := make(map[string]bool)
	for _, s := range newScores {
		key := s.Datetime.Format(model.MatchKeyFormat)
		newKeys[key] = true
	}

	merged := make(model.DatedScores, 0, len(existing)+len(newScores))
	for _, s := range existing {
		key := s.Datetime.Format(model.MatchKeyFormat)
		if !newKeys[key] {
			merged = append(merged, s)
		}
	}
	merged = append(merged, newScores...)

	sort.Slice(merged, func(i, j int) bool {
		return merged[i].Datetime.Before(merged[j].Datetime)
	})
	return merged
}
