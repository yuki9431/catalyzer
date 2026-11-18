package aidiagnosis

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestBuildCmd(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "x")
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "x")
	t.Setenv("CLAUDE_CODE_EFFORT_LEVEL", "high")
	tmp := t.TempDir()
	c, err := buildCmd(tmp, "tok", []byte(`{"a":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if c.Path != "claude" {
		t.Errorf("Path = %q", c.Path)
	}
	wantArgs := []string{
		"-p", "次の入力JSONだけを根拠に診断し、指定のスキーマで返す。\n<input>\n{\"a\":1}\n</input>",
		"--output-format", "json",
		"--json-schema", outputSchema,
		"--system-prompt-file", filepath.Join(tmp, "system.md"),
		"--tools", "",
		"--model", "claude-opus-5-5",
		"--effort", "low",
		"--no-session-persistence",
		"--strict-mcp-config",
		"--disable-slash-commands",
	}
	if !reflect.DeepEqual(c.Args, wantArgs) {
		t.Errorf("Args が一致しない:\n got %q\nwant %q", c.Args, wantArgs)
	}
	wantEnv := []string{
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		"HOME=" + filepath.Join(tmp, "home"),
		"CLAUDE_CONFIG_DIR=" + filepath.Join(tmp, "config"),
		"CLAUDE_CODE_OAUTH_TOKEN=tok",
		"DISABLE_AUTOUPDATER=1",
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
		"DISABLE_TELEMETRY=1",
		"CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
	}
	if !reflect.DeepEqual(c.Env, wantEnv) {
		t.Errorf("Env が一致しない: %q", c.Env)
	}
	for _, e := range c.Env {
		if strings.HasPrefix(e, "ANTHROPIC_") || strings.HasPrefix(e, "CLAUDE_CODE_EFFORT_LEVEL") {
			t.Errorf("継承してはいけない env: %s", strings.SplitN(e, "=", 2)[0])
		}
	}
	if c.Dir != filepath.Join(tmp, "work") {
		t.Errorf("Dir = %q", c.Dir)
	}
	if entries, err := os.ReadDir(c.Dir); err != nil || len(entries) != 0 {
		t.Errorf("work は空であること: %v %v", entries, err)
	}
	if b, err := os.ReadFile(filepath.Join(tmp, "system.md")); err != nil || string(b) != systemPrompt {
		t.Errorf("system.md が埋め込みと違う: %v", err)
	}
}

func TestParseCLIResult(t *testing.T) {
	good := `{"type":"result","subtype":"success","is_error":false,"structured_output":{"headline":{"text":"h","evidence":["sample"]},"tendencies":[],"cautions":[],"strengths":[]}}`
	out, err := parseCLIResult([]byte(good), nil)
	if err != nil || out.Headline.Text != "h" {
		t.Fatalf("success: %v %v", out, err)
	}
	cases := []struct {
		name   string
		stdout string
		runErr error
		code   string
	}{
		{"is_error", `{"subtype":"success","is_error":true,"structured_output":{}}`, nil, CodeClaudeFailed},
		{"retries 超過", `{"subtype":"error_max_structured_output_retries","is_error":true}`, nil, CodeClaudeFailed},
		{"subtype が success 以外", `{"subtype":"error_during_execution","is_error":false,"structured_output":{}}`, nil, CodeClaudeFailed},
		{"structured_output 欠落", `{"subtype":"success","is_error":false}`, nil, CodeClaudeFailed},
		{"structured_output が null", `{"subtype":"success","is_error":false,"structured_output":null}`, nil, CodeClaudeFailed},
		{"exit 非0", good, errors.New("exit status 1"), CodeClaudeFailed},
		{"JSON でない", `oops`, nil, CodeClaudeFailed},
		{"未知のフィールド", `{"subtype":"success","is_error":false,"structured_output":{"zzz":1}}`, nil, CodeInvalidOutput},
	}
	_, err = parseCLIResult([]byte(`{"subtype":"error_during_execution","is_error":true,"result":"SECRET"}`), errors.New("exit status 1"))
	var ef *Failure
	if !errors.As(err, &ef) || ef.Code != CodeClaudeFailed || !strings.Contains(ef.Detail, "error_during_execution") || strings.Contains(ef.Detail, "SECRET") {
		t.Errorf("exit≠0 かつ is_error JSON: err = %v", err)
	}
	for _, c := range cases {
		_, err := parseCLIResult([]byte(c.stdout), c.runErr)
		var f *Failure
		if !errors.As(err, &f) || f.Code != c.code {
			t.Errorf("%s: err = %v, want code %s", c.name, err, c.code)
		}
	}
}
