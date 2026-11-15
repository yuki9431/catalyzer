package main

import (
	"reflect"
	"testing"

	"github.com/yuki9431/catalyzer/internal/model"
)

func row(p string) model.DatedScore {
	return model.DatedScore{PlayerScore: model.PlayerScore{MsProficiency: p}}
}

func TestTallyProficiencies(t *testing.T) {
	acc := map[string]int{}
	tallyProficiencies(model.DatedScores{row("gold2"), row("master"), row("gold2"), row("")}, acc)
	tallyProficiencies(model.DatedScores{row("master"), row("silver5")}, acc)

	want := map[string]int{"gold2": 2, "master": 2, "silver5": 1, "(empty)": 1}
	if !reflect.DeepEqual(acc, want) {
		t.Errorf("acc = %v, want %v", acc, want)
	}
}

func TestSortedCounts(t *testing.T) {
	got := sortedCounts(map[string]int{"silver5": 1, "master": 3, "gold2": 3, "(empty)": 2})
	want := []proficiencyCount{{"gold2", 3}, {"master", 3}, {"(empty)", 2}, {"silver5", 1}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}
