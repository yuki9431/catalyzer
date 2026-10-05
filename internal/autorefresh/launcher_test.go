package autorefresh

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLaunchJob(t *testing.T) {
	var gotMethod, gotPath, gotBody string
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.EscapedPath()
		b := make([]byte, 16)
		n, _ := r.Body.Read(b)
		gotBody = string(b[:n])
		w.WriteHeader(status)
	}))
	defer srv.Close()
	orig := runAPIBase
	runAPIBase = srv.URL
	t.Cleanup(func() { runAPIBase = orig })

	const job = "projects/p/locations/l/jobs/j"
	if err := LaunchJob(context.Background(), srv.Client(), job); err != nil {
		t.Fatalf("200 なのにエラー: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/v2/"+job+":run" || gotBody != "{}" {
		t.Errorf("リクエストが想定と違う: %s %s body=%q", gotMethod, gotPath, gotBody)
	}

	status = http.StatusForbidden
	if err := LaunchJob(context.Background(), srv.Client(), job); err == nil {
		t.Error("403 はエラーにするべき")
	}
}
