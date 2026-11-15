package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"golang.org/x/time/rate"
)

const (
	noteTextMax    = 500
	noteCountMax   = 2000
	notePinnedMax  = 3
	noteMSMax      = 64
	noteBodyMax    = 8 << 10
	notesNotFound  = "メモが見つかりません"
	notesNoSession = "ログイン状態が保持されていません"
)

// メモの書き込みはユーザーごとにバースト30・2秒に1回回復。インメモリなのでインスタンスごとに数える
var notesWriteLimiter = newRateLimiter(rate.Every(2*time.Second), 30)

// notesStore はハンドラが使うメモの永続化操作。
type notesStore interface {
	List(ctx context.Context, userKey string) ([]model.Note, error)
	Create(ctx context.Context, userKey string, n model.Note) error
	Update(ctx context.Context, userKey string, n model.Note) (model.Note, error)
	Delete(ctx context.Context, userKey, id string) error
}

type firestoreNotesStore struct{}

var notesLimits = firestore.NoteLimits{MaxCount: noteCountMax, MaxPinned: notePinnedMax}

func (firestoreNotesStore) List(ctx context.Context, userKey string) ([]model.Note, error) {
	return firestore.ListNotes(ctx, userKey)
}

func (firestoreNotesStore) Create(ctx context.Context, userKey string, n model.Note) error {
	return firestore.CreateNote(ctx, userKey, n, notesLimits)
}

func (firestoreNotesStore) Update(ctx context.Context, userKey string, n model.Note) (model.Note, error) {
	return firestore.UpdateNote(ctx, userKey, n, notesLimits)
}

func (firestoreNotesStore) Delete(ctx context.Context, userKey, id string) error {
	return firestore.DeleteNote(ctx, userKey, id)
}

// notesAPI は /notes 系ハンドラの依存をまとめる。
type notesAPI struct {
	store       notesStore
	loadSession func(token string) (userKey string, encryptedJar []byte, err error)
	limiter     *rateLimiter
	now         func() time.Time
	newID       func() string
}

func newNotesAPI() *notesAPI {
	return &notesAPI{
		store: firestoreNotesStore{}, loadSession: firestore.LoadSession,
		limiter: notesWriteLimiter, now: time.Now, newID: uuid.NewString,
	}
}

type noteRequest struct {
	Kind    string `json:"kind"`
	Text    string `json:"text"`
	EnemyMS string `json:"enemy_ms"`
	MyMS    string `json:"my_ms"`
	Date    string `json:"date"`
	Pinned  bool   `json:"pinned"`
}

type noteJSON struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Text      string `json:"text"`
	EnemyMS   string `json:"enemy_ms"`
	MyMS      string `json:"my_ms"`
	Date      string `json:"date"`
	Pinned    bool   `json:"pinned"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func toNoteJSON(n model.Note) noteJSON {
	return noteJSON{
		ID: n.ID, Kind: n.Kind, Text: n.Text, EnemyMS: n.EnemyMS, MyMS: n.MyMS, Date: n.Date, Pinned: n.Pinned,
		CreatedAt: n.CreatedAt.UTC().Format(time.RFC3339), UpdatedAt: n.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func hasBadControl(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return true
		}
	}
	return false
}

// validateNote は入力を正規化した Note と、400 の文言(通れば "")を返す。
func validateNote(req noteRequest) (model.Note, string) {
	n := model.Note{
		Kind: req.Kind, Text: strings.TrimSpace(strings.ReplaceAll(req.Text, "\r\n", "\n")),
		EnemyMS: strings.TrimSpace(req.EnemyMS), MyMS: strings.TrimSpace(req.MyMS), Date: req.Date, Pinned: req.Pinned,
	}
	switch n.Kind {
	case model.NoteKindEnemy, model.NoteKindDate, model.NoteKindFree:
	default:
		return n, "メモの種類が正しくありません"
	}
	switch {
	case n.Text == "":
		return n, "メモの本文を入力してください"
	case hasBadControl(n.Text) || hasBadControl(n.EnemyMS) || hasBadControl(n.MyMS):
		return n, "使えない文字が含まれています"
	case utf8.RuneCountInString(n.Text) > noteTextMax:
		return n, fmt.Sprintf("メモは%d文字までです", noteTextMax)
	case utf8.RuneCountInString(n.EnemyMS) > noteMSMax || utf8.RuneCountInString(n.MyMS) > noteMSMax:
		return n, "機体名が長すぎます"
	}
	const mismatch = "メモの種類と紐付け先が合いません"
	switch n.Kind {
	case model.NoteKindEnemy:
		if n.EnemyMS == "" {
			return n, "敵機を選んでください"
		}
		if n.Date != "" {
			return n, mismatch
		}
	case model.NoteKindDate:
		if n.EnemyMS != "" || n.MyMS != "" {
			return n, mismatch
		}
		if d, err := time.Parse("2006-01-02", n.Date); err != nil || d.Format("2006-01-02") != n.Date {
			return n, "日付の形式が正しくありません"
		}
	case model.NoteKindFree:
		if n.EnemyMS != "" || n.MyMS != "" || n.Date != "" {
			return n, mismatch
		}
	}
	return n, ""
}

func notesError(w http.ResponseWriter, code int, msg string) {
	sendJSON(w, code, map[string]string{"error": msg})
}

// userKeyOf は Cookie から本人のユーザーキーを解決する。特定できなければ空。
func (a *notesAPI) userKeyOf(r *http.Request) string {
	token := getSessionToken(r)
	if token == "" {
		return ""
	}
	uk, _, err := a.loadSession(token)
	if err != nil {
		log.Printf("[WARN] notes: セッションの読み込みに失敗: %v", err)
		return ""
	}
	return uk
}

// authorize は本人確認と書き込みのレート制限を判定し、通れば userKey を返す。通らなければ応答済みで ok=false。
func (a *notesAPI) authorize(w http.ResponseWriter, r *http.Request, write bool) (userKey string, ok bool) {
	userKey = a.userKeyOf(r)
	if userKey == "" {
		notesError(w, http.StatusUnauthorized, notesNoSession)
		return "", false
	}
	if write && !a.limiter.getLimiter("notes:"+userKey).Allow() {
		notesError(w, http.StatusTooManyRequests, "保存の回数が多すぎます。しばらく待ってからお試しください")
		return "", false
	}
	return userKey, true
}

// requireJSON は Content-Type が application/json でなければ 415 を返す(フォーム送信を断つ)。
func requireJSON(w http.ResponseWriter, r *http.Request) bool {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		notesError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return false
	}
	return true
}

// readNote は本文を読んで検証する。応答済みなら ok=false。
func readNote(w http.ResponseWriter, r *http.Request) (model.Note, bool) {
	var req noteRequest
	r.Body = http.MaxBytesReader(w, r.Body, noteBodyMax)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		notesError(w, http.StatusBadRequest, "Invalid request body")
		return model.Note{}, false
	}
	n, msg := validateNote(req)
	if msg != "" {
		notesError(w, http.StatusBadRequest, msg)
		return model.Note{}, false
	}
	return n, true
}

// storeFailed は保存処理のエラーを HTTP 応答にする。
func storeFailed(w http.ResponseWriter, err error, internalMsg string) {
	switch {
	case errors.Is(err, firestore.ErrNoteNotFound):
		notesError(w, http.StatusNotFound, notesNotFound)
	case errors.Is(err, firestore.ErrNoteLimit):
		notesError(w, http.StatusConflict, fmt.Sprintf("メモは%d件までです。不要なメモを削除してください", noteCountMax))
	case errors.Is(err, firestore.ErrPinLimit):
		notesError(w, http.StatusConflict, fmt.Sprintf("ピン留めは%d件までです", notePinnedMax))
	default:
		log.Printf("[ERROR] notes: %s: %v", internalMsg, err)
		notesError(w, http.StatusInternalServerError, internalMsg)
	}
}

// handleNotes は GET(一覧)と POST(作成)を扱う。
func (a *notesAPI) handleNotes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userKey, ok := a.authorize(w, r, r.Method == http.MethodPost)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()

	if r.Method == http.MethodGet {
		notes, err := a.store.List(ctx, userKey)
		if err != nil {
			storeFailed(w, err, "メモを読み込めませんでした")
			return
		}
		items := make([]noteJSON, len(notes))
		for i, n := range notes {
			items[i] = toNoteJSON(n)
		}
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"user_key": userKey, "notes": items,
			"limits": map[string]int{"text_max": noteTextMax, "count_max": noteCountMax, "pinned_max": notePinnedMax},
		})
		return
	}

	if !requireJSON(w, r) {
		return
	}
	n, ok := readNote(w, r)
	if !ok {
		return
	}
	n.ID = a.newID()
	n.CreatedAt = a.now().Truncate(time.Second)
	n.UpdatedAt = n.CreatedAt
	if err := a.store.Create(ctx, userKey, n); err != nil {
		storeFailed(w, err, "メモを保存できませんでした")
		return
	}
	sendJSON(w, http.StatusCreated, map[string]noteJSON{"note": toNoteJSON(n)})
}

// handleNote は /notes/{id} の PUT(編集)と DELETE(削除)を扱う。
func (a *notesAPI) handleNote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userKey, ok := a.authorize(w, r, true)
	if !ok {
		return
	}
	if r.Method == http.MethodPut && !requireJSON(w, r) {
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/notes/")
	if parsed, err := uuid.Parse(id); err != nil || parsed.String() != id {
		notesError(w, http.StatusNotFound, notesNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()

	if r.Method == http.MethodDelete {
		if err := a.store.Delete(ctx, userKey, id); err != nil {
			storeFailed(w, err, "メモを削除できませんでした")
			return
		}
		sendJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	n, ok := readNote(w, r)
	if !ok {
		return
	}
	n.ID = id
	n.UpdatedAt = a.now().Truncate(time.Second)
	saved, err := a.store.Update(ctx, userKey, n)
	if err != nil {
		storeFailed(w, err, "メモを保存できませんでした")
		return
	}
	sendJSON(w, http.StatusOK, map[string]noteJSON{"note": toNoteJSON(saved)})
}

// registerNotes はメモのエンドポイントを mux に登録する。
func registerNotes(mux *http.ServeMux) {
	a := newNotesAPI()
	mux.HandleFunc("/notes", a.handleNotes)
	mux.HandleFunc("/notes/", a.handleNote)
}
