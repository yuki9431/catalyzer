package aidiagnosis

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Item は出力の1項目。evidence は LLM 入力のキーのパス。
type Item struct {
	Text     string   `json:"text"`
	Evidence []string `json:"evidence"`
}

// Output は LLM の診断結果。
type Output struct {
	Headline   Item   `json:"headline"`
	Tendencies []Item `json:"tendencies"`
	Cautions   []Item `json:"cautions"`
	Strengths  []Item `json:"strengths"`
}

// Violation は検査違反。ログには Item と Rule だけを出す(本文は出さない)。
type Violation struct{ Item, Rule string }

const textMax = 60

var (
	evidencePattern = regexp.MustCompile(`^[a-z_]+(\[[0-9]+\])?(\.[a-z_]+(\[[0-9]+\])?)*$`)
	segmentPattern  = regexp.MustCompile(`^([a-z_]+)(?:\[([0-9]+)\])?$`)
	numberPattern   = regexp.MustCompile(`[0-9]+(\.[0-9]+)?`)
	commaBetween    = regexp.MustCompile(`([0-9])[,，]([0-9])`)
)

// CheckOutput は出力を検査し、違反の一覧を返す(空なら通過)。
func CheckOutput(out Output, llmInput []byte) []Violation {
	root, err := decodeJSON(llmInput)
	if err != nil {
		return []Violation{{"input", "llm_input_unreadable"}}
	}
	var vs []Violation
	if len(out.Tendencies) != 3 {
		vs = append(vs, Violation{"tendencies", "count"})
	}
	if len(out.Cautions) != 3 {
		vs = append(vs, Violation{"cautions", "count"})
	}
	if n := len(out.Strengths); n < 1 || n > 2 {
		vs = append(vs, Violation{"strengths", "count"})
	}
	vs = append(vs, checkItem("headline", out.Headline, root)...)
	for _, g := range []struct {
		name  string
		items []Item
	}{{"tendencies", out.Tendencies}, {"cautions", out.Cautions}, {"strengths", out.Strengths}} {
		for i, it := range g.items {
			vs = append(vs, checkItem(fmt.Sprintf("%s[%d]", g.name, i), it, root)...)
		}
	}
	if sampleMatches(root) < 30 && !strings.Contains(out.Headline.Text, "参考程度") {
		vs = append(vs, Violation{"headline", "reference_only"})
	}
	return vs
}

func sampleMatches(root any) float64 {
	sub, ok := resolvePath(root, "sample.matches")
	if n, isNum := sub.(json.Number); ok && isNum {
		if f, ok := numberValue(n); ok {
			return f
		}
	}
	return 0
}

func checkItem(name string, it Item, root any) []Violation {
	var vs []Violation
	text := strings.TrimSpace(it.Text)
	if n := utf8.RuneCountInString(text); n < 1 || n > textMax {
		vs = append(vs, Violation{name, "text_length"})
	}
	if strings.ContainsFunc(text, unicode.IsControl) {
		vs = append(vs, Violation{name, "text_control"})
	}
	if lower := strings.ToLower(text); strings.Contains(lower, "pt") || strings.Contains(lower, "ｐｔ") || strings.Contains(text, "ポイント") {
		vs = append(vs, Violation{name, "forbidden_unit"})
	}
	if n := len(it.Evidence); n < 1 || n > 5 {
		return append(vs, Violation{name, "evidence_count"})
	}
	var allowed []float64
	evidenceOK := true
	for _, key := range it.Evidence {
		sub, ok := resolveEvidence(root, key)
		if !ok {
			vs = append(vs, Violation{name, "evidence_key"})
			evidenceOK = false
			continue
		}
		allowed = collectNumbers(sub, allowed)
	}
	if evidenceOK && !numbersAllowed(text, allowed) {
		vs = append(vs, Violation{name, "number_not_in_evidence"})
	}
	return vs
}

func resolveEvidence(root any, key string) (any, bool) {
	if !evidencePattern.MatchString(key) {
		return nil, false
	}
	return resolvePath(root, key)
}

// resolvePath は "a.b[0].c" 形式のパスで LLM 入力をたどる。ルート(空パス)は不可。
func resolvePath(root any, path string) (any, bool) {
	if path == "" {
		return nil, false
	}
	cur := root
	for _, seg := range strings.Split(path, ".") {
		m := segmentPattern.FindStringSubmatch(seg)
		if m == nil {
			return nil, false
		}
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		if cur, ok = obj[m[1]]; !ok {
			return nil, false
		}
		if m[2] != "" {
			idx, err := strconv.Atoi(m[2])
			arr, isArr := cur.([]any)
			if err != nil || !isArr || idx >= len(arr) {
				return nil, false
			}
			cur = arr[idx]
		}
	}
	return cur, true
}

// collectNumbers は部分木の数値の葉(絶対値)と、文字列の葉に含まれる数値を集める。
func collectNumbers(v any, acc []float64) []float64 {
	switch t := v.(type) {
	case json.Number:
		if f, ok := numberValue(t); ok {
			acc = append(acc, math.Abs(f))
		}
	case string:
		for _, n := range extractNumbers(t) {
			acc = append(acc, n.value)
		}
	case []any:
		for _, e := range t {
			acc = collectNumbers(e, acc)
		}
	case map[string]any:
		for _, e := range t {
			acc = collectNumbers(e, acc)
		}
	}
	return acc
}

type textNumber struct {
	value  float64
	digits int
}

// extractNumbers は本文から数値を取り出す。全角数字を半角にし、数字間の桁区切りを除く。符号は無視する。
func extractNumbers(s string) []textNumber {
	s = strings.Map(func(r rune) rune {
		switch {
		case r >= '０' && r <= '９':
			return r - '０' + '0'
		case r == '．':
			return '.'
		}
		return r
	}, s)
	for commaBetween.MatchString(s) {
		s = commaBetween.ReplaceAllString(s, "$1$2")
	}
	var out []textNumber
	for _, m := range numberPattern.FindAllString(s, -1) {
		f, err := strconv.ParseFloat(m, 64)
		if err != nil {
			continue
		}
		d := 0
		if i := strings.IndexByte(m, '.'); i >= 0 {
			d = len(m) - i - 1
		}
		out = append(out, textNumber{f, d})
	}
	return out
}

// numbersAllowed は本文の全ての数値が、小数桁に応じた丸めの範囲で許可集合のどれかに一致するかを返す。
func numbersAllowed(text string, allowed []float64) bool {
	for _, t := range extractNumbers(text) {
		tol := 0.5*math.Pow10(-t.digits) + 1e-9
		found := false
		for _, v := range allowed {
			if math.Abs(t.value-v) <= tol {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
