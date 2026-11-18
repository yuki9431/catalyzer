package aidiagnosis

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

var testMS = map[string]bool{"ガンダム": true, "ザク": true, "ジオング": true}

func sampleMap(t *testing.T) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("prompt/sample_input.json")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func marshal(t *testing.T, m map[string]any) []byte {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestValidateInput(t *testing.T) {
	raw, err := os.ReadFile("prompt/sample_input.json")
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := ValidateInput(raw, testMS)
	if err != nil {
		t.Fatalf("sample_input.json が通らない: %v", err)
	}
	var a, b any
	if err := json.Unmarshal(raw, &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(canonical, &b); err != nil {
		t.Fatal(err)
	}
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if string(ja) != string(jb) {
		t.Errorf("正規化で内容が変わった:\n%s\n%s", ja, jb)
	}

	action := func(m map[string]any, i int) map[string]any { return m["actions"].([]any)[i].(map[string]any) }
	cases := []struct {
		name string
		mod  func(m map[string]any)
	}{
		{"トップの未知フィールド", func(m map[string]any) { m["extra"] = 1 }},
		{"入れ子の未知フィールド", func(m map[string]any) { m["sample"].(map[string]any)["extra"] = 1 }},
		{"v≠1", func(m map[string]any) { m["v"] = 2 }},
		{"matches<10", func(m map[string]any) { m["sample"].(map[string]any)["matches"] = 9 }},
		{"wins>matches", func(m map[string]any) { m["sample"].(map[string]any)["wins"] = 121 }},
		{"win_rate 100.1", func(m map[string]any) { m["sample"].(map[string]any)["win_rate"] = 100.1 }},
		{"小数桁超過", func(m map[string]any) { m["sample"].(map[string]any)["win_rate"] = 52.55 }},
		{"数値の位置に文字列", func(m map[string]any) { m["sample"].(map[string]any)["matches"] = "120" }},
		{"整数の位置に小数", func(m map[string]any) { m["basic"].(map[string]any)["dmg_given"] = 720.5 }},
		{"ms_list に無い機体", func(m map[string]any) { m["weak_enemy"].(map[string]any)["ms"] = "存在しない" }},
		{"my_ms の ms 重複", func(m map[string]any) {
			e := m["my_ms"].([]any)[0]
			m["my_ms"] = []any{e, e}
		}},
		{"actions 6件", func(m map[string]any) {
			keys := []string{"deaths", "fall_first", "fall_second", "burst", "consecutive_fall", "burst_death"}
			var l []any
			for _, k := range keys {
				l = append(l, map[string]any{"key": k, "total": 10, "bad_matches": 5, "bad_win_rate": 1, "good_win_rate": 2, "gap": 1, "impact": 1})
			}
			m["actions"] = l
		}},
		{"key の重複", func(m map[string]any) { action(m, 1)["key"] = "dmg_taken"; action(m, 1)["line"] = 1 }},
		{"line が必要な key で無い", func(m map[string]any) { delete(action(m, 0), "line") }},
		{"line が不要な key に有る", func(m map[string]any) { action(m, 1)["line"] = 100 }},
		{"未知の key", func(m map[string]any) { action(m, 1)["key"] = "unknown" }},
		{"total>matches", func(m map[string]any) { action(m, 0)["total"] = 121 }},
		{"bad_matches>total", func(m map[string]any) { action(m, 0)["bad_matches"] = 121 }},
		{"未知の metric", func(m map[string]any) {
			m["recent"].(map[string]any)["worsened"].([]any)[0].(map[string]any)["metric"] = "x"
		}},
		{"last_day の prev が欠ける", func(m map[string]any) { delete(m["last_day"].(map[string]any), "prev_win_rate") }},
		{"streak=1", func(m map[string]any) { m["after_streak"].(map[string]any)["streak"] = 1 }},
	}
	for _, tc := range cases {
		m := sampleMap(t)
		tc.mod(m)
		if _, err := ValidateInput(marshal(t, m), testMS); err == nil {
			t.Errorf("%s: 拒否されない", tc.name)
		}
	}

	t.Run("null 可の項目は null で通り空配列に正規化される", func(t *testing.T) {
		m := sampleMap(t)
		m["recent"], m["weak_enemy"], m["after_streak"], m["last_day"] = nil, nil, nil, nil
		delete(m, "actions")
		delete(m, "my_ms")
		out, err := ValidateInput(marshal(t, m), testMS)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(out), `"actions":[]`) || !strings.Contains(string(out), `"my_ms":[]`) {
			t.Errorf("空配列に正規化されていない: %s", out)
		}
	})
	t.Run("末尾のゴミ", func(t *testing.T) {
		if _, err := ValidateInput(append(append([]byte{}, raw...), []byte(" {}")...), testMS); err == nil {
			t.Error("拒否されない")
		}
	})
	t.Run("8KB 超", func(t *testing.T) {
		if _, err := ValidateInput([]byte(strings.Repeat(" ", MaxInputBytes+1)), testMS); err == nil {
			t.Error("拒否されない")
		}
	})
	t.Run("JSON でない", func(t *testing.T) {
		if _, err := ValidateInput([]byte("not json"), testMS); err == nil {
			t.Error("拒否されない")
		}
	})
}
