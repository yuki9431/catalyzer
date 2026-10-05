package firestore

import (
	"testing"
	"time"
)

func TestSessionExpired(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		exp  time.Time
		want bool
	}{
		{"期限前", now.Add(time.Hour), false},
		{"期限後", now.Add(-time.Second), true},
		{"expire_at なし", time.Time{}, false},
	}
	for _, tt := range tests {
		if got := sessionExpired(tt.exp, now); got != tt.want {
			t.Errorf("%s: got %v, want %v", tt.name, got, tt.want)
		}
	}
}
