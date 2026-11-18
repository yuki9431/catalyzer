package aidiagnosis

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"unicode/utf8"
)

// MaxInputBytes は要約 JSON の上限。
const MaxInputBytes = 8 << 10

const msNameMax = 64

// Summary は POST 本文の要約 JSON v1。
type Summary struct {
	V           int          `json:"v"`
	Sample      Sample       `json:"sample"`
	Basic       Basic        `json:"basic"`
	Actions     []Action     `json:"actions"`
	Recent      *Recent      `json:"recent"`
	WeakEnemy   *WeakEnemy   `json:"weak_enemy"`
	AfterStreak *AfterStreak `json:"after_streak"`
	MyMS        []MSStat     `json:"my_ms"`
	Strong      []MSStat     `json:"strong_enemies"`
	LastDay     *LastDay     `json:"last_day"`
}

type Sample struct {
	Matches int     `json:"matches"`
	Wins    int     `json:"wins"`
	WinRate float64 `json:"win_rate"`
}

type Basic struct {
	DmgGiven      int     `json:"dmg_given"`
	DmgTaken      int     `json:"dmg_taken"`
	ExDmg         int     `json:"ex_dmg"`
	Kills         float64 `json:"kills"`
	Deaths        float64 `json:"deaths"`
	DmgEfficiency float64 `json:"dmg_efficiency"`
}

type Action struct {
	Key         string  `json:"key"`
	Line        *int    `json:"line,omitempty"`
	Total       int     `json:"total"`
	BadMatches  int     `json:"bad_matches"`
	BadWinRate  int     `json:"bad_win_rate"`
	GoodWinRate int     `json:"good_win_rate"`
	Gap         int     `json:"gap"`
	Impact      float64 `json:"impact"`
}

type Worsened struct {
	Metric string  `json:"metric"`
	Recent float64 `json:"recent"`
	Before float64 `json:"before"`
	Delta  float64 `json:"delta"`
}

type Recent struct {
	Matches       int        `json:"matches"`
	WinRate       float64    `json:"win_rate"`
	BeforeWinRate float64    `json:"before_win_rate"`
	Diff          float64    `json:"diff"`
	Worsened      []Worsened `json:"worsened"`
}

type WeakEnemy struct {
	MS           string `json:"ms"`
	Matches      int    `json:"matches"`
	WinRate      int    `json:"win_rate"`
	OtherWinRate int    `json:"other_win_rate"`
	Gap          int    `json:"gap"`
}

type AfterStreak struct {
	Streak       int `json:"streak"`
	Matches      int `json:"matches"`
	WinRate      int `json:"win_rate"`
	OtherWinRate int `json:"other_win_rate"`
	Gap          int `json:"gap"`
}

type MSStat struct {
	MS      string  `json:"ms"`
	Matches int     `json:"matches"`
	WinRate float64 `json:"win_rate"`
}

type LastDay struct {
	Matches     int      `json:"matches"`
	WinRate     float64  `json:"win_rate"`
	PrevMatches *int     `json:"prev_matches,omitempty"`
	PrevWinRate *float64 `json:"prev_win_rate,omitempty"`
	WinRateDiff *float64 `json:"win_rate_diff,omitempty"`
}

var actionsWithLine = map[string]bool{"dmg_taken": true, "dmg_given": true, "burst_count": true, "ex_dmg": true}

var actionKeys = map[string]bool{
	"deaths": true, "fall_first": true, "fall_second": true, "burst": true, "dmg_taken": true, "dmg_given": true,
	"consecutive_fall": true, "burst_death": true, "ov_solo": true, "last_cost_burst": true, "burst_count": true, "ex_dmg": true,
}

var worsenedMetrics = map[string]bool{"dmg_given": true, "dmg_taken": true, "deaths": true, "bursts": true}

// ValidateInput は要約 JSON を検証し、正規化した JSON を返す。理由はログ用で利用者には返さない。
func ValidateInput(raw []byte, msNames map[string]bool) (canonical []byte, err error) {
	if len(raw) > MaxInputBytes {
		return nil, errors.New("本文が大きすぎる")
	}
	var s Summary
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("JSON の形が不正: %w", err)
	}
	if _, err = dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("末尾に余計なデータがある")
	}
	if err = s.validate(msNames); err != nil {
		return nil, err
	}
	s.normalize()
	out, err := json.Marshal(s)
	if err != nil {
		return nil, fmt.Errorf("正規化: %w", err)
	}
	return out, nil
}

// normalize は null になる配列を空配列にそろえる。
func (s *Summary) normalize() {
	if s.Actions == nil {
		s.Actions = []Action{}
	}
	if s.MyMS == nil {
		s.MyMS = []MSStat{}
	}
	if s.Strong == nil {
		s.Strong = []MSStat{}
	}
	if s.Recent != nil && s.Recent.Worsened == nil {
		s.Recent.Worsened = []Worsened{}
	}
}

func (s *Summary) validate(msNames map[string]bool) error {
	if s.V != 1 {
		return fmt.Errorf("v=%d", s.V)
	}
	if err := s.Sample.validate(); err != nil {
		return err
	}
	if err := s.Basic.validate(); err != nil {
		return err
	}
	if len(s.Actions) > 5 {
		return fmt.Errorf("actions が %d 件", len(s.Actions))
	}
	seen := map[string]bool{}
	for i, a := range s.Actions {
		if seen[a.Key] {
			return fmt.Errorf("actions[%d].key の重複", i)
		}
		seen[a.Key] = true
		if err := a.validate(s.Sample.Matches); err != nil {
			return fmt.Errorf("actions[%d]: %w", i, err)
		}
	}
	if s.Recent != nil {
		if err := s.Recent.validate(); err != nil {
			return fmt.Errorf("recent: %w", err)
		}
	}
	if w := s.WeakEnemy; w != nil {
		if err := checkMS(w.MS, msNames); err != nil {
			return fmt.Errorf("weak_enemy: %w", err)
		}
		if err := all(inInt(w.Matches, 1, 100000), pct(w.WinRate), pct(w.OtherWinRate), pct(w.Gap)); err != nil {
			return fmt.Errorf("weak_enemy: %w", err)
		}
	}
	if a := s.AfterStreak; a != nil {
		if err := all(inInt(a.Streak, 2, 10), inInt(a.Matches, 1, 100000), pct(a.WinRate), pct(a.OtherWinRate), pct(a.Gap)); err != nil {
			return fmt.Errorf("after_streak: %w", err)
		}
	}
	if err := validateMSStats("my_ms", s.MyMS, msNames); err != nil {
		return err
	}
	if err := validateMSStats("strong_enemies", s.Strong, msNames); err != nil {
		return err
	}
	if d := s.LastDay; d != nil {
		if err := d.validate(); err != nil {
			return fmt.Errorf("last_day: %w", err)
		}
	}
	return nil
}

func (s Sample) validate() error {
	if err := all(inInt(s.Matches, 10, 100000), inInt(s.Wins, 0, s.Matches), dec("sample.win_rate", s.WinRate, 0, 100, 1)); err != nil {
		return fmt.Errorf("sample: %w", err)
	}
	return nil
}

func (b Basic) validate() error {
	err := all(
		inInt(b.DmgGiven, 0, 10000), inInt(b.DmgTaken, 0, 10000), inInt(b.ExDmg, 0, 10000),
		dec("kills", b.Kills, 0, 10, 2), dec("deaths", b.Deaths, 0, 10, 2), dec("dmg_efficiency", b.DmgEfficiency, 0, 100, 2),
	)
	if err != nil {
		return fmt.Errorf("basic: %w", err)
	}
	return nil
}

func (a Action) validate(matches int) error {
	if !actionKeys[a.Key] {
		return fmt.Errorf("未知の key %q", a.Key)
	}
	if actionsWithLine[a.Key] != (a.Line != nil) {
		return errors.New("line の有無が key に合わない")
	}
	if a.Line != nil {
		if err := inInt(*a.Line, 0, 10000); err != nil {
			return err
		}
	}
	return all(
		inInt(a.Total, 1, matches), inInt(a.BadMatches, 1, a.Total),
		pct(a.BadWinRate), pct(a.GoodWinRate), pct(a.Gap), dec("impact", a.Impact, 0, 100, 1),
	)
}

func (r Recent) validate() error {
	err := all(
		inInt(r.Matches, 1, 100), dec("win_rate", r.WinRate, 0, 100, 1),
		dec("before_win_rate", r.BeforeWinRate, 0, 100, 1), dec("diff", r.Diff, -100, 100, 1),
	)
	if err != nil {
		return err
	}
	if len(r.Worsened) > 4 {
		return fmt.Errorf("worsened が %d 件", len(r.Worsened))
	}
	seen := map[string]bool{}
	for i, w := range r.Worsened {
		if !worsenedMetrics[w.Metric] || seen[w.Metric] {
			return fmt.Errorf("worsened[%d].metric が不正または重複", i)
		}
		seen[w.Metric] = true
		if err := all(dec("recent", w.Recent, 0, 10000, 2), dec("before", w.Before, 0, 10000, 2), dec("delta", w.Delta, -10000, 10000, 2)); err != nil {
			return fmt.Errorf("worsened[%d]: %w", i, err)
		}
	}
	return nil
}

func (d LastDay) validate() error {
	if err := all(inInt(d.Matches, 1, 1000), dec("win_rate", d.WinRate, 0, 100, 1)); err != nil {
		return err
	}
	n := 0
	for _, has := range []bool{d.PrevMatches != nil, d.PrevWinRate != nil, d.WinRateDiff != nil} {
		if has {
			n++
		}
	}
	switch n {
	case 0:
		return nil
	case 3:
		return all(inInt(*d.PrevMatches, 1, 1000), dec("prev_win_rate", *d.PrevWinRate, 0, 100, 1), dec("win_rate_diff", *d.WinRateDiff, -100, 100, 1))
	}
	return errors.New("prev_* と win_rate_diff は3つ揃える")
}

func validateMSStats(name string, list []MSStat, msNames map[string]bool) error {
	if len(list) > 3 {
		return fmt.Errorf("%s が %d 件", name, len(list))
	}
	seen := map[string]bool{}
	for i, m := range list {
		if err := checkMS(m.MS, msNames); err != nil {
			return fmt.Errorf("%s[%d]: %w", name, i, err)
		}
		if seen[m.MS] {
			return fmt.Errorf("%s[%d].ms の重複", name, i)
		}
		seen[m.MS] = true
		if err := all(inInt(m.Matches, 1, 100000), dec("win_rate", m.WinRate, 0, 100, 1)); err != nil {
			return fmt.Errorf("%s[%d]: %w", name, i, err)
		}
	}
	return nil
}

func checkMS(ms string, msNames map[string]bool) error {
	if ms == "" || utf8.RuneCountInString(ms) > msNameMax || !msNames[ms] {
		return errors.New("機体名が不正")
	}
	return nil
}

func all(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}

func inInt(v, lo, hi int) error {
	if v < lo || v > hi {
		return fmt.Errorf("%d は %d〜%d の範囲外", v, lo, hi)
	}
	return nil
}

func pct(v int) error { return inInt(v, 0, 100) }

// dec は範囲と小数桁(digits 桁まで)を検査する。
func dec(name string, v, lo, hi float64, digits int) error {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < lo || v > hi {
		return fmt.Errorf("%s=%v は %v〜%v の範囲外", name, v, lo, hi)
	}
	scaled := v * math.Pow10(digits)
	if math.Abs(scaled-math.Round(scaled)) >= 1e-6 {
		return fmt.Errorf("%s=%v は小数%d桁を超える", name, v, digits)
	}
	return nil
}
