package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// 試合データ系 API はクエリの user_key を受け付けず、本人のセッションが無ければ 401 を返す(#461)
func TestDataAPIsRequireSession(t *testing.T) {
	handlers := map[string]http.HandlerFunc{
		"/matches":      handleMatches,
		"/tag-partners": handleTagPartners,
	}
	for path, h := range handlers {
		for _, tc := range []struct {
			name   string
			cookie bool
		}{
			{"Cookie なし・user_key 指定", false},
			{"解決できないセッション", true},
		} {
			t.Run(path+"/"+tc.name, func(t *testing.T) {
				req := httptest.NewRequest(http.MethodGet, path+"?user_key=0123456789abcdef", nil)
				if tc.cookie {
					req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "unknown-token"})
				}
				rec := httptest.NewRecorder()
				h(rec, req)
				if rec.Code != http.StatusUnauthorized {
					t.Errorf("status = %d, want 401", rec.Code)
				}
			})
		}
	}
}
