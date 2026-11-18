package geoip

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testSources(t *testing.T, bodies map[string]string) Sources {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := bodies[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(b))
	}))
	t.Cleanup(srv.Close)
	return Sources{Delegated: srv.URL + "/d", CountryV4: srv.URL + "/v4", CountryV6: srv.URL + "/v6"}
}

func TestUpdateAPNIC(t *testing.T) {
	src := testSources(t, map[string]string{
		"/d":  testDelegated,
		"/v4": "1.0.20.0,1.0.20.255,KR\n",
		"/v6": "2001:db8::,2001:db8::ff,US\n",
	})
	dir := t.TempDir()
	v4, v6 := filepath.Join(dir, "v4.csv"), filepath.Join(dir, "v6.csv")
	n4, n6, err := UpdateAPNIC(http.DefaultClient, src, v4, v6)
	if err != nil {
		t.Fatalf("UpdateAPNIC: %v", err)
	}
	if n4 != 3 || n6 != 2 {
		t.Errorf("件数 = v4 %d, v6 %d, want 3, 2", n4, n6)
	}
	got, _ := os.ReadFile(v4)
	if !strings.HasPrefix(string(got), "1.0.16.0,1.0.19.255,JP\n1.0.21.0,") {
		t.Errorf("v4 出力 = %q", got)
	}
}

func TestUpdateAPNIC_Errors(t *testing.T) {
	dir := t.TempDir()
	v4, v6 := filepath.Join(dir, "v4.csv"), filepath.Join(dir, "v6.csv")
	src := testSources(t, map[string]string{"/d": testDelegated, "/v4": "1.0.20.0,1.0.20.255,KR\n"}) // v6 は 404
	if _, _, err := UpdateAPNIC(http.DefaultClient, src, v4, v6); err == nil || !strings.Contains(err.Error(), "/v6") {
		t.Errorf("取得失敗は取得元付きのエラーにする: %v", err)
	}
	if _, err := os.Stat(v4); !os.IsNotExist(err) {
		t.Error("取得に失敗したら何も書かない")
	}
	if _, _, err := UpdateAPNIC(http.DefaultClient, src, v4, filepath.Join(dir, ".", "v4.csv")); err == nil {
		t.Error("出力先が同じならエラーにする")
	}
}
