package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/yuki9431/catalyzer/internal/geoip"
)

// repoPaths は既定の許可リストをテストの作業ディレクトリから見たパスにする。
func repoPaths(paths []string) []string {
	out := make([]string, len(paths))
	for i, p := range paths {
		out[i] = filepath.Join("..", "..", p)
	}
	return out
}

func testGeoGuard(t *testing.T) *geoGuard {
	t.Helper()
	db, err := geoip.Load(repoPaths(defaultGeoIPv4Paths), repoPaths(defaultGeoIPv6Paths))
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
		xff  string // Cloud Run が実クライアントIPを末尾に追記した形
		want bool
	}{
		{"末尾がJP実クライアント→許可", "8.8.8.8, 60.71.146.85", true},
		{"末尾が海外実クライアント→拒否", "60.71.146.85, 8.8.8.8", false},
		{"詐称: 末尾より前にJPを置いても末尾の海外で拒否", "60.71.146.85, 103.62.49.6, 8.8.8.8", false},
		{"詐称: 末尾より前に海外を置いても末尾JPで許可", "8.8.8.8, 1.1.1.1, 60.71.146.85", true},
		{"末尾が解釈不能ならフェイルオープン", "8.8.8.8, not-an-ip", true},
		{"geo-whois に無く APNIC 割当で許可(OPTAGE)", "8.8.8.8, 2001:ce8:160:a0dd:7997:74d:dace:4f9d", true},
		{"geo-whois に無く APNIC 割当で許可(KDDI)", "8.8.8.8, 2001:268:c2c2:28a0:f0bd:8717:839b:cf08", true},
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
	if g := newGeoGuard(defaultGeoIPv4Paths, defaultGeoIPv6Paths); g != nil {
		t.Error("expected nil guard when GEO_RESTRICT unset")
	}
}

func TestNewGeoGuard_EnabledLoadFailFailsOpen(t *testing.T) {
	t.Setenv("GEO_RESTRICT", "true")
	if g := newGeoGuard([]string{"missing_v4.csv"}, []string{"missing_v6.csv"}); g != nil {
		t.Error("expected nil guard (fail-open) when allowlist load fails")
	}
}

func TestHandleReanalyze_GeoBlocked(t *testing.T) {
	g := testGeoGuard(t)
	r := httptest.NewRequest(http.MethodPost, "/reanalyze", nil)
	r.Header.Set("X-Forwarded-For", "60.71.146.85, 8.8.8.8") // 末尾=海外の実クライアント
	w := httptest.NewRecorder()

	handleReanalyze(w, r, nil, g)

	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestNewGeoGuard_Enabled(t *testing.T) {
	t.Setenv("GEO_RESTRICT", "true")
	g := newGeoGuard(repoPaths(defaultGeoIPv4Paths), repoPaths(defaultGeoIPv6Paths))
	if g == nil {
		t.Fatal("expected non-nil guard when enabled and allowlist loads")
	}
	if g.allowed(reqWithXFF("60.71.146.85, 8.8.8.8")) {
		t.Error("US client should be blocked when guard enabled")
	}
}
