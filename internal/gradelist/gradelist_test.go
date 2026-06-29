package gradelist

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/yuki9431/catalyzer/internal/model"
)

func TestStripQuery(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"no query", "https://example.com/img.png", "https://example.com/img.png"},
		{"with query", "https://example.com/img.png?v=123&t=456", "https://example.com/img.png"},
		{"empty", "", ""},
		{"invalid url", "://bad", "://bad"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stripQuery(tt.in); got != tt.want {
				t.Errorf("stripQuery(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestLoadGradeList(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "grade_list.json")

	data := []GradeInfo{
		{ImageURL: "https://example.com/extreme.png", Class: "Extreme", Grade: 0},
		{ImageURL: "https://example.com/ace1.png", Class: "Ace", Grade: 1},
	}
	raw, _ := json.Marshal(data)
	os.WriteFile(path, raw, 0644)

	loaded, err := LoadGradeList(path)
	if err != nil {
		t.Fatalf("LoadGradeList: %v", err)
	}
	if len(loaded) != 2 {
		t.Fatalf("got %d items, want 2", len(loaded))
	}
	if loaded[0].Class != "Extreme" || loaded[0].Grade != 0 {
		t.Errorf("item 0: got %+v", loaded[0])
	}
	if loaded[1].Class != "Ace" || loaded[1].Grade != 1 {
		t.Errorf("item 1: got %+v", loaded[1])
	}
}

func TestLoadGradeList_NotFound(t *testing.T) {
	_, err := LoadGradeList("/nonexistent/path.json")
	if err == nil {
		t.Error("expected error for nonexistent file, got nil")
	}
}

func TestLoadGradeList_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	os.WriteFile(path, []byte("{invalid"), 0644)

	_, err := LoadGradeList(path)
	if err == nil {
		t.Error("expected error for invalid JSON, got nil")
	}
}

func TestBuildGradeMap(t *testing.T) {
	list := []GradeInfo{
		{ImageURL: "https://example.com/a.png?v=1", Class: "Extreme", Grade: 0},
		{ImageURL: "https://example.com/b.png", Class: "Ace", Grade: 5},
	}
	m := BuildGradeMap(list)

	if len(m) != 2 {
		t.Fatalf("got %d entries, want 2", len(m))
	}
	if g, ok := m["https://example.com/a.png"]; !ok {
		t.Error("key without query not found")
	} else if g.Class != "Extreme" || g.Grade != 0 {
		t.Errorf("got %+v", g)
	}
	if g, ok := m["https://example.com/b.png"]; !ok {
		t.Error("key b.png not found")
	} else if g.Class != "Ace" {
		t.Errorf("got %+v", g)
	}
}

func TestBuildGradeMap_Empty(t *testing.T) {
	m := BuildGradeMap(nil)
	if len(m) != 0 {
		t.Errorf("got len %d, want 0", len(m))
	}
}

func TestFindUnknownGrades(t *testing.T) {
	gradeMap := map[string]GradeInfo{
		"https://example.com/known.png": {Class: "Ace", Grade: 1},
	}
	ds := model.DatedScores{
		{PlayerScore: model.PlayerScore{
			ShuffleGradeURL: "https://example.com/known.png?v=1",
			TeamGradeURL:    "https://example.com/unknown.png?v=2",
		}},
		{PlayerScore: model.PlayerScore{
			ShuffleGradeURL: "https://example.com/unknown.png",
			TeamGradeURL:    "",
		}},
	}

	unknown := FindUnknownGrades(ds, gradeMap)

	if count, ok := unknown["https://example.com/unknown.png"]; !ok {
		t.Error("expected unknown.png to be reported")
	} else if count != 2 {
		t.Errorf("got count %d, want 2", count)
	}
	if _, ok := unknown["https://example.com/known.png"]; ok {
		t.Error("known.png should not be in unknown map")
	}
}

func TestFindUnknownGrades_AllKnown(t *testing.T) {
	gradeMap := map[string]GradeInfo{
		"https://example.com/a.png": {Class: "Pilot", Grade: 1},
	}
	ds := model.DatedScores{
		{PlayerScore: model.PlayerScore{ShuffleGradeURL: "https://example.com/a.png"}},
	}

	unknown := FindUnknownGrades(ds, gradeMap)
	if len(unknown) != 0 {
		t.Errorf("expected no unknowns, got %d", len(unknown))
	}
}

func TestFindUnknownGrades_EmptyInput(t *testing.T) {
	unknown := FindUnknownGrades(nil, map[string]GradeInfo{})
	if len(unknown) != 0 {
		t.Errorf("expected no unknowns, got %d", len(unknown))
	}
}

func TestCheckUnknownGrades_NoPanic(t *testing.T) {
	gradeMap := map[string]GradeInfo{
		"https://example.com/known.png": {Class: "Ace", Grade: 1},
	}
	ds := model.DatedScores{
		{PlayerScore: model.PlayerScore{ShuffleGradeURL: "https://example.com/unknown.png"}},
		{PlayerScore: model.PlayerScore{ShuffleGradeURL: ""}},
	}
	CheckUnknownGrades(ds, gradeMap)
}
