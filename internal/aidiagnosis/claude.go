package aidiagnosis

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

// 失敗コード。GET /ai-diagnosis の文言の対応表(server)と揃える。
const (
	CodeClaudeFailed  = "claude_failed"
	CodeTimeout       = "timeout"
	CodeInvalidOutput = "invalid_output"
	CodeConfig        = "config"
	CodeInvalidInput  = "invalid_input"
)

const (
	cliModel    = "claude-opus-5-5"
	maxStdout   = 1 << 20
	userMessage = "次の入力JSONだけを根拠に診断し、指定のスキーマで返す。\n<input>\n%s\n</input>"
)

// Failure は保存する失敗コードを持つエラー。Detail にトークン・本文・userKey を入れない。
type Failure struct{ Code, Detail string }

func (f *Failure) Error() string { return f.Code + ": " + f.Detail }

// Cmd は実行する外部コマンド。Env は親を継承せず、これだけを渡す。
type Cmd struct {
	Path string
	Args []string
	Env  []string
	Dir  string
}

// claudeWaitDelay は kill 後に子プロセスの出力パイプが閉じるのを待つ上限。
const claudeWaitDelay = 5 * time.Second

// Runner は Cmd を実行して stdout を返す。テストで差し替える。
type Runner interface {
	Run(ctx context.Context, c Cmd) (stdout []byte, err error)
}

type execRunner struct{}

// limitedBuffer は max を超えた分を捨てて overflow を立てる。
type limitedBuffer struct {
	buf      bytes.Buffer
	overflow bool
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if room := maxStdout - l.buf.Len(); n > room {
		l.overflow = true
		p = p[:max(room, 0)]
	}
	l.buf.Write(p)
	// 切り詰めても n を返す。短い書き込みは io.ErrShortWrite になり子プロセスの出力が途切れる
	return n, nil
}

func (execRunner) Run(ctx context.Context, c Cmd) ([]byte, error) {
	cmd := exec.CommandContext(ctx, c.Path, c.Args...)
	cmd.Env = c.Env
	cmd.Dir = c.Dir
	out := &limitedBuffer{}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	cmd.WaitDelay = claudeWaitDelay
	// exit≠0 でも stdout に is_error の JSON が出るので、読めるよう stdout も返す。
	if err := cmd.Run(); err != nil {
		return out.buf.Bytes(), fmt.Errorf("claude の実行: %w", err)
	}
	if out.overflow {
		return nil, errors.New("claude の出力が上限を超えた")
	}
	return out.buf.Bytes(), nil
}

// buildCmd は tmp の下に作業領域を作り、claude の実行内容を組み立てる。引数の順は固定。
func buildCmd(tmp, token string, llmInput []byte) (Cmd, error) {
	for _, d := range []string{"home", "config", "work"} {
		if err := os.Mkdir(filepath.Join(tmp, d), 0o700); err != nil {
			return Cmd{}, fmt.Errorf("作業領域の作成: %w", err)
		}
	}
	sys := filepath.Join(tmp, "system.md")
	if err := os.WriteFile(sys, []byte(systemPrompt), 0o600); err != nil {
		return Cmd{}, fmt.Errorf("system.md の書き出し: %w", err)
	}
	return Cmd{
		Path: "claude",
		Args: []string{
			"-p", fmt.Sprintf(userMessage, llmInput),
			"--output-format", "json",
			"--json-schema", outputSchema,
			"--system-prompt-file", sys,
			"--tools", "",
			"--model", cliModel,
			"--effort", "low",
			"--no-session-persistence",
			"--strict-mcp-config",
			"--disable-slash-commands",
		},
		Env: []string{
			"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
			"HOME=" + filepath.Join(tmp, "home"),
			"CLAUDE_CONFIG_DIR=" + filepath.Join(tmp, "config"),
			"CLAUDE_CODE_OAUTH_TOKEN=" + token,
			"DISABLE_AUTOUPDATER=1",
			"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
			"DISABLE_TELEMETRY=1",
			"CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
		},
		Dir: filepath.Join(tmp, "work"),
	}, nil
}

// parseCLIResult は claude の JSON 出力から Output を取り出す。失敗は *Failure で返す。
func parseCLIResult(stdout []byte, runErr error) (Output, error) {
	var res struct {
		IsError          bool            `json:"is_error"`
		Subtype          string          `json:"subtype"`
		StructuredOutput json.RawMessage `json:"structured_output"`
	}
	parseErr := json.Unmarshal(stdout, &res)
	switch {
	case runErr != nil && parseErr == nil:
		return Output{}, &Failure{CodeClaudeFailed, "claude が失敗した subtype=" + res.Subtype + " is_error=" + strconv.FormatBool(res.IsError)}
	case runErr != nil:
		return Output{}, &Failure{CodeClaudeFailed, "claude が失敗した"}
	case parseErr != nil:
		return Output{}, &Failure{CodeClaudeFailed, "出力が JSON ではない"}
	case res.IsError || res.Subtype != "success" || len(res.StructuredOutput) == 0 || string(res.StructuredOutput) == "null":
		return Output{}, &Failure{CodeClaudeFailed, "subtype=" + res.Subtype}
	}
	var out Output
	dec := json.NewDecoder(bytes.NewReader(res.StructuredOutput))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&out); err != nil {
		return Output{}, &Failure{CodeInvalidOutput, "structured_output の形が不正"}
	}
	return out, nil
}

// runClaude は使い捨ての作業領域で claude を1回だけ実行する(再試行しない)。
func runClaude(ctx context.Context, r Runner, token string, llmInput []byte) (Output, error) {
	if token == "" {
		return Output{}, &Failure{CodeConfig, "CLAUDE_CODE_OAUTH_TOKEN が空"}
	}
	tmp, err := os.MkdirTemp("", "aidiag-")
	if err != nil {
		return Output{}, &Failure{CodeConfig, "一時ディレクトリを作れない"}
	}
	defer func() { _ = os.RemoveAll(tmp) }()
	cmd, err := buildCmd(tmp, token, llmInput)
	if err != nil {
		return Output{}, &Failure{CodeConfig, "作業領域を作れない"}
	}
	runCtx, cancel := context.WithTimeout(ctx, ClaudeTimeout)
	defer cancel()
	stdout, runErr := r.Run(runCtx, cmd)
	if runErr != nil && errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		return Output{}, &Failure{CodeTimeout, "claude が時間内に終わらなかった"}
	}
	return parseCLIResult(stdout, runErr)
}
