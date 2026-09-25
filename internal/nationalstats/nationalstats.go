// Package nationalstats は機体ごとの全国統計（勝率・使用率）をメモリ上でキャッシュする。
// 毎日更新される揮発データのため永続化しない。
package nationalstats

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/scraper"
)

// maxAge はキャッシュの有効期間。全国統計は1日1回更新されるため、数時間の鮮度で十分。
const maxAge = 6 * time.Hour

var (
	mu         sync.Mutex
	cached     []model.MSNationalStat
	fetchedAt  time.Time
	refreshing bool
)

// Get は現在キャッシュされている全国統計を返す。未取得なら空スライス。
func Get() []model.MSNationalStat {
	mu.Lock()
	defer mu.Unlock()
	return cached
}

// MaybeRefresh はキャッシュが古い場合のみ再取得する。失敗しても既存キャッシュを保持する。
func MaybeRefresh(jar http.CookieJar) {
	mu.Lock()
	if refreshing || !isStale(cached, fetchedAt, time.Now(), maxAge) {
		mu.Unlock()
		return
	}
	refreshing = true
	mu.Unlock()

	stats, err := scraper.ScrapeNationalMSStats(jar)

	mu.Lock()
	defer mu.Unlock()
	refreshing = false
	if err != nil {
		log.Printf("[WARN] 全国統計の更新に失敗: %v", err)
		return
	}
	cached = stats
	fetchedAt = time.Now()
	log.Printf("[INFO] 全国統計を更新: %d件", len(stats))
}

// isStale はキャッシュを再取得すべきか判定する（未取得、または maxAge を超過）。
func isStale(cached []model.MSNationalStat, fetchedAt, now time.Time, maxAge time.Duration) bool {
	return cached == nil || now.Sub(fetchedAt) >= maxAge
}
