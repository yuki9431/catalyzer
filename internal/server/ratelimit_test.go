package server

import (
	"net/http"
	"sync"
	"testing"

	"golang.org/x/time/rate"
)

func TestGetLimiter_NewIP(t *testing.T) {
	rl := &rateLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     rate.Limit(1),
		burst:    5,
	}

	lim := rl.getLimiter("192.168.1.1")
	if lim == nil {
		t.Fatal("expected non-nil limiter")
	}
	if len(rl.limiters) != 1 {
		t.Errorf("got %d entries, want 1", len(rl.limiters))
	}
}

func TestGetLimiter_SameIP(t *testing.T) {
	rl := &rateLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     rate.Limit(1),
		burst:    5,
	}

	lim1 := rl.getLimiter("192.168.1.1")
	lim2 := rl.getLimiter("192.168.1.1")

	if lim1 != lim2 {
		t.Error("same IP should return same limiter instance")
	}
	if len(rl.limiters) != 1 {
		t.Errorf("got %d entries, want 1", len(rl.limiters))
	}
}

func TestGetLimiter_DifferentIPs(t *testing.T) {
	rl := &rateLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     rate.Limit(1),
		burst:    5,
	}

	rl.getLimiter("10.0.0.1")
	rl.getLimiter("10.0.0.2")
	rl.getLimiter("10.0.0.3")

	if len(rl.limiters) != 3 {
		t.Errorf("got %d entries, want 3", len(rl.limiters))
	}
}

func TestGetLimiter_Concurrent(t *testing.T) {
	rl := &rateLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     rate.Limit(10),
		burst:    20,
	}

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rl.getLimiter("192.168.1.1")
		}()
	}
	wg.Wait()

	if len(rl.limiters) != 1 {
		t.Errorf("got %d entries, want 1", len(rl.limiters))
	}
}

func TestGetLimiter_BurstLimit(t *testing.T) {
	rl := &rateLimiter{
		limiters: make(map[string]*limiterEntry),
		rate:     rate.Limit(1),
		burst:    3,
	}

	lim := rl.getLimiter("10.0.0.1")

	allowed := 0
	for i := 0; i < 10; i++ {
		if lim.Allow() {
			allowed++
		}
	}

	if allowed != 3 {
		t.Errorf("burst allowed %d, want 3", allowed)
	}
}

func TestClientIP_XForwardedFor(t *testing.T) {
	tests := []struct {
		name string
		xff  string
		want string
	}{
		// Cloud Run（domain mapping）は XFF 末尾に実クライアントIPを追記する。末尾を採る。
		{"single IP", "203.0.113.50", "203.0.113.50"},
		{"CloudRunが実IPを末尾に追記", "6.6.6.6,203.0.113.50", "203.0.113.50"},
		{"with spaces", "6.6.6.6, 203.0.113.50", "203.0.113.50"},
		// 攻撃者が末尾より前に偽IPをいくつ足しても、末尾の実IPを採るので詐称が効かない。
		{"spoofed before last", "1.1.1.1, 2.2.2.2, 203.0.113.50", "203.0.113.50"},
		// 末尾が空（末尾カンマ）なら手前の非空エントリを採る。
		{"trailing empty skipped", "6.6.6.6, 203.0.113.50, ", "203.0.113.50"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{
				RemoteAddr: "127.0.0.1:12345",
				Header:     http.Header{"X-Forwarded-For": {tt.xff}},
			}
			if got := clientIP(r); got != tt.want {
				t.Errorf("clientIP() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClientIP_MultiLineXFF(t *testing.T) {
	// XFF が複数ヘッダ行で届いても連結して末尾を採る。
	r := &http.Request{
		RemoteAddr: "127.0.0.1:12345",
		Header:     http.Header{"X-Forwarded-For": {"6.6.6.6, 203.0.113.50", "70.41.3.18"}},
	}
	if got := clientIP(r); got != "70.41.3.18" {
		t.Errorf("clientIP() = %q, want %q", got, "70.41.3.18")
	}
}

func TestClientIP_EmptyCandidateFallsBack(t *testing.T) {
	// 全エントリが空なら XFF 無しと同じく RemoteAddr に落とす。
	for _, xff := range []string{"", ", ", " , ,  "} {
		r := &http.Request{
			RemoteAddr: "192.168.1.1:54321",
			Header:     http.Header{"X-Forwarded-For": {xff}},
		}
		if got := clientIP(r); got != "192.168.1.1" {
			t.Errorf("clientIP(%q) = %q, want 192.168.1.1", xff, got)
		}
	}
}

func TestRateLimitKey(t *testing.T) {
	tests := []struct {
		name string
		xff  string
		want string
	}{
		{"IPv4はアドレス単位", "6.6.6.6, 203.0.113.50", "203.0.113.50"},
		{"IPv6は/64に丸める", "70.41.3.18, 2001:db8:abcd:1234:5:6:7:8", "2001:db8:abcd:1234::/64"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{
				RemoteAddr: "127.0.0.1:1",
				Header:     http.Header{"X-Forwarded-For": {tt.xff}},
			}
			if got := rateLimitKey(r); got != tt.want {
				t.Errorf("rateLimitKey() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClientIP_NoXFF(t *testing.T) {
	r := &http.Request{
		RemoteAddr: "192.168.1.1:54321",
		Header:     http.Header{},
	}
	if got := clientIP(r); got != "192.168.1.1" {
		t.Errorf("clientIP() = %q, want %q", got, "192.168.1.1")
	}
}

func TestClientIP_NoPort(t *testing.T) {
	r := &http.Request{
		RemoteAddr: "192.168.1.1",
		Header:     http.Header{},
	}
	if got := clientIP(r); got != "192.168.1.1" {
		t.Errorf("clientIP() = %q, want %q", got, "192.168.1.1")
	}
}
