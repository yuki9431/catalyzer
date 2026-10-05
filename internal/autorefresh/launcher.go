package autorefresh

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

	"golang.org/x/oauth2/google"
)

// runAPIBase は Cloud Run Admin API のベース URL(テストで差し替える)。
var runAPIBase = "https://run.googleapis.com"

// NewLaunchClient は Job 起動用の認証済み HTTP クライアント(ADC)を返す。
func NewLaunchClient(ctx context.Context) (*http.Client, error) {
	c, err := google.DefaultClient(ctx, "https://www.googleapis.com/auth/cloud-platform")
	if err != nil {
		return nil, fmt.Errorf("ADC クライアント: %w", err)
	}
	return c, nil
}

// LaunchJob は Cloud Run Job を overrides なしで起動する。jobName は projects/*/locations/*/jobs/* 形式。
func LaunchJob(ctx context.Context, client *http.Client, jobName string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, runAPIBase+"/v2/"+jobName+":run", bytes.NewReader([]byte("{}")))
	if err != nil {
		return fmt.Errorf("起動リクエスト作成: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Job 起動: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("Job 起動が HTTP %d: %s", resp.StatusCode, body)
	}
	return nil
}
