package server

import (
	"log"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// rateLimiter はIP単位のレート制限を管理する
type rateLimiter struct {
	mu       sync.Mutex
	limiters map[string]*limiterEntry
	rate     rate.Limit
	burst    int
}

func newRateLimiter(r rate.Limit, burst int) *rateLimiter {
	rl := &rateLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     r,
		burst:    burst,
	}
	go rl.cleanup(1 * time.Hour)
	return rl
}

func (rl *rateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	entry, exists := rl.limiters[ip]
	if !exists {
		entry = &limiterEntry{
			limiter: rate.NewLimiter(rl.rate, rl.burst),
		}
		rl.limiters[ip] = entry
	}
	entry.lastSeen = time.Now()
	return entry.limiter
}

// cleanup は一定間隔でアクセスのないエントリを削除する
func (rl *rateLimiter) cleanup(ttl time.Duration) {
	ticker := time.NewTicker(ttl)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		before := len(rl.limiters)
		for ip, entry := range rl.limiters {
			if time.Since(entry.lastSeen) > ttl {
				delete(rl.limiters, ip)
			}
		}
		after := len(rl.limiters)
		rl.mu.Unlock()
		if before != after {
			log.Printf("[INFO] Rate limiter cleanup: %d -> %d entries", before, after)
		}
	}
}

// clientIP はリクエストからクライアントIPを取得する（Cloud Run対応）。
// Cloud Run は XFF を `…, 実クライアントIP, GoogleのFE-IP` の順でappendするため
// 右から2番目が信頼できる実クライアントIP。左端はクライアントが詐称できるので使わない。
// XFF が複数行で届く場合に備え全行を連結してから数える。該当位置が空なら RemoteAddr に落とす。
func clientIP(r *http.Request) string {
	if vals := r.Header.Values("X-Forwarded-For"); len(vals) > 0 {
		parts := strings.Split(strings.Join(vals, ","), ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		var cand string
		if len(parts) >= 2 {
			cand = parts[len(parts)-2]
		} else {
			cand = parts[0]
		}
		if cand != "" {
			return cand
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimitKey はレート制限のキーを返す。IPv6 は端末ごとにアドレスを回せる（/64 以上が
// 割り当てられる）ため /64 に丸めてキーにする。IPv4 と v4射影はアドレス単位。
func rateLimitKey(r *http.Request) string {
	ip := clientIP(r)
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is6() {
		if p, perr := addr.Prefix(64); perr == nil {
			return p.String()
		}
	}
	return addr.String()
}
