package nationalstats

import (
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

func TestIsStale(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	data := []model.MSNationalStat{{Name: "test"}}

	tests := []struct {
		name      string
		cached    []model.MSNationalStat
		fetchedAt time.Time
		want      bool
	}{
		{"未取得(nil)は常にstale", nil, now, true},
		{"取得直後はfresh", data, now, false},
		{"maxAge未満はfresh", data, now.Add(-3 * time.Hour), false},
		{"maxAgeちょうどはstale", data, now.Add(-maxAge), true},
		{"maxAge超過はstale", data, now.Add(-7 * time.Hour), true},
	}

	for _, tt := range tests {
		got := isStale(tt.cached, tt.fetchedAt, now, maxAge)
		if got != tt.want {
			t.Errorf("%s: isStale = %v, want %v", tt.name, got, tt.want)
		}
	}
}
