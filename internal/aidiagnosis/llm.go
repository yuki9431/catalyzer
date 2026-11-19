package aidiagnosis

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// actionNames は負け筋の名前(patterns.js のラベルに揃える)。{line} は line で置き換える。
var actionNames = map[string]string{
	"deaths":           "被撃墜でコストオーバー",
	"fall_first":       "先落ちした",
	"fall_second":      "後落ちした",
	"burst":            "1機目で覚醒せず落ちた",
	"dmg_taken":        "被ダメ{line}超",
	"dmg_given":        "与ダメ{line}未満",
	"consecutive_fall": "順落ちした",
	"burst_death":      "覚醒中に撃墜された",
	"ov_solo":          "オーバーリミットを覚醒と重ねずに使った",
	"last_cost_burst":  "最後のコストで覚醒が無かった",
	"burst_count":      "覚醒{line}回未満",
	"ex_dmg":           "EXダメ{line}未満",
}

var worsenedNames = map[string]string{"dmg_given": "与ダメ", "dmg_taken": "被ダメ", "deaths": "被撃墜", "bursts": "覚醒回数"}

// BuildLLMInput は検証済みの要約から LLM 入力を作る。v を外し、actions と worsened に name を付ける。
func BuildLLMInput(canonical []byte) ([]byte, error) {
	root, err := decodeJSON(canonical)
	if err != nil {
		return nil, err
	}
	m, ok := root.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("要約がオブジェクトではない")
	}
	delete(m, "v")
	actions, _ := m["actions"].([]any)
	for _, a := range actions {
		am, _ := a.(map[string]any)
		key, _ := am["key"].(string)
		name, known := actionNames[key]
		if !known {
			return nil, fmt.Errorf("未知の key")
		}
		if line, has := am["line"].(json.Number); has {
			name = strings.ReplaceAll(name, "{line}", line.String())
		}
		am["name"] = name
	}
	if recent, ok := m["recent"].(map[string]any); ok {
		worsened, _ := recent["worsened"].([]any)
		for _, w := range worsened {
			wm, _ := w.(map[string]any)
			metric, _ := wm["metric"].(string)
			name, known := worsenedNames[metric]
			if !known {
				return nil, fmt.Errorf("未知の metric")
			}
			wm["name"] = name
		}
	}
	return json.Marshal(m)
}

// decodeJSON は数値を json.Number のまま読む(桁を変えないため)。
func decodeJSON(b []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("JSON の読み込み: %w", err)
	}
	return v, nil
}

func numberValue(n json.Number) (float64, bool) {
	f, err := strconv.ParseFloat(n.String(), 64)
	return f, err == nil
}
