package aidiagnosis

import (
	"encoding/json"
	"strings"
	"testing"
)

func hasAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}

func TestBuildLLMInput(t *testing.T) {
	got, err := BuildLLMInput(sampleInput)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(got, &m); err != nil {
		t.Fatal(err)
	}
	if _, has := m["v"]; has {
		t.Error("v が残っている")
	}
	actions := m["actions"].([]any)
	if n := actions[0].(map[string]any)["name"]; n != "被ダメ900超" {
		t.Errorf("line 付きの name = %v", n)
	}
	if n := actions[1].(map[string]any)["name"]; n != "先落ちした" {
		t.Errorf("line 無しの name = %v", n)
	}
	w := m["recent"].(map[string]any)["worsened"].([]any)[0].(map[string]any)
	if w["name"] != "被ダメ" {
		t.Errorf("worsened の name = %v", w["name"])
	}
	// 数値の桁を変えない
	if !json.Valid(got) || !hasAll(string(got), `"win_rate":52.5`, `"recent":720.5`, `"delta":50.25`) {
		t.Errorf("数値が変わった: %s", got)
	}
	if _, err := BuildLLMInput([]byte(`{"v":1,"actions":[{"key":"zzz"}]}`)); err == nil {
		t.Error("未知の key が通った")
	}
}
