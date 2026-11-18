// Package aidiagnosis implements the owner-only AI diagnosis: input validation and daily limits.
package aidiagnosis

import (
	"log"
	"os"
	"regexp"
	"strings"
)

// Config は環境変数から読む AI 診断の設定。
type Config struct {
	JobName string
	Allowed map[string]bool
}

// ConfigFromEnv は AI_DIAGNOSIS_JOB と AI_DIAGNOSIS_ALLOWED_USERS(カンマ区切りの userKey)から設定を組み立てる。
func ConfigFromEnv() Config {
	return Config{
		JobName: os.Getenv("AI_DIAGNOSIS_JOB"),
		Allowed: parseAllowed(os.Getenv("AI_DIAGNOSIS_ALLOWED_USERS")),
	}
}

var userKeyPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

// parseAllowed はカンマ区切りの userKey を集合にする。16桁 hex 以外は捨てる(値は出さない)。
func parseAllowed(s string) map[string]bool {
	allowed := map[string]bool{}
	for _, p := range strings.Split(s, ",") {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if !userKeyPattern.MatchString(p) {
			log.Printf("[WARN] ai-diagnosis: 許可リストの不正な項目を無視 (len=%d)", len(p))
			continue
		}
		allowed[p] = true
	}
	return allowed
}
