package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/api/idtoken"
)

func TestRequireSchedulerOIDC(t *testing.T) {
	const aud, invoker = "https://example.test", "scheduler@example.test"
	payload := func(email string, verified bool, iss string) *idtoken.Payload {
		return &idtoken.Payload{Issuer: iss, Claims: map[string]any{"email": email, "email_verified": verified}}
	}
	validWith := func(p *idtoken.Payload, err error) tokenValidator {
		return func(_ context.Context, token, audience string) (*idtoken.Payload, error) {
			if audience != aud {
				t.Errorf("audience = %q, want %q", audience, aud)
			}
			return p, err
		}
	}
	good := payload(invoker, true, "https://accounts.google.com")

	tests := []struct {
		name     string
		audience string
		invoker  string
		header   string
		validate tokenValidator
		want     int
		called   bool
	}{
		{"トークン無し", aud, invoker, "", validWith(good, nil), 401, false},
		{"Bearer でない", aud, invoker, "Basic abc", validWith(good, nil), 401, false},
		{"Bearer だけ", aud, invoker, "Bearer ", validWith(good, nil), 401, false},
		{"検証エラー", aud, invoker, "Bearer tok", validWith(nil, errors.New("bad")), 401, false},
		{"別の SA", aud, invoker, "Bearer tok", validWith(payload("other@example.test", true, "https://accounts.google.com"), nil), 403, false},
		{"email_verified=false", aud, invoker, "Bearer tok", validWith(payload(invoker, false, "https://accounts.google.com"), nil), 403, false},
		{"issuer 不正", aud, invoker, "Bearer tok", validWith(payload(invoker, true, "https://evil.example"), nil), 403, false},
		{"正常", aud, invoker, "Bearer tok", validWith(good, nil), 200, true},
		{"issuer の別表記", aud, invoker, "Bearer tok", validWith(payload(invoker, true, "accounts.google.com"), nil), 200, true},
		{"audience 未設定", "", invoker, "Bearer tok", validWith(good, nil), 404, false},
		{"invoker 未設定", aud, "", "Bearer tok", validWith(good, nil), 404, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { called = true })
			h := requireSchedulerOIDC(next, tt.audience, tt.invoker, tt.validate)

			req := httptest.NewRequest(http.MethodPost, "/internal/auto-refresh/tick", nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Errorf("status = %d, want %d", rec.Code, tt.want)
			}
			if called != tt.called {
				t.Errorf("next 呼び出し = %v, want %v", called, tt.called)
			}
		})
	}
}
