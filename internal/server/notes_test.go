package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"golang.org/x/time/rate"
)

// fakeNotesStore はユーザーごとのメモを持つ。err を入れると全操作がそれを返す。
type fakeNotesStore struct {
	notes map[string]map[string]model.Note
	err   error
	calls int
}

func newFakeNotesStore() *fakeNotesStore {
	return &fakeNotesStore{notes: map[string]map[string]model.Note{}}
}

func (f *fakeNotesStore) user(uk string) map[string]model.Note {
	if f.notes[uk] == nil {
		f.notes[uk] = map[string]model.Note{}
	}
	return f.notes[uk]
}

func (f *fakeNotesStore) List(_ context.Context, uk string) ([]model.Note, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	var out []model.Note
	for _, n := range f.user(uk) {
		out = append(out, n)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *fakeNotesStore) Create(_ context.Context, uk string, n model.Note) error {
	f.calls++
	if f.err != nil {
		return f.err
	}
	f.user(uk)[n.ID] = n
	return nil
}

func (f *fakeNotesStore) Update(_ context.Context, uk string, n model.Note) (model.Note, error) {
	f.calls++
	if f.err != nil {
		return model.Note{}, f.err
	}
	old, ok := f.user(uk)[n.ID]
	if !ok {
		return model.Note{}, firestore.ErrNoteNotFound
	}
	n.CreatedAt = old.CreatedAt
	f.user(uk)[n.ID] = n
	return n, nil
}

func (f *fakeNotesStore) Delete(_ context.Context, uk, id string) error {
	f.calls++
	if f.err != nil {
		return f.err
	}
	if _, ok := f.user(uk)[id]; !ok {
		return firestore.ErrNoteNotFound
	}
	delete(f.user(uk), id)
	return nil
}

const (
	notesTokenA = "token-a"
	notesTokenB = "token-b"
	// loadSession が空の userKey を err なしで返すトークン
	notesTokenEmpty = "token-empty"
	notesUUID       = "123e4567-e89b-42d3-a456-426614174000"
)

func newTestNotesAPI(store *fakeNotesStore) (*notesAPI, *time.Time) {
	clock := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	n := 0
	a := &notesAPI{
		store: store,
		loadSession: func(token string) (string, []byte, error) {
			switch token {
			case notesTokenA:
				return "userA", nil, nil
			case notesTokenB:
				return "userB", nil, nil
			case notesTokenEmpty:
				return "", nil, nil
			}
			return "", nil, errors.New("unknown session")
		},
		limiter: newRateLimiter(rate.Every(2*time.Second), 30),
		now:     func() time.Time { return clock },
		newID: func() string {
			n++
			return fmt.Sprintf("123e4567-e89b-42d3-a456-%012d", n)
		},
	}
	return a, &clock
}

func notesReq(method, path, token, body string) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		r.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	}
	return r
}

// serveNotes は /notes と /notes/ の振り分けを本番の mux と同じ形で行う。
func serveNotes(a *notesAPI, r *http.Request) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	mux.HandleFunc("/notes", a.handleNotes)
	mux.HandleFunc("/notes/", a.handleNote)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	return rec
}

func errorOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var b struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("JSON でない応答: %q", rec.Body.String())
	}
	return b.Error
}

const validNoteBody = `{"kind":"free","text":"メモ"}`

func TestNotesRequireSession(t *testing.T) {
	store := newFakeNotesStore()
	a, _ := newTestNotesAPI(store)
	targets := []struct{ method, path string }{
		{http.MethodGet, "/notes"}, {http.MethodPost, "/notes"},
		{http.MethodPut, "/notes/" + notesUUID}, {http.MethodDelete, "/notes/" + notesUUID},
	}
	for _, tg := range targets {
		for name, token := range map[string]string{"Cookie なし": "", "解決できないセッション": "unknown", "userKey が空のセッション": notesTokenEmpty} {
			t.Run(tg.method+" "+tg.path+" "+name, func(t *testing.T) {
				rec := serveNotes(a, notesReq(tg.method, tg.path+"?user_key=userA", token, validNoteBody))
				if rec.Code != http.StatusUnauthorized {
					t.Fatalf("status = %d, want 401", rec.Code)
				}
				if got := errorOf(t, rec); got != "ログイン状態が保持されていません" {
					t.Errorf("error = %q", got)
				}
			})
		}
	}
	if store.calls != 0 {
		t.Errorf("store を %d 回呼んだ", store.calls)
	}
}

func TestNotesMethods(t *testing.T) {
	a, _ := newTestNotesAPI(newFakeNotesStore())
	for _, tc := range []struct{ method, path string }{
		{http.MethodPatch, "/notes"}, {http.MethodDelete, "/notes"}, {http.MethodPut, "/notes"},
		{http.MethodGet, "/notes/" + notesUUID}, {http.MethodPost, "/notes/" + notesUUID},
	} {
		// Cookie 無しでも 401 より先に 405 になる
		rec := serveNotes(a, notesReq(tc.method, tc.path, "", ""))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s = %d, want 405", tc.method, tc.path, rec.Code)
		}
	}
}

func TestNotesContentType(t *testing.T) {
	store := newFakeNotesStore()
	a, _ := newTestNotesAPI(store)
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/notes"}, {http.MethodPut, "/notes/" + notesUUID},
	} {
		for _, ct := range []string{"", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"} {
			r := notesReq(tc.method, tc.path, notesTokenA, validNoteBody)
			if ct == "" {
				r.Header.Del("Content-Type")
			} else {
				r.Header.Set("Content-Type", ct)
			}
			if rec := serveNotes(a, r); rec.Code != http.StatusUnsupportedMediaType {
				t.Errorf("%s %q = %d, want 415", tc.method, ct, rec.Code)
			}
		}
		if store.calls != 0 {
			t.Errorf("%s: 415 で store を %d 回呼んだ", tc.method, store.calls)
		}
		r := notesReq(tc.method, tc.path, notesTokenA, validNoteBody)
		r.Header.Set("Content-Type", "application/json; charset=utf-8")
		if rec := serveNotes(a, r); rec.Code == http.StatusUnsupportedMediaType {
			t.Errorf("%s charset 付きの JSON が 415", tc.method)
		}
		store.calls = 0
	}
}

func TestNotesValidate(t *testing.T) {
	long := func(n int) string { return strings.Repeat("あ", n) }
	tests := []struct {
		name    string
		req     noteRequest
		wantMsg string
		want    model.Note // wantMsg が空のときの正規化結果(比較する項目だけ)
	}{
		{"空", noteRequest{Kind: "free", Text: ""}, "メモの本文を入力してください", model.Note{}},
		{"空白だけ", noteRequest{Kind: "free", Text: " \t\n　"}, "メモの本文を入力してください", model.Note{}},
		{"500字は通る", noteRequest{Kind: "free", Text: long(500)}, "", model.Note{Kind: "free", Text: long(500)}},
		{"501字", noteRequest{Kind: "free", Text: long(501)}, "メモは500文字までです", model.Note{}},
		{"絵文字500字は通る", noteRequest{Kind: "free", Text: strings.Repeat("😀", 500)}, "", model.Note{Kind: "free", Text: strings.Repeat("😀", 500)}},
		{"絵文字501字", noteRequest{Kind: "free", Text: strings.Repeat("😀", 501)}, "メモは500文字までです", model.Note{}},
		{"CRLF は LF・前後の空白は除く", noteRequest{Kind: "free", Text: "  a\r\nb\r\n "}, "", model.Note{Kind: "free", Text: "a\nb"}},
		{"改行・タブは通る", noteRequest{Kind: "free", Text: "a\tb\nc"}, "", model.Note{Kind: "free", Text: "a\tb\nc"}},
		{"制御文字", noteRequest{Kind: "free", Text: "a\x00b"}, "使えない文字が含まれています", model.Note{}},
		{"単独の CR", noteRequest{Kind: "free", Text: "a\rb"}, "使えない文字が含まれています", model.Note{}},
		{"enemy で enemy_ms が空", noteRequest{Kind: "enemy", Text: "x"}, "敵機を選んでください", model.Note{}},
		{"enemy は通る(自機は任意)", noteRequest{Kind: "enemy", Text: "x", EnemyMS: " ガンダム ", MyMS: "ユニコーン"}, "", model.Note{Kind: "enemy", Text: "x", EnemyMS: "ガンダム", MyMS: "ユニコーン"}},
		{"enemy に date", noteRequest{Kind: "enemy", Text: "x", EnemyMS: "a", Date: "2026-06-15"}, "メモの種類と紐付け先が合いません", model.Note{}},
		{"date の形式不正", noteRequest{Kind: "date", Text: "x", Date: "2026-13-01"}, "日付の形式が正しくありません", model.Note{}},
		{"date が空", noteRequest{Kind: "date", Text: "x"}, "日付の形式が正しくありません", model.Note{}},
		{"date は通る", noteRequest{Kind: "date", Text: "x", Date: "2026-06-15", Pinned: true}, "", model.Note{Kind: "date", Text: "x", Date: "2026-06-15", Pinned: true}},
		{"date に enemy_ms", noteRequest{Kind: "date", Text: "x", Date: "2026-06-15", EnemyMS: "a"}, "メモの種類と紐付け先が合いません", model.Note{}},
		{"free に enemy_ms", noteRequest{Kind: "free", Text: "x", EnemyMS: "a"}, "メモの種類と紐付け先が合いません", model.Note{}},
		{"未知の kind", noteRequest{Kind: "other", Text: "x"}, "メモの種類が正しくありません", model.Note{}},
		{"機体名65字", noteRequest{Kind: "enemy", Text: "x", EnemyMS: long(65)}, "機体名が長すぎます", model.Note{}},
		{"機体名64字は通る", noteRequest{Kind: "enemy", Text: "x", EnemyMS: long(64)}, "", model.Note{Kind: "enemy", Text: "x", EnemyMS: long(64)}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, msg := validateNote(tc.req)
			if msg != tc.wantMsg {
				t.Fatalf("msg = %q, want %q", msg, tc.wantMsg)
			}
			if msg == "" && (got.Kind != tc.want.Kind || got.Text != tc.want.Text || got.EnemyMS != tc.want.EnemyMS ||
				got.MyMS != tc.want.MyMS || got.Date != tc.want.Date || got.Pinned != tc.want.Pinned) {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}

	t.Run("HTTP では 400", func(t *testing.T) {
		a, _ := newTestNotesAPI(newFakeNotesStore())
		rec := serveNotes(a, notesReq(http.MethodPost, "/notes", notesTokenA, `{"kind":"free","text":""}`))
		if rec.Code != http.StatusBadRequest || errorOf(t, rec) != "メモの本文を入力してください" {
			t.Errorf("= %d %s", rec.Code, rec.Body.String())
		}
		rec = serveNotes(a, notesReq(http.MethodPost, "/notes", notesTokenA, `{"kind":"free","text":"`+strings.Repeat("a", 9000)+`"}`))
		if rec.Code != http.StatusBadRequest || errorOf(t, rec) != "Invalid request body" {
			t.Errorf("8KiB 超 = %d %s", rec.Code, rec.Body.String())
		}
		rec = serveNotes(a, notesReq(http.MethodPost, "/notes", notesTokenA, `{`))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("壊れた JSON = %d", rec.Code)
		}
	})
}

func decodeNote(t *testing.T, rec *httptest.ResponseRecorder) noteJSON {
	t.Helper()
	var b struct {
		Note noteJSON `json:"note"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("JSON でない応答: %q", rec.Body.String())
	}
	return b.Note
}

func listNotes(t *testing.T, a *notesAPI, token string) []noteJSON {
	t.Helper()
	rec := serveNotes(a, notesReq(http.MethodGet, "/notes", token, ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body.String())
	}
	var b struct {
		Notes  []noteJSON     `json:"notes"`
		Limits map[string]int `json:"limits"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if b.Limits["text_max"] != noteTextMax || b.Limits["count_max"] != noteCountMax || b.Limits["pinned_max"] != notePinnedMax {
		t.Errorf("limits = %v", b.Limits)
	}
	if b.Notes == nil {
		t.Error("notes が null(空配列であるべき)")
	}
	return b.Notes
}

func TestNotesCRUD(t *testing.T) {
	a, clock := newTestNotesAPI(newFakeNotesStore())

	if got := listNotes(t, a, notesTokenA); len(got) != 0 {
		t.Fatalf("最初は空: %v", got)
	}

	rec := serveNotes(a, notesReq(http.MethodPost, "/notes", notesTokenA, `{"kind":"enemy","text":"着地を狙う","enemy_ms":"ガンダム"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST = %d %s", rec.Code, rec.Body.String())
	}
	created := decodeNote(t, rec)
	if created.ID == "" || created.Text != "着地を狙う" || created.CreatedAt != "2026-06-01T12:00:00Z" || created.CreatedAt != created.UpdatedAt {
		t.Fatalf("作成結果 = %+v", created)
	}
	if got := listNotes(t, a, notesTokenA); len(got) != 1 || got[0].ID != created.ID {
		t.Fatalf("GET に含まれない: %v", got)
	}

	*clock = clock.Add(time.Hour)
	rec = serveNotes(a, notesReq(http.MethodPut, "/notes/"+created.ID, notesTokenA, `{"kind":"enemy","text":"変更後","enemy_ms":"ガンダム","pinned":true}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
	updated := decodeNote(t, rec)
	if updated.Text != "変更後" || !updated.Pinned || updated.CreatedAt != created.CreatedAt || updated.UpdatedAt != "2026-06-01T13:00:00Z" {
		t.Fatalf("更新結果 = %+v", updated)
	}

	// ユーザー境界: 別ユーザーには見えず、更新も削除もできない
	if got := listNotes(t, a, notesTokenB); len(got) != 0 {
		t.Errorf("別ユーザーに見える: %v", got)
	}
	rec = serveNotes(a, notesReq(http.MethodPut, "/notes/"+created.ID, notesTokenB, validNoteBody))
	if rec.Code != http.StatusNotFound || errorOf(t, rec) != "メモが見つかりません" {
		t.Errorf("別ユーザーの PUT = %d %s", rec.Code, rec.Body.String())
	}
	if rec = serveNotes(a, notesReq(http.MethodDelete, "/notes/"+created.ID, notesTokenB, "")); rec.Code != http.StatusNotFound {
		t.Errorf("別ユーザーの DELETE = %d", rec.Code)
	}
	if got := listNotes(t, a, notesTokenA); len(got) != 1 || got[0].Text != "変更後" {
		t.Errorf("別ユーザーの操作で変わった: %v", got)
	}
	t.Run("user_key クエリで他人のメモは見えない", func(t *testing.T) {
		recB := serveNotes(a, notesReq(http.MethodGet, "/notes?user_key=userA", notesTokenB, ""))
		if recB.Code != http.StatusOK {
			t.Fatalf("GET = %d %s", recB.Code, recB.Body.String())
		}
		var b struct {
			Notes []noteJSON `json:"notes"`
		}
		if err := json.Unmarshal(recB.Body.Bytes(), &b); err != nil || len(b.Notes) != 0 {
			t.Errorf("B の一覧 = %s (err %v)", recB.Body.String(), err)
		}
	})

	rec = serveNotes(a, notesReq(http.MethodDelete, "/notes/"+created.ID, notesTokenA, ""))
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Fatalf("DELETE = %d %s", rec.Code, rec.Body.String())
	}
	if got := listNotes(t, a, notesTokenA); len(got) != 0 {
		t.Errorf("削除後も残っている: %v", got)
	}
}

func TestNotesStoreErrors(t *testing.T) {
	store := newFakeNotesStore()
	a, _ := newTestNotesAPI(store)
	path := "/notes/" + notesUUID

	tests := []struct {
		name     string
		err      error
		method   string
		path     string
		body     string
		wantCode int
		wantMsg  string
	}{
		{"件数上限", firestore.ErrNoteLimit, http.MethodPost, "/notes", validNoteBody, 409, "メモは2000件までです。不要なメモを削除してください"},
		{"ピン上限", firestore.ErrPinLimit, http.MethodPut, path, validNoteBody, 409, "ピン留めは3件までです"},
		{"対象なし PUT", firestore.ErrNoteNotFound, http.MethodPut, path, validNoteBody, 404, "メモが見つかりません"},
		{"対象なし DELETE", firestore.ErrNoteNotFound, http.MethodDelete, path, "", 404, "メモが見つかりません"},
		{"GET の内部エラー", errors.New("boom"), http.MethodGet, "/notes", "", 500, "メモを読み込めませんでした"},
		{"POST の内部エラー", errors.New("boom"), http.MethodPost, "/notes", validNoteBody, 500, "メモを保存できませんでした"},
		{"PUT の内部エラー", errors.New("boom"), http.MethodPut, path, validNoteBody, 500, "メモを保存できませんでした"},
		{"DELETE の内部エラー", errors.New("boom"), http.MethodDelete, path, "", 500, "メモを削除できませんでした"},
		{"ラップされた上限エラー", fmt.Errorf("tx: %w", firestore.ErrPinLimit), http.MethodPost, "/notes", validNoteBody, 409, "ピン留めは3件までです"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store.err = tc.err
			rec := serveNotes(a, notesReq(tc.method, tc.path, notesTokenA, tc.body))
			if rec.Code != tc.wantCode || errorOf(t, rec) != tc.wantMsg {
				t.Errorf("= %d %q, want %d %q", rec.Code, errorOf(t, rec), tc.wantCode, tc.wantMsg)
			}
		})
	}

	store.err = nil
	store.calls = 0
	for _, p := range []string{"/notes/not-a-uuid", "/notes/" + notesUUID + "/extra", "/notes/", "/notes/" + strings.ToUpper(notesUUID)} {
		for _, m := range []string{http.MethodPut, http.MethodDelete} {
			rec := serveNotes(a, notesReq(m, p, notesTokenA, validNoteBody))
			if rec.Code != http.StatusNotFound || errorOf(t, rec) != "メモが見つかりません" {
				t.Errorf("%s %s = %d %s", m, p, rec.Code, rec.Body.String())
			}
		}
	}
	if store.calls != 0 {
		t.Errorf("不正な id で store を %d 回呼んだ", store.calls)
	}
}

func TestNotesRateLimit(t *testing.T) {
	a, _ := newTestNotesAPI(newFakeNotesStore())
	for i := 1; i <= 30; i++ {
		if rec := serveNotes(a, notesReq(http.MethodPost, "/notes", notesTokenA, validNoteBody)); rec.Code != http.StatusCreated {
			t.Fatalf("%d 回目 = %d", i, rec.Code)
		}
	}
	rec := serveNotes(a, notesReq(http.MethodPost, "/notes", notesTokenA, validNoteBody))
	if rec.Code != http.StatusTooManyRequests || errorOf(t, rec) != "保存の回数が多すぎます。しばらく待ってからお試しください" {
		t.Fatalf("31 回目 = %d %s", rec.Code, rec.Body.String())
	}
	if rec := serveNotes(a, notesReq(http.MethodDelete, "/notes/"+notesUUID, notesTokenA, "")); rec.Code != http.StatusTooManyRequests {
		t.Errorf("DELETE も数える: %d", rec.Code)
	}
	if rec := serveNotes(a, notesReq(http.MethodGet, "/notes", notesTokenA, "")); rec.Code != http.StatusOK {
		t.Errorf("GET は制限しない: %d", rec.Code)
	}
	if rec := serveNotes(a, notesReq(http.MethodPost, "/notes", notesTokenB, validNoteBody)); rec.Code != http.StatusCreated {
		t.Errorf("別ユーザーは巻き込まれない: %d", rec.Code)
	}
}
