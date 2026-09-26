package nationalstats

import (
	"testing"
	"time"
)

func TestIsStale(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		fetchedAt time.Time
		want      bool
	}{
		{"未取得(ゼロ値)はstale", time.Time{}, true},
		{"0件取得でも取得直後はfresh(再クロールを繰り返さない)", now, false},
		{"maxAge未満はfresh", now.Add(-maxAge / 2), false},
		{"maxAgeちょうどはstale", now.Add(-maxAge), true},
		{"maxAge超過はstale", now.Add(-maxAge - time.Hour), true},
	}

	for _, tt := range tests {
		got := isStale(tt.fetchedAt, now, maxAge)
		if got != tt.want {
			t.Errorf("%s: isStale = %v, want %v", tt.name, got, tt.want)
		}
	}
}
