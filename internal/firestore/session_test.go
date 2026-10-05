package firestore

import (
	"errors"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func TestSessionUpdateError(t *testing.T) {
	const token = "secret-token-1234"
	nf := status.Error(codes.NotFound, "no document projects/p/documents/sessions/"+token)
	if got := sessionUpdateError(nf); !errors.Is(got, ErrSessionNotFound) {
		t.Errorf("NotFound は sentinel: got %v", got)
	}
	other := status.Error(codes.Unavailable, "failed projects/p/documents/sessions/"+token)
	got := sessionUpdateError(other)
	if errors.Is(got, ErrSessionNotFound) || strings.Contains(got.Error(), token) {
		t.Errorf("他のエラーは token を含めない: %v", got)
	}
}
