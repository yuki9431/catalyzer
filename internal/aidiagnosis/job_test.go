package aidiagnosis

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

type fakeStore struct {
	pending  []model.AIDiagnosisState
	claimOK  map[string]bool
	claimErr error
	finished []finishCall
}

type finishCall struct{ userKey, status, result, code string }

func (f *fakeStore) ListPending(context.Context, int) ([]model.AIDiagnosisState, error) {
	return f.pending, nil
}

func (f *fakeStore) Claim(_ context.Context, userKey, _, _ string, _ time.Time) (bool, error) {
	if f.claimErr != nil {
		return false, f.claimErr
	}
	return f.claimOK[userKey], nil
}

func (f *fakeStore) Finish(_ context.Context, userKey, _, _, status, result, code string, _ time.Time) error {
	f.finished = append(f.finished, finishCall{userKey, status, result, code})
	return nil
}

type fakeRunner struct {
	stdout []byte
	err    error
	cmds   []Cmd
}

func (f *fakeRunner) Run(_ context.Context, c Cmd) ([]byte, error) {
	f.cmds = append(f.cmds, c)
	return f.stdout, f.err
}

func cliSuccess(t *testing.T, o Output) []byte {
	t.Helper()
	so, err := json.Marshal(o)
	if err != nil {
		t.Fatal(err)
	}
	return []byte(`{"subtype":"success","is_error":false,"structured_output":` + string(so) + `}`)
}

func TestRunJob(t *testing.T) {
	input := string(sampleInput)
	llm, err := BuildLLMInput(sampleInput)
	if err != nil {
		t.Fatal(err)
	}
	if vs := CheckOutput(validOutput(), llm); len(vs) != 0 {
		t.Fatal(vs)
	}
	bad := validOutput()
	bad.Headline.Text = "勝率は99%"

	run := func(t *testing.T, stdout []byte, token string, states ...model.AIDiagnosisState) (*fakeStore, *fakeRunner) {
		t.Helper()
		st := &fakeStore{pending: states, claimOK: map[string]bool{}}
		for _, s := range states {
			st.claimOK[s.UserKey] = s.RequestID != "lost"
		}
		r := &fakeRunner{stdout: stdout}
		d := jobDeps{store: st, runner: r, token: token, now: time.Now}
		if err := runJob(context.Background(), d, "owner"); err != nil {
			t.Fatal(err)
		}
		return st, r
	}
	pend := func(key, req string) model.AIDiagnosisState {
		return model.AIDiagnosisState{UserKey: key, RequestID: req, InputJSON: input, Status: "pending"}
	}

	t.Run("成功で done", func(t *testing.T) {
		st, r := run(t, cliSuccess(t, validOutput()), "tok", pend("u1", "r1"))
		if len(st.finished) != 1 || st.finished[0].status != "done" || st.finished[0].code != "" {
			t.Fatalf("finished = %+v", st.finished)
		}
		var got Output
		if err := json.Unmarshal([]byte(st.finished[0].result), &got); err != nil || got.Headline.Text != validOutput().Headline.Text {
			t.Errorf("保存した結果が不正: %v", err)
		}
		// tmp が消えている
		if len(r.cmds) != 1 {
			t.Fatalf("実行回数 = %d", len(r.cmds))
		}
		if _, err := os.Stat(filepath.Dir(r.cmds[0].Dir)); !os.IsNotExist(err) {
			t.Errorf("作業領域が残っている: %v", err)
		}
	})
	t.Run("検査違反は invalid_output", func(t *testing.T) {
		st, _ := run(t, cliSuccess(t, bad), "tok", pend("u1", "r1"))
		if len(st.finished) != 1 || st.finished[0].status != "error" || st.finished[0].code != CodeInvalidOutput {
			t.Fatalf("finished = %+v", st.finished)
		}
		if st.finished[0].result != "" {
			t.Error("違反した出力を保存している")
		}
	})
	t.Run("Claim 失敗はスキップして他は続ける", func(t *testing.T) {
		st, r := run(t, cliSuccess(t, validOutput()), "tok", pend("u1", "lost"), pend("u2", "r2"))
		if len(st.finished) != 1 || st.finished[0].userKey != "u2" || len(r.cmds) != 1 {
			t.Fatalf("finished = %+v, cmds = %d", st.finished, len(r.cmds))
		}
	})
	t.Run("Claim のエラーでも他は続ける", func(t *testing.T) {
		st := &fakeStore{pending: []model.AIDiagnosisState{pend("u1", "r1")}, claimErr: errors.New("boom")}
		d := jobDeps{store: st, runner: &fakeRunner{}, token: "tok", now: time.Now}
		if err := runJob(context.Background(), d, "owner"); err != nil || len(st.finished) != 0 {
			t.Errorf("err=%v finished=%v", err, st.finished)
		}
	})
	t.Run("トークンが空は config", func(t *testing.T) {
		st, r := run(t, nil, "", pend("u1", "r1"))
		if len(st.finished) != 1 || st.finished[0].code != CodeConfig || len(r.cmds) != 0 {
			t.Fatalf("finished = %+v, cmds = %d", st.finished, len(r.cmds))
		}
	})
	t.Run("claude の失敗は claude_failed", func(t *testing.T) {
		st, _ := run(t, []byte(`{"subtype":"error_max_structured_output_retries","is_error":true}`), "tok", pend("u1", "r1"))
		if len(st.finished) != 1 || st.finished[0].code != CodeClaudeFailed {
			t.Fatalf("finished = %+v", st.finished)
		}
	})
}
