package scraper

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

const fakeBase = "https://web.vsmobile.jp/exvs2ib/results/classmatch/fight"

// fakeSite は公式サイトの戦績ページを模す(日別一覧・日内の試合とも新しい順)。
// http.DefaultTransport を差し替えて使うので、このファイルのテストは t.Parallel にしない。
type fakeSite struct {
	dates        []string // 新しい順。各日に hours の試合がある
	hours        []string // 新しい順
	perPage      int
	deny403After int    // 詳細ページをこの件数まで返し、以降は 403(0 なら返し続ける)
	denyPages    string // この param の日別試合一覧で 403 を返す("*" は全日)
	rankpage     int    // 戦績トップの応答: 0 は通常、403 は拒否、302 はログイン画面へのリダイレクト

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

func detailURL(param string, i int) string {
	return fmt.Sprintf("%s/match_detail?pi=%s-m%02d", fakeBase, param, i)
}

func (f *fakeSite) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	var b strings.Builder
	switch {
	case r.URL.Path == "/exvs2ib/login":
		b.WriteString(`<ul><li class="item">news</li></ul>`)
	case r.URL.Path == "/exvs2ib/results/classmatch/fight" && f.rankpage == http.StatusFound:
		w.Header().Set("Location", "https://web.vsmobile.jp/exvs2ib/login")
		w.WriteHeader(http.StatusFound)
		return
	case r.URL.Path == "/exvs2ib/results/classmatch/fight" && f.rankpage == http.StatusForbidden:
		w.WriteHeader(http.StatusForbidden)
		return
	case r.URL.Path == "/exvs2ib/results/classmatch/fight":
		b.WriteString("<ul>")
		for d, date := range f.dates {
			fmt.Fprintf(&b, `<li class="item"><a href="%s/daily_detail?param=d%d" class="right-arrow"><p class="datetime fz-ss">%s(土)</p></a><div class="ta-r"><span class="ds-ib tl-l col-stand fz-ss">店</span></div></li>`, fakeBase, d, date)
		}
		b.WriteString("</ul>")
	case strings.HasSuffix(r.URL.Path, "/daily_detail"):
		param := r.URL.Query().Get("param")
		if f.denyPages == "*" || f.denyPages == param {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		page := 1
		_, _ = fmt.Sscanf(r.URL.Query().Get("page"), "%d", &page)
		b.WriteString("<ul>")
		for i := (page - 1) * f.perPage; i < page*f.perPage && i < len(f.hours); i++ {
			fmt.Fprintf(&b, `<li class="item"><a href="%s" class="right-arrow vs-detail win"><p class="datetime fz-ss">%s</p></a></li>`, detailURL(param, i), f.hours[i])
		}
		b.WriteString("</ul>")
		next := "javascript:void(0);"
		if page*f.perPage < len(f.hours) {
			next = fmt.Sprintf("%s/daily_detail?page=%d&param=%s", fakeBase, page+1, param)
		}
		fmt.Fprintf(&b, `<div class="block control"><div class="page-send"><ul class="clearfix"><li><a href="javascript:void(0);">&lt;</a></li><li><a href="%s">&gt;</a></li><li><a href="javascript:void(0);">&gt;&gt;</a></li></ul></div></div>`, next)
	case strings.HasSuffix(r.URL.Path, "/match_detail"):
		f.mu.Lock()
		f.detailed++
		denied := f.deny403After > 0 && f.detailed > f.deny403After
		f.mu.Unlock()
		if denied {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		b.WriteString(`<div class="panel_area">`)
		for p := 1; p <= 4; p++ {
			fmt.Fprintf(&b, `<div class="w80 ta-r"><p class="col-stand">街%d</p></div><p class="mb-ss fz-m"><span class="name">P%d</span></p>`, p, p)
			b.WriteString(`<div class="w45 pr-ss"><dl><dd>100</dd><dd>1</dd><dd>1</dd></dl></div><div class="w55"><dl><dd>500</dd><dd>400</dd><dd>0</dd></dl></div>`)
		}
		b.WriteString(`</div>`)
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}
	_, _ = fmt.Fprint(w, b.String())
}

// oldestFirstIDs は全試合の MatchID を古い順に返す
func (f *fakeSite) oldestFirstIDs() []string {
	var ids []string
	for d := len(f.dates) - 1; d >= 0; d-- {
		for i := len(f.hours) - 1; i >= 0; i-- {
			ids = append(ids, model.MatchIDFromURL(detailURL(fmt.Sprintf("d%d", d), i)))
		}
	}
	return ids
}

// resumeUntilComplete は本番と同じく「保存済みの最新日時より後」を取る分析を繰り返し、
// 各回の保存分が古い側から途切れていないことを確かめる。afterFirst で2回目以降の 403 を止める
func resumeUntilComplete(t *testing.T, site *fakeSite, afterFirst func()) (firstSaved int) {
	t.Helper()
	orig := http.DefaultTransport
	http.DefaultTransport = site
	t.Cleanup(func() { http.DefaultTransport = orig })
	jar, _ := cookiejar.New(nil)

	want := site.oldestFirstIDs()
	saved := map[string]bool{}
	var latest time.Time
	for run := 1; run <= 5 && len(saved) < len(want); run++ {
		site.detailed = 0
		got, _, err := ScrapingWithOption("", "", latest, ScrapingOption{SavedJar: jar})
		if err != nil && !errors.Is(err, ErrAccessDenied) {
			t.Fatalf("%d回目: 予期しないエラー: %v", run, err)
		}
		for _, sc := range got {
			saved[sc.MatchID] = true
			if sc.Datetime.After(latest) {
				latest = sc.Datetime
			}
		}
		for i, id := range want {
			if saved[id] {
				continue
			}
			for _, later := range want[i:] {
				if saved[later] {
					t.Fatalf("%d回目: 古い側に抜けがある状態で新しい試合が保存された(古い順で%d番目が欠落)", run, i+1)
				}
			}
			break
		}
		if run == 1 {
			firstSaved = len(saved)
			afterFirst()
		}
		t.Logf("%d回目: 取得 %d 試合、累計 %d/%d 試合", run, len(got)/4, len(saved), len(want))
	}
	if len(saved) != len(want) {
		t.Errorf("全%d試合を期待したが %d 試合しかそろわなかった", len(want), len(saved))
	}
	return firstSaved
}

func newSite(dates []string, n, perPage, minuteStep int) *fakeSite {
	site := &fakeSite{dates: dates, perPage: perPage}
	for i := 0; i < n; i++ {
		site.hours = append(site.hours, fmt.Sprintf("17:%02d", 50-i*minuteStep))
	}
	return site
}

// 詳細取得の途中で 403 になっても、再分析で全試合がそろう(#456)
func TestScraping_403PartialThenResume(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	site := newSite([]string{"2026/10/03"}, 12, 4, 4)
	site.deny403After = 6
	if first := resumeUntilComplete(t, site, func() { site.deny403After = 0 }); first == 0 {
		t.Errorf("1回目は古い側の試合が保存されるはず")
	}
}

// 一覧段階の 403 は何も保存せず、再分析で全試合がそろう
func TestScraping_403OnListThenResume(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	site := newSite([]string{"2026/10/03"}, 12, 4, 4)
	site.denyPages = "*"
	if first := resumeUntilComplete(t, site, func() { site.denyPages = "" }); first != 0 {
		t.Errorf("1回目は0試合のはずが %d 試合", first)
	}
}

// 3日分で毎回途中に 403 が出ても、再分析を繰り返せば全試合がそろう(#456)
func TestScraping_403AcrossDaysResumes(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	site := newSite([]string{"2026/10/03", "2026/09/27", "2026/09/26"}, 5, 2, 5)
	site.deny403After = 7
	resumeUntilComplete(t, site, func() {})
}

// 同じ分の2試合の間で 403 になっても、2試合目が抜けない(#456 レビュー S1)
func TestScraping_403BetweenSameMinute(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	t.Setenv("SCRAPER_BURST_PARALLELISM", "1") // 直列にして切れ目の位置を固定する
	site := &fakeSite{dates: []string{"2026/10/03"}, perPage: 3, hours: []string{"17:50", "17:46", "17:46", "17:42", "17:38", "17:34"}}
	site.deny403After = 4 // 古い順に 17:34, 17:38, 17:42, 17:46(1試合目) まで取り、17:46(2試合目) で 403
	resumeUntilComplete(t, site, func() { site.deny403After = 0 })
}

// 新しい日の一覧で 403 になっても、古い日の試合は1回目で保存される(#456 レビュー S2)
func TestScraping_403OnNewestDayListKeepsOlderDays(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	t.Setenv("SCRAPER_BURST_PARALLELISM", "1") // 日別一覧を古い日から1つずつ読む
	site := newSite([]string{"2026/10/03", "2026/09/27", "2026/09/26"}, 3, 2, 4)
	site.denyPages = "d0"
	if first := resumeUntilComplete(t, site, func() { site.denyPages = "" }); first != 6 {
		t.Errorf("1回目は古い2日分の6試合が保存されるはずが %d 試合", first)
	}
}

// 保存済み Cookie が失効して戦績トップがログイン画面に飛ばされたら、空振りでなく ErrLoginFailed になる
func TestScraping_ExpiredCookieDetected(t *testing.T) {
	orig := http.DefaultTransport
	site := newSite([]string{"2026/10/03"}, 4, 4, 4)
	site.rankpage = http.StatusFound
	http.DefaultTransport = site
	t.Cleanup(func() { http.DefaultTransport = orig })
	jar, _ := cookiejar.New(nil)

	_, _, err := ScrapingWithOption("", "", time.Time{}, ScrapingOption{SavedJar: jar})
	if !errors.Is(err, ErrLoginFailed) || !IsSessionExpired(err) {
		t.Fatalf("ErrLoginFailed を期待したが got: %v", err)
	}
}

// 戦績トップの 403 は ErrAccessDenied(セッション失効ではない)
func TestScraping_RankpageForbidden(t *testing.T) {
	orig := http.DefaultTransport
	site := newSite([]string{"2026/10/03"}, 4, 4, 4)
	site.rankpage = http.StatusForbidden
	http.DefaultTransport = site
	t.Cleanup(func() { http.DefaultTransport = orig })
	jar, _ := cookiejar.New(nil)

	_, _, err := ScrapingWithOption("", "", time.Time{}, ScrapingOption{SavedJar: jar})
	if !errors.Is(err, ErrAccessDenied) || IsSessionExpired(err) {
		t.Fatalf("ErrAccessDenied(失効でない)を期待したが got: %v", err)
	}
}

// SkipMatchIDs に入れた試合は詳細取得されない
func TestScraping_SkipMatchIDs(t *testing.T) {
	t.Setenv("SCRAPER_THROTTLE_DELAY_MS", "0")
	orig := http.DefaultTransport
	site := newSite([]string{"2026/10/03"}, 4, 4, 4)
	http.DefaultTransport = site
	t.Cleanup(func() { http.DefaultTransport = orig })
	jar, _ := cookiejar.New(nil)

	skip := map[string]bool{model.MatchIDFromURL(detailURL("d0", 0)): true}
	got, _, err := ScrapingWithOption("", "", time.Time{}, ScrapingOption{SavedJar: jar, SkipMatchIDs: skip})
	if err != nil {
		t.Fatalf("予期しないエラー: %v", err)
	}
	if site.detailed != 3 {
		t.Errorf("詳細取得は 3 件のはずが %d 件", site.detailed)
	}
	for _, sc := range got {
		if skip[sc.MatchID] {
			t.Errorf("スキップ対象 %s が返った", sc.MatchID)
		}
	}
}
