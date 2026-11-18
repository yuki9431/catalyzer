package firestore

import (
	"errors"
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

// 件数の境界は server の noteCountMax(2000)に合わせる。
var testLimits = NoteLimits{MaxCount: 2000, MaxPinned: 3}

func TestNotesCheckCreate(t *testing.T) {
	tests := []struct {
		name        string
		count, pins int
		pinned      bool
		want        error
	}{
		{"1999件なら通る", 1999, 0, false, nil},
		{"2000件で ErrNoteLimit", 2000, 0, false, ErrNoteLimit},
		{"ピン付きで他のピン3件は ErrPinLimit", 10, 3, true, ErrPinLimit},
		{"ピン付きで他のピン2件は通る", 10, 2, true, nil},
		{"ピンなしはピン数を見ない", 10, 3, false, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := checkCreate(tt.count, tt.pins, model.Note{Pinned: tt.pinned}, testLimits)
			if !errors.Is(got, tt.want) {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNotesCheckUpdate(t *testing.T) {
	tests := []struct {
		name      string
		total     int
		oldPinned bool
		pinned    bool
		want      error
	}{
		{"ピン総数3で自分が未ピンなら ErrPinLimit", 3, false, true, ErrPinLimit},
		{"ピン総数3で自分がピン済みなら通る", 3, true, true, nil},
		{"ピンを外す更新は上限でも通る", 3, true, false, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := checkUpdate(tt.total, tt.oldPinned, model.Note{Pinned: tt.pinned}, testLimits)
			if !errors.Is(got, tt.want) {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNotesSortOrder(t *testing.T) {
	base := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	docs := map[string]noteDoc{
		"b": {UpdatedAt: base},
		"a": {UpdatedAt: base},
		"c": {UpdatedAt: base.Add(time.Hour)},
		"d": {UpdatedAt: base.Add(-time.Hour)},
	}
	var ids []string
	for _, n := range notesFromDocs(docs) {
		ids = append(ids, n.ID)
	}
	want := []string{"c", "a", "b", "d"}
	if len(ids) != len(want) {
		t.Fatalf("ids = %v", ids)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("ids = %v, want %v", ids, want)
		}
	}
	if got := notesFromDocs(nil); len(got) != 0 {
		t.Errorf("空は空: %v", got)
	}
}
