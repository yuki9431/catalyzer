package aidiagnosis

import (
	"reflect"
	"strings"
	"testing"
)

func TestExtractNumbers(t *testing.T) {
	cases := []struct {
		in   string
		want []textNumber
	}{
		{"勝率52.4%", []textNumber{{52.4, 1}}},
		{"５２．４%と１２,３４５と1，000", []textNumber{{52.4, 1}, {12345, 0}, {1000, 0}}},
		{"F91は1機目", []textNumber{{91, 0}, {1, 0}}},
		{"-3.50", []textNumber{{3.5, 2}}},
		{"数字なし", nil},
	}
	for _, c := range cases {
		if got := extractNumbers(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("extractNumbers(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestResolvePath(t *testing.T) {
	root, err := decodeJSON([]byte(`{"a":{"b":[{"c_d":1},{"c_d":2}]},"e":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	for path, ok := range map[string]bool{
		"a": true, "a.b": true, "a.b[1]": true, "a.b[1].c_d": true, "e": true,
		"": false, "x": false, "a.b[2]": false, "a.b[0].zzz": false, "e.f": false, "e[0]": false, "a[0]": false, "a..b": false,
	} {
		if _, got := resolvePath(root, path); got != ok {
			t.Errorf("resolvePath(%q) = %v, want %v", path, got, ok)
		}
	}
}

func item(text string, evidence ...string) Item { return Item{Text: text, Evidence: evidence} }

// validOutput はサンプル入力に対して全規則を通る出力。
func validOutput() Output {
	return Output{
		Headline: item("勝率52.5%、ちょうど真ん中じゃん", "sample.win_rate"),
		Tendencies: []Item{
			item("被ダメ900超の試合は勝率30%", "actions[0]"),
			item("先落ちした試合は勝率40%", "actions[1].bad_win_rate"),
			item("直近は45%まで落ちてる", "recent.win_rate"),
		},
		Cautions: []Item{
			item("被ダメを抑える", "actions[0].name"),
			item("ジオングは避ける", "weak_enemy.ms"),
			item("3連敗の後は落ち着く", "after_streak.streak"),
		},
		Strengths: []Item{item("ザクには勝率66.7%", "strong_enemies[0]")},
	}
}

func TestCheckOutput(t *testing.T) {
	input, err := BuildLLMInput(sampleInput)
	if err != nil {
		t.Fatal(err)
	}
	if vs := CheckOutput(validOutput(), input); len(vs) != 0 {
		t.Fatalf("正例が違反: %v", vs)
	}
	checkNumberRounding(t)
	checkReferenceOnly(t)

	// 負例: 変更を加えて、期待する規則名が出ること
	cases := []struct {
		name string
		mut  func(*Output)
		rule string
	}{
		{"tendencies が2件", func(o *Output) { o.Tendencies = o.Tendencies[:2] }, "count"},
		{"cautions が4件", func(o *Output) { o.Cautions = append(o.Cautions, o.Cautions[0]) }, "count"},
		{"strengths が0件", func(o *Output) { o.Strengths = nil }, "count"},
		{"strengths が3件", func(o *Output) { o.Strengths = append(o.Strengths, o.Strengths[0], o.Strengths[0]) }, "count"},
		{"text が空白だけ", func(o *Output) { o.Headline.Text = "  " }, "text_length"},
		{"text が61字", func(o *Output) { o.Headline.Text = strings.Repeat("あ", 61) }, "text_length"},
		{"制御文字", func(o *Output) { o.Headline.Text = "勝率\n52.5%" }, "text_control"},
		{"evidence が空", func(o *Output) { o.Headline.Evidence = nil }, "evidence_count"},
		{"evidence が6件", func(o *Output) {
			o.Headline.Evidence = []string{"sample", "sample", "sample", "sample", "sample", "sample"}
		}, "evidence_count"},
		{"evidence の形式違反", func(o *Output) { o.Headline.Evidence = []string{"Sample.win_rate"} }, "evidence_key"},
		{"evidence が実在しない", func(o *Output) { o.Headline.Evidence = []string{"sample.nothing"} }, "evidence_key"},
		{"evidence がルート", func(o *Output) { o.Headline.Evidence = []string{""} }, "evidence_key"},
		{"範囲外の添字", func(o *Output) { o.Headline.Evidence = []string{"actions[9]"} }, "evidence_key"},
		{"evidence に無い数値", func(o *Output) { o.Tendencies[0].Text = "勝率は99%" }, "number_not_in_evidence"},
		{"pt", func(o *Output) { o.Headline.Text = "勝率52.5pt" }, "forbidden_unit"},
		{"PT 大文字", func(o *Output) { o.Headline.Text = "勝率52.5PT" }, "forbidden_unit"},
		{"全角 pt", func(o *Output) { o.Headline.Text = "勝率52.5ｐｔ" }, "forbidden_unit"},
		{"ポイント", func(o *Output) { o.Headline.Text = "52.5ポイント" }, "forbidden_unit"},
	}
	for _, c := range cases {
		o := validOutput()
		c.mut(&o)
		vs := CheckOutput(o, input)
		found := false
		for _, v := range vs {
			found = found || v.Rule == c.rule
		}
		if !found {
			t.Errorf("%s: 規則 %s が出ない (got %v)", c.name, c.rule, vs)
		}
	}
}

func checkNumberRounding(t *testing.T) {
	// 設計書 §3.6 の表の6例。許可集合を LLM 入力の葉として与える。
	cases := []struct {
		name    string
		input   string
		evidenc string
		text    string
		ok      bool
	}{
		{"52 は 52.35 に丸め一致", `{"x":52.35}`, "x", "勝率は52", true},
		{"52.4 は 52.35 に丸め一致", `{"x":52.35}`, "x", "勝率は52.4", true},
		{"53 は 52.35 に不一致", `{"x":52.35}`, "x", "勝率は53", false},
		{"52.0 は 52 に一致", `{"x":52}`, "x", "勝率は52.0", true},
		{"1 は名前の文字列の数字に一致", `{"x":{"name":"1機目で覚醒せず落ちた"}}`, "x", "1機目で落ちる", true},
		{"91 は機体名の数字に一致", `{"x":{"ms":"F91"}}`, "x", "F91が苦手", true},
		{"絶対値", `{"x":-8.4}`, "x", "8.4%下がった", true},
		{"全角と桁区切り", `{"x":12345}`, "x", "１２,３４５戦", true},
	}
	for _, c := range cases {
		root, err := decodeJSON([]byte(c.input))
		if err != nil {
			t.Fatal(err)
		}
		sub, _ := resolvePath(root, c.evidenc)
		if got := numbersAllowed(c.text, collectNumbers(sub, nil)); got != c.ok {
			t.Errorf("%s: got %v, want %v", c.name, got, c.ok)
		}
	}
}

func checkReferenceOnly(t *testing.T) {
	small := []byte(`{"sample":{"matches":20,"wins":10,"win_rate":50}}`)
	o := validOutput()
	o.Headline = item("勝率は50%", "sample.win_rate")
	// 他の項目は resolve できないので headline の規則だけを見る
	hasRule := func(vs []Violation, item, rule string) bool {
		for _, v := range vs {
			if v.Item == item && v.Rule == rule {
				return true
			}
		}
		return false
	}
	if !hasRule(CheckOutput(o, small), "headline", "reference_only") {
		t.Error("30試合未満で 参考程度 が無いのに違反にならない")
	}
	o.Headline = item("データが少ないから参考程度、勝率は50%", "sample.win_rate")
	if hasRule(CheckOutput(o, small), "headline", "reference_only") {
		t.Error("参考程度 があるのに違反")
	}
	big := []byte(`{"sample":{"matches":30,"wins":15,"win_rate":50}}`)
	o.Headline = item("勝率は50%", "sample.win_rate")
	if hasRule(CheckOutput(o, big), "headline", "reference_only") {
		t.Error("30試合以上では 参考程度 は不要")
	}
}
