package aidiagnosis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/yuki9431/catalyzer/internal/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"google.golang.org/grpc/status"
)

const jobBatch = 3

// jobStore は Job が使う保存先。
type jobStore interface {
	ListPending(ctx context.Context, limit int) ([]model.AIDiagnosisState, error)
	Claim(ctx context.Context, userKey, requestID, owner string, now time.Time) (bool, error)
	Finish(ctx context.Context, userKey, requestID, owner, status, resultJSON, code string, now time.Time) error
}

type fsStore struct{}

func (fsStore) ListPending(ctx context.Context, limit int) ([]model.AIDiagnosisState, error) {
	return firestore.ListPendingAIDiagnosis(ctx, limit)
}

func (fsStore) Claim(ctx context.Context, userKey, requestID, owner string, now time.Time) (bool, error) {
	return firestore.ClaimAIDiagnosis(ctx, userKey, requestID, owner, now, JobLease, PendingStale)
}

func (fsStore) Finish(ctx context.Context, userKey, requestID, owner, status, resultJSON, code string, now time.Time) error {
	return firestore.FinishAIDiagnosis(ctx, userKey, requestID, owner, status, resultJSON, code, now)
}

type jobDeps struct {
	store  jobStore
	runner Runner
	token  string
	now    func() time.Time
}

// RunJob は pending の診断を確保して順に処理する。Firestore は初期化済みであること。
// owner が空なら CLOUD_RUN_EXECUTION を使い、末尾に uuid を付ける。
func RunJob(ctx context.Context, owner string) error {
	if owner == "" {
		owner = os.Getenv("CLOUD_RUN_EXECUTION")
	}
	d := jobDeps{store: fsStore{}, runner: execRunner{}, token: os.Getenv("CLAUDE_CODE_OAUTH_TOKEN"), now: time.Now}
	return runJob(ctx, d, owner+":"+uuid.NewString())
}

func runJob(ctx context.Context, d jobDeps, owner string) error {
	pending, err := d.store.ListPending(ctx, jobBatch)
	if err != nil {
		return fmt.Errorf("pending の一覧取得: %w", errKind(err))
	}
	for i, st := range pending {
		processOne(ctx, d, st, owner, i)
	}
	log.Printf("[INFO] ai-diagnosis: pending=%d", len(pending))
	return nil
}

// processOne は1件を確保して診断する。失敗はログに残すだけで、他の件に波及させない。userKey はログに出さない。
func processOne(ctx context.Context, d jobDeps, st model.AIDiagnosisState, owner string, idx int) {
	ok, err := d.store.Claim(ctx, st.UserKey, st.RequestID, owner, d.now())
	if err != nil {
		log.Printf("[WARN] ai-diagnosis: #%d 確保に失敗: %s", idx, errKind(err))
		return
	}
	if !ok {
		log.Printf("[INFO] ai-diagnosis: #%d 他で確保済みか期限切れのためスキップ", idx)
		return
	}
	result, code := diagnose(ctx, d, st.InputJSON, idx)
	status := "done"
	if code != "" {
		status = "error"
	}
	if err := d.store.Finish(ctx, st.UserKey, st.RequestID, owner, status, result, code, d.now()); err != nil {
		log.Printf("[WARN] ai-diagnosis: #%d 結果の保存に失敗: %s", idx, errKind(err))
		return
	}
	log.Printf("[INFO] ai-diagnosis: #%d status=%s code=%s", idx, status, code)
}

// kindError は Error() では種類だけを返し、Unwrap() で元エラーを残す。
type kindError struct {
	kind string
	err  error
}

func (e *kindError) Error() string { return e.kind }
func (e *kindError) Unwrap() error { return e.err }

// errKind はログ用にエラーの種類だけを見せるエラーを返す。gRPC のメッセージにはドキュメントパス(userKey)が入るため本文は出さない。
func errKind(err error) error {
	if errors.Is(err, firestore.ErrAILeaseLost) {
		return &kindError{"lease_lost", err}
	}
	return &kindError{"code=" + status.Code(err).String(), err}
}

// diagnose は保存する結果 JSON か失敗コードを返す。
func diagnose(ctx context.Context, d jobDeps, inputJSON string, idx int) (result, code string) {
	llmInput, err := BuildLLMInput([]byte(inputJSON))
	if err != nil {
		return "", CodeInvalidInput
	}
	out, err := runClaude(ctx, d.runner, d.token, llmInput)
	if err != nil {
		var f *Failure
		if errors.As(err, &f) {
			log.Printf("[WARN] ai-diagnosis: #%d %s", idx, f.Error())
			return "", f.Code
		}
		return "", CodeClaudeFailed
	}
	if vs := CheckOutput(out, llmInput); len(vs) > 0 {
		for _, v := range vs {
			log.Printf("[WARN] ai-diagnosis: #%d 検査違反 item=%s rule=%s", idx, v.Item, v.Rule)
		}
		return "", CodeInvalidOutput
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "", CodeInvalidOutput
	}
	return string(b), ""
}

// Smoke は埋め込みのサンプル入力で実行と検査だけを行い、検査済みの結果 JSON を w に出す。Firestore は使わない。
func Smoke(ctx context.Context, w io.Writer) error {
	llmInput, err := BuildLLMInput(sampleInput)
	if err != nil {
		return fmt.Errorf("サンプル入力: %w", err)
	}
	out, err := runClaude(ctx, execRunner{}, os.Getenv("CLAUDE_CODE_OAUTH_TOKEN"), llmInput)
	if err != nil {
		return err
	}
	if vs := CheckOutput(out, llmInput); len(vs) > 0 {
		return fmt.Errorf("検査違反 %d 件: %v", len(vs), vs)
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}
