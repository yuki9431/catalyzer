package scraper

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSite は公式サイトの戦績ページを模す。1日分の試合を新しい順に perPage 件ずつ並べ、
// 詳細ページは deny403After 件まで返し、それ以降は 403 を返す(0 なら 403 を返さない)。
type fakeSite struct {
	dates        []string // 新しい順。各日に hours の試合がある
	hours        []string // 新しい順
	perPage      int
	deny403After int
	denyPages    bool // 日別の試合一覧(daily_detail)で 403 を返す

	mu       sync.Mutex
	detailed int
}

func (f *fakeSite) RoundTrip(r *http.Request) (*http.Response, error) {
	rec := httptest.NewRecorder()
	f.serve(rec, r)
	resp := rec.Result()
	resp.Request = r
	return resp, nil
}

func (f *fakeSite) serve(w http.ResponseWriter, r *http.Request) {
	const base = "https://web.vsmobile.jp/exvs2ib/results/classmatch/fight"
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	switch {
	case r.URL.Path == "/exvs2ib/results/classmatch/fight":
		var b strings.Builder
		b.WriteString("<ul>")
		for d, date := range f.dates {
			fmt.Fprintf(&b, `<li class="item"><a href="%s/daily_detail?param=d%d" class="right-arrow"><p class="datetime fz-ss">%s(土)</p></a><div class="ta-r"><span class="ds-ib tl-l col-stand fz-ss">店</span></div></li>`, base, d, date)
		}
		b.WriteString("</ul>")
		_, _ = fmt.Fprint(w, b.String())
	case strings.HasSuffix(r.URL.Path, "/daily_detail"):
		if f.denyPages {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		page := 1
		_, _ = fmt.Sscanf(r.URL.Query().Get("page"), "%d", &page)
		param := r.URL.Query().Get("param")
		var b strings.Builder
		b.WriteString("<ul>")
		for i := (page - 1) * f.perPage; i < page*f.perPage && i < len(f.hours); i++ {
			fmt.Fprintf(&b, `<li class="item"><a href="%s/match_detail?pi=%s-m%02d" class="right-arrow vs-detail win"><p class="datetime fz-ss">%s</p></a></li>`, base, param, i, f.hours[i])
		}
		b.WriteString("</ul>")
		next := "javascript:void(0);"
		if page*f.perPage < len(f.hours) {
			next = fmt.Sprintf("%s/daily_detail?page=%d&param=%s", base, page+1, param)
		}
		fmt.Fprintf(&b, `<div class="block control"><div class="page-send"><ul class="clearfix"><li><a href="javascript:void(0);">&lt;</a></li><li><a href="%s">&gt;</a></li><li><a href="javascript:void(0);">&gt;&gt;</a></li></ul></div></div>`, next)
		_, _ = fmt.Fprint(w, b.String())
	case strings.HasSuffix(r.URL.Path, "/match_detail"):
		f.mu.Lock()
		f.detailed++
		denied := f.deny403After > 0 && f.detailed > f.deny403After
		f.mu.Unlock()
		if denied {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		var b strings.Builder
		b.WriteString(`<div class="panel_area">`)
		for p := 1; p <= 4; p++ {
			fmt.Fprintf(&b, `<div class="w80 ta-r"><p class="col-stand">街%d</p></div><p class="mb-ss fz-m"><span class="name">P%d</span></p>`, p, p)
			b.WriteString(`<div class="w45 pr-ss"><dl><dd>100</dd><dd>1</dd><dd>1</dd></dl></div><div class="w55"><dl><dd>500</dd><dd>400</dd><dd>0</dd></dl></div>`)
		}
		b.WriteString(`</div>`)
		_, _ = fmt.Fprint(w, b.String())
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// 403 で途中終了したあと、保存済みの最新日時より後を取る再分析(本番と同じ since の決め方)で、
// 1日分の全試合がそろうかを確かめる(#456)。
func TestScraping_403PartialThenResume(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	site := &fakeSite{dates: []string{"2026/10/03"}, perPage: 4, deny403After: 6}
	for i := 0; i < 12; i++ {
		site.hours = append(site.hours, fmt.Sprintf("17:%02d", 50-i*4)) // 17:50, 17:46, … 新しい順
	}
	orig := http.DefaultTransport
	http.DefaultTransport = site
	t.Cleanup(func() { http.DefaultTransport = orig })

	jar, _ := cookiejar.New(nil)

	// 1回目: 7件目の詳細で 403
	first, _, err := ScrapingWithOption("", "", time.Time{}, ScrapingOption{SavedJar: jar})
	if !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("1回目は 403 を期待したが got: %v", err)
	}
	saved := map[string]bool{}
	var latest time.Time
	for _, s := range first {
		saved[s.Datetime.Format("15:04")] = true
		if s.Datetime.After(latest) {
			latest = s.Datetime
		}
	}

	// 2回目: 403 なし。since は保存済みの最新日時(pipeline の GetLatestDatetime と同じ)
	site.deny403After = 0
	second, _, err := ScrapingWithOption("", "", latest, ScrapingOption{SavedJar: jar})
	if err != nil {
		t.Fatalf("2回目はエラーなしを期待したが got: %v", err)
	}
	for _, s := range second {
		saved[s.Datetime.Format("15:04")] = true
	}

	var missing []string
	for _, h := range site.hours {
		if !saved[h] {
			missing = append(missing, h)
		}
	}
	sort.Strings(missing)
	t.Logf("1回目に保存: %d 試合(最新 %s)、2回目に取得: %d 試合", len(first)/4, latest.Format("15:04"), len(second)/4)
	if len(missing) > 0 {
		t.Errorf("2回の分析後も %d 試合が欠けている: %v", len(missing), missing)
	}
}

// 一覧を読む段階で 403 になった場合は何も保存されず、再分析で全試合がそろう(過去にこの経路で
// 「403 のあと再実行したら取り込まれた」ように見えていた可能性の確認)。
func TestScraping_403OnListThenResume(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	site := &fakeSite{dates: []string{"2026/10/03"}, perPage: 4, denyPages: true}
	for i := 0; i < 12; i++ {
		site.hours = append(site.hours, fmt.Sprintf("17:%02d", 50-i*4))
	}
	orig := http.DefaultTransport
	http.DefaultTransport = site
	t.Cleanup(func() { http.DefaultTransport = orig })
	jar, _ := cookiejar.New(nil)

	first, _, err := ScrapingWithOption("", "", time.Time{}, ScrapingOption{SavedJar: jar})
	t.Logf("1回目: err=%v 保存 %d 試合", err, len(first)/4)
	site.denyPages = false
	second, _, err := ScrapingWithOption("", "", time.Time{}, ScrapingOption{SavedJar: jar})
	if err != nil {
		t.Fatalf("2回目はエラーなしを期待したが got: %v", err)
	}
	if len(first) != 0 || len(second)/4 != len(site.hours) {
		t.Errorf("1回目は0試合・2回目は全%d試合を期待したが got: %d / %d", len(site.hours), len(first)/4, len(second)/4)
	}
}

// 3日分を古い日から取り、2日目の途中で 403 になっても、再分析を繰り返せば全試合がそろう(#456)
func TestScraping_403AcrossDaysResumes(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	site := &fakeSite{dates: []string{"2026/10/03", "2026/09/27", "2026/09/26"}, perPage: 2, deny403After: 7}
	for i := 0; i < 5; i++ {
		site.hours = append(site.hours, fmt.Sprintf("20:%02d", 50-i*5))
	}
	orig := http.DefaultTransport
	http.DefaultTransport = site
	t.Cleanup(func() { http.DefaultTransport = orig })
	jar, _ := cookiejar.New(nil)

	saved := map[string]bool{}
	var latest time.Time
	for run := 1; run <= 4 && len(saved) < len(site.dates)*len(site.hours); run++ {
		site.detailed = 0
		got, _, err := ScrapingWithOption("", "", latest, ScrapingOption{SavedJar: jar})
		if err != nil && !errors.Is(err, ErrAccessDenied) {
			t.Fatalf("%d回目: 予期しないエラー: %v", run, err)
		}
		for _, sc := range got {
			saved[sc.Datetime.Format("2006/01/02 15:04")] = true
			if sc.Datetime.After(latest) {
				latest = sc.Datetime
			}
		}
		t.Logf("%d回目: 取得 %d 試合、累計 %d 試合、最新 %s", run, len(got)/4, len(saved), latest.Format("01/02 15:04"))
	}
	if want := len(site.dates) * len(site.hours); len(saved) != want {
		t.Errorf("全%d試合を期待したが %d 試合しかそろわなかった", want, len(saved))
	}
}
