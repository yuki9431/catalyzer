package server

import (
	"net/http"
	"path/filepath"
	"testing"

	"github.com/yuki9431/catalyzer/internal/geoip"
)

func testGeoGuard(t *testing.T) *geoGuard {
	t.Helper()
	v4 := filepath.Join("..", "..", "data", "jp_ipv4.csv")
	v6 := filepath.Join("..", "..", "data", "jp_ipv6.csv")
	db, err := geoip.Load(v4, v6)
	if err != nil {
		t.Fatalf("geoip.Load: %v", err)
	}
	return &geoGuard{db: db}
}

func reqWithXFF(xff string) *http.Request {
	return &http.Request{
		RemoteAddr: "127.0.0.1:12345",
		Header:     http.Header{"X-Forwarded-For": {xff}},
	}
}

func TestGeoGuard_Allowed_NilIsFailOpen(t *testing.T) {
	var g *geoGuard // GEO_RESTRICT 無効時は nil
	if !g.allowed(reqWithXFF("8.8.8.8, 142.250.0.1")) {
		t.Error("nil guard should allow all (fail-open)")
	}
}

func TestGeoGuard_Allowed(t *testing.T) {
	g := testGeoGuard(t)
	tests := []struct {
		name string
		xff  string // `実クライアントIP, GoogleFE` の形
		want bool
	}{
		{"JP実クライアント", "60.71.146.85, 142.250.23.121", true},
		{"US実クライアント", "8.8.8.8, 142.250.23.121", false},
		{"詐称: 左端JPでも実IPは海外", "60.71.146.85, 8.8.8.8, 142.250.23.121", false},
		{"詐称: 左端海外でも実IPはJP", "8.8.8.8, 60.71.146.85, 142.250.23.121", true},
		{"解釈不能なIPはフェイルオープン", "not-an-ip, 142.250.23.121", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := g.allowed(reqWithXFF(tt.xff)); got != tt.want {
				t.Errorf("allowed(%q) = %v, want %v", tt.xff, got, tt.want)
			}
		})
	}
}

func TestNewGeoGuard_DisabledByDefault(t *testing.T) {
	t.Setenv("GEO_RESTRICT", "")
	if g := newGeoGuard(defaultGeoIPv4Path, defaultGeoIPv6Path); g != nil {
		t.Error("expected nil guard when GEO_RESTRICT unset")
	}
}

func TestNewGeoGuard_EnabledLoadFailFailsOpen(t *testing.T) {
	t.Setenv("GEO_RESTRICT", "true")
	if g := newGeoGuard("missing_v4.csv", "missing_v6.csv"); g != nil {
		t.Error("expected nil guard (fail-open) when allowlist load fails")
	}
}

func TestNewGeoGuard_Enabled(t *testing.T) {
	t.Setenv("GEO_RESTRICT", "true")
	v4 := filepath.Join("..", "..", "data", "jp_ipv4.csv")
	v6 := filepath.Join("..", "..", "data", "jp_ipv6.csv")
	g := newGeoGuard(v4, v6)
	if g == nil {
		t.Fatal("expected non-nil guard when enabled and allowlist loads")
	}
	if g.allowed(reqWithXFF("8.8.8.8, 142.250.23.121")) {
		t.Error("US client should be blocked when guard enabled")
	}
}
