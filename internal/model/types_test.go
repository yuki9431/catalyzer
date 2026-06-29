package model

import (
	"testing"
)

func TestUserKey(t *testing.T) {
	key := UserKey("test@example.com")

	if len(key) != 16 {
		t.Errorf("UserKey length = %d, want 16 (8 bytes hex)", len(key))
	}

	key2 := UserKey("test@example.com")
	if key != key2 {
		t.Error("same input should produce same key")
	}

	key3 := UserKey("other@example.com")
	if key == key3 {
		t.Error("different input should produce different key")
	}
}

func TestUserKey_Empty(t *testing.T) {
	key := UserKey("")
	if len(key) != 16 {
		t.Errorf("UserKey(\"\") length = %d, want 16", len(key))
	}
}

func TestUserKey_KnownValue(t *testing.T) {
	// SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
	// 先頭8バイト = 2cf24dba5fb0a30e
	key := UserKey("hello")
	if key != "2cf24dba5fb0a30e" {
		t.Errorf("UserKey(\"hello\") = %q, want %q", key, "2cf24dba5fb0a30e")
	}
}

func TestJobStatus_Constants(t *testing.T) {
	statuses := []JobStatus{StatusPending, StatusScraping, StatusAnalyzing, StatusDone, StatusError}
	expected := []string{"pending", "scraping", "analyzing", "done", "error"}

	for i, s := range statuses {
		if string(s) != expected[i] {
			t.Errorf("status %d: got %q, want %q", i, s, expected[i])
		}
	}
}
