package model

import (
	"crypto/sha256"
	"fmt"
	"time"
)

// MSInfo は機体情報（画像URL → 機体名のマッピング）
type MSInfo struct {
	Name     string
	ImageURL string
	Cost     int `json:",omitempty"`
}

// PlayerScore はスコア
type PlayerScore struct {
	City            string
	Name            string
	Win             bool
	MsImageURL      string // 機体画像URL
	MsName          string
	Score           int
	Kills           int
	Deaths          int
	GiveDamage      int
	ReceiveDamage   int
	ExDamage        int
	MsProficiency   string // ランク(master, gold2, silver5等)
	TeamName        string // チーム名
	PlayerLevelURL  string // 称号画像URL
	RankBadgeURL    string // 称号バッジURL
	ProfileURL      string // プロフィールページURL
	ShuffleGradeURL string // シャッフル階級画像URL
	TeamGradeURL    string // チーム(固定)階級画像URL
	ScoreRanking    int    // 試合内スコア順位(1-4)
	ArcadeName      string // プレイ店舗名
}

// MatchEvent は試合経過の1イベント
type MatchEvent struct {
	Group    string  `json:"group"`     // team1-1, team1-2, team2-1, team2-2
	StartSec float64 `json:"start_sec"` // 開始時間(秒)
	EndSec   float64 `json:"end_sec"`   // 終了時間(秒、pointの場合は0)
	ClassName string `json:"class_name"` // ex, exbst-f, exbst-s, exbst-e, ov, exbst-ov
	IsPoint  bool    `json:"is_point"`  // 被撃墜イベントか
}

// MatchTimeline は試合全体の経過データ
type MatchTimeline struct {
	Events     []MatchEvent `json:"events"`
	GameEndSec float64      `json:"game_end_sec"`
}

// DatedScore は日付付きスコア
type DatedScore struct {
	PlayerNo      int
	Datetime      time.Time
	PlayerScore   PlayerScore
	MatchTimeline *MatchTimeline // 試合経過(PlayerNo==1のときのみセット、4人で共有)
}

// TagPartner はタッグ戦歴の固定相方情報
type TagPartner struct {
	TeamName   string
	PlayerName string
}

// JobStatus はジョブの状態
type JobStatus string

const (
	StatusPending   JobStatus = "pending"
	StatusScraping  JobStatus = "scraping"
	StatusAnalyzing JobStatus = "analyzing"
	StatusDone      JobStatus = "done"
	StatusError     JobStatus = "error"
)

// JobSnapshot はジョブ状態のスナップショット
type JobSnapshot struct {
	ID                string
	Status            JobStatus
	Message           string
	Progress          int
	ProgressTotal     int
	Report            string
	PreliminaryReport string
	Error             string
	PartialData       bool
	UserKey           string
}

// DatedScores は日付付きスコアのリスト
type DatedScores []DatedScore

// UserKey はユーザー名（メールアドレス）からユーザー固有のキーを生成する。
// SHA256ハッシュの先頭8バイト（16進数16文字）を返す。
func UserKey(username string) string {
	hash := sha256.Sum256([]byte(username))
	return fmt.Sprintf("%x", hash[:8])
}
