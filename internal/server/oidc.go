package server

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/api/idtoken"
)

// tokenValidator は OIDC トークンを検証する。本番は idtoken.Validate、テストでは偽物を注入する。
type tokenValidator func(ctx context.Context, token, audience string) (*idtoken.Payload, error)

// googleIssuers は Google が OIDC トークンを発行するときの iss。
var googleIssuers = map[string]bool{"https://accounts.google.com": true, "accounts.google.com": true}

// requireSchedulerOIDC は Cloud Scheduler の OIDC トークンを持つリクエストだけ通す(公開サービスでは唯一の認証)。
// audience か invoker が未設定なら機能が無効として 404(空の audience では idtoken.Validate が検証を飛ばす)。
func requireSchedulerOIDC(next http.Handler, audience, invoker string, validate tokenValidator) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if audience == "" || invoker == "" {
			http.NotFound(w, r)
			return
		}
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		payload, err := validate(r.Context(), token, audience)
		if err != nil || payload == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		email, _ := payload.Claims["email"].(string)
		verified, _ := payload.Claims["email_verified"].(bool)
		if email != invoker || !verified || !googleIssuers[payload.Issuer] {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// validateIDToken は Google の公開鍵で OIDC トークンの署名・期限・audience を検証する。
func validateIDToken(ctx context.Context, token, audience string) (*idtoken.Payload, error) {
	return idtoken.Validate(ctx, token, audience)
}
