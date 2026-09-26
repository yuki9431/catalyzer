package nationalstats

import (
	"path/filepath"
	"testing"

	"github.com/yuki9431/catalyzer/internal/model"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "national_ms_stats.json")
	in := []model.MSNationalStat{
		{Name: "ザクⅡ", Cost: 1500, WinRate: 54.0, UsageRate: 4.4},
		{Name: "νガンダム", Cost: 3000, WinRate: 49.7, UsageRate: 3.0},
		{Name: "サザビー", Cost: 3000, WinRate: 50.8, UsageRate: 2.8},
	}

	if err := Save(in, path); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	// コスト降順・機体名昇順（Goの文字列比較はUTF-8バイト順なのでνがサより前）
	want := []string{"νガンダム", "サザビー", "ザクⅡ"}
	if len(got) != len(want) {
		t.Fatalf("件数が違う: got %d, want %d", len(got), len(want))
	}
	for i, name := range want {
		if got[i].Name != name {
			t.Errorf("[%d] got %q, want %q", i, got[i].Name, name)
		}
	}
	if got[0].WinRate != 49.7 || got[0].UsageRate != 3.0 || got[0].Cost != 3000 {
		t.Errorf("値が復元できていない: %+v", got[0])
	}
}

func TestLoadMissingFile(t *testing.T) {
	if _, err := Load(filepath.Join(t.TempDir(), "none.json")); err == nil {
		t.Error("存在しないファイルはエラーを返すはず")
	}
}
