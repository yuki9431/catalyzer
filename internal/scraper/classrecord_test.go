package scraper

import (
	"reflect"
	"testing"

	"github.com/yuki9431/catalyzer/internal/model"
)

// 実ページ(/exvs2ib/results/classmatch)の構造を保ち、数値をダミーに置き換えた抜粋
const classRecordHTML = `<div class="content">
<div class="box"><h3><p class="col-stand fw-b">クラスマッチG戦績</p></h3><ul>
  <li class="item pa-m"><div class="ds-fx fx-hz-c prompt-area pa-s">
    <p class="ta-r fz-xl fw-b mr-s">1,234<span class="fz-s fw-n col-sub">戦</span></p>
    <p class="ta-r fz-xl fw-b mr-s">700<span class="fz-s fw-n col-sub">勝</span></p>
    <p class="ta-r fz-xl fw-b">56.7<span class="fz-s fw-n col-sub">％</span></p>
  </div></li></ul></div>
<div class="box"><ul><li class="item pa-m">
  <dl class="ds-fx fx-hz-c fx-va-c w90"><dt class="col-sub fz-m w25 ta-r">チーム</dt>
    <dd class="ds-fx fx-hz-e w100">
      <p class="ta-r fw-b fz-l w35">1,000<span class="fz-s fw-n col-sub">戦</span></p>
      <p class="ta-r fw-b fz-l w35">560<span class="fz-s fw-n col-sub">勝</span></p>
      <p class="ta-r fw-b fz-l w35">56.0<span class="fz-s fw-n col-sub">％</span></p>
    </dd></dl>
  <dl class="ds-fx fx-hz-c fx-va-c w90"><dt class="col-sub fz-m w25 ta-r">日間</dt>
    <dd class="ds-fx fx-hz-e w100">
      <p class="ta-r fw-b fz-l w35">0<span class="fz-s fw-n col-sub">戦</span></p>
      <p class="ta-r fw-b fz-l w35">0<span class="fz-s fw-n col-sub">勝</span></p>
      <p class="ta-r fw-b fz-l w35">0.0<span class="fz-s fw-n col-sub">％</span></p>
    </dd></dl>
</li></ul></div>
<div class="box"><ul><li class="item pa-m">
  <dl class="ds-fx"><dt class="col-sub fz-m">敵撃破数</dt>
    <dd class="fz-m fw-b">2,345<span class="col-sub fz-s fw-n">機</span></dd></dl>
  <dl class="ds-fx"><dt class="col-sub fz-m">10連勝達成回数</dt>
    <dd class="fz-m fw-b">3<span class="col-sub fz-s fw-n">回</span></dd></dl>
</li></ul></div>
</div>`

func TestParseClassRecord(t *testing.T) {
	got, err := parseClassRecord([]byte(classRecordHTML))
	if err != nil {
		t.Fatalf("parseClassRecord() error = %v", err)
	}
	want := &model.ClassRecord{
		Total: model.WinRecord{Label: "クラスマッチG", Matches: 1234, Wins: 700, WinRate: 56.7},
		Breakdown: []model.WinRecord{
			{Label: "チーム", Matches: 1000, Wins: 560, WinRate: 56.0},
			{Label: "日間", Matches: 0, Wins: 0, WinRate: 0},
		},
		Counts: []model.CountStat{
			{Label: "敵撃破数", Value: 2345, Unit: "機"},
			{Label: "10連勝達成回数", Value: 3, Unit: "回"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseClassRecord() =\n%+v\nwant\n%+v", got, want)
	}
}

func TestParseClassRecord_NoTotal(t *testing.T) {
	if _, err := parseClassRecord([]byte(`<html><body><p>ログインしてください</p></body></html>`)); err == nil {
		t.Error("通算戦績が無いページでエラーにならない")
	}
}

func TestParseDecimal(t *testing.T) {
	tests := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"1,234戦", 1234, true},
		{"56.7％", 56.7, true},
		{"0回", 0, true},
		{"戦", 0, false},
	}
	for _, tt := range tests {
		got, ok := parseDecimal(tt.in)
		if got != tt.want || ok != tt.ok {
			t.Errorf("parseDecimal(%q) = (%v, %v), want (%v, %v)", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}
