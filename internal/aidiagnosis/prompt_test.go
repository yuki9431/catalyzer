package aidiagnosis

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func TestSystemPrompt(t *testing.T) {
	for _, w := range []string{"あたし", "おにーさん", "pt", "参考程度", "evidence", "60字"} {
		if !strings.Contains(systemPrompt, w) {
			t.Errorf("system.md に %q が無い", w)
		}
	}
}

func TestOutputSchema(t *testing.T) {
	var s struct {
		Required []string `json:"required"`
	}
	if err := json.Unmarshal([]byte(outputSchema), &s); err != nil {
		t.Fatal(err)
	}
	got := slices.Clone(s.Required)
	slices.Sort(got)
	if want := []string{"cautions", "headline", "strengths", "tendencies"}; !slices.Equal(got, want) {
		t.Errorf("required = %v, want %v", s.Required, want)
	}
}
