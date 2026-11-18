package firestore

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	aiDiagnosisCollection = "ai_diagnosis"
	aiDailyCollection     = "ai_diagnosis_daily"
	aiDocTTL              = 7 * 24 * time.Hour
)

// aiDiagnosisDoc は ai_diagnosis/{userKey} ドキュメント。
type aiDiagnosisDoc struct {
	Status      string    `firestore:"status"`
	RequestID   string    `firestore:"request_id"`
	PlayDay     string    `firestore:"play_day"`
	InputJSON   string    `firestore:"input_json"`
	ResultJSON  string    `firestore:"result_json"`
	ErrorCode   string    `firestore:"error_code"`
	LeaseOwner  string    `firestore:"lease_owner"`
	Attempts    int       `firestore:"attempts"`
	RequestedAt time.Time `firestore:"requested_at"`
	LeaseUntil  time.Time `firestore:"lease_until"`
	FinishedAt  time.Time `firestore:"finished_at"`
}

func (d aiDiagnosisDoc) state(userKey string) model.AIDiagnosisState {
	return model.AIDiagnosisState{
		UserKey: userKey, RequestID: d.RequestID, Status: d.Status, PlayDay: d.PlayDay,
		InputJSON: d.InputJSON, ResultJSON: d.ResultJSON, ErrorCode: d.ErrorCode, LeaseOwner: d.LeaseOwner,
		Attempts: d.Attempts, RequestedAt: d.RequestedAt, LeaseUntil: d.LeaseUntil, FinishedAt: d.FinishedAt,
	}
}

func aiDiagnosisRef(userKey string) (*firestore.DocumentRef, *firestore.Client, error) {
	c := getClient()
	if c == nil {
		return nil, nil, fmt.Errorf("firestore client not initialized")
	}
	return c.Collection(aiDiagnosisCollection).Doc(userKey), c, nil
}

func aiSnapshotState(doc *firestore.DocumentSnapshot) (model.AIDiagnosisState, error) {
	var d aiDiagnosisDoc
	if err := doc.DataTo(&d); err != nil {
		return model.AIDiagnosisState{}, fmt.Errorf("parse ai_diagnosis: %w", err)
	}
	return d.state(doc.Ref.ID), nil
}

// GetAIDiagnosis は AI 診断の状態を返す。ドキュメントが無ければ nil, nil。
func GetAIDiagnosis(ctx context.Context, userKey string) (*model.AIDiagnosisState, error) {
	ref, _, err := aiDiagnosisRef(userKey)
	if err != nil {
		return nil, err
	}
	doc, err := ref.Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("get ai_diagnosis: %w", err)
	}
	st, err := aiSnapshotState(doc)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// RequestAIDiagnosis は1日の判定と全体の日次カウントを同じトランザクションで行い、ok なら pending で保存する。
// decide は (状態, 当日の全体件数) から (verdict, 保存する試行回数) を返す。verdict が "ok" のときだけ書く。
func RequestAIDiagnosis(ctx context.Context, userKey, day string, now time.Time, inputJSON, requestID string,
	decide func(*model.AIDiagnosisState, int) (string, int)) (verdict string, err error) {
	ref, c, err := aiDiagnosisRef(userKey)
	if err != nil {
		return "", err
	}
	dailyRef := c.Collection(aiDailyCollection).Doc(day)
	err = c.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		verdict = ""
		var st *model.AIDiagnosisState
		doc, getErr := tx.Get(ref)
		switch {
		case getErr == nil:
			s, parseErr := aiSnapshotState(doc)
			if parseErr != nil {
				return parseErr
			}
			st = &s
		case status.Code(getErr) != codes.NotFound:
			return getErr
		}
		count := 0
		dailyDoc, getErr := tx.Get(dailyRef)
		switch {
		case getErr == nil:
			var d struct {
				Count int `firestore:"count"`
			}
			if dataErr := dailyDoc.DataTo(&d); dataErr != nil {
				return fmt.Errorf("parse ai_diagnosis_daily %s: %w", day, dataErr)
			}
			count = d.Count
		case status.Code(getErr) != codes.NotFound:
			return getErr
		}
		v, attempts := decide(st, count)
		if v != "ok" {
			verdict = v
			return nil
		}
		expire := now.Add(aiDocTTL)
		if setErr := tx.Set(ref, map[string]interface{}{
			"status": "pending", "request_id": requestID, "play_day": day, "input_json": inputJSON,
			"result_json": "", "error_code": "", "lease_owner": "", "attempts": attempts,
			"requested_at": now, "lease_until": time.Time{}, "finished_at": time.Time{},
			"expire_at": expire, "updated_at": firestore.ServerTimestamp,
		}); setErr != nil {
			return setErr
		}
		if setErr := tx.Set(dailyRef, map[string]interface{}{"count": count + 1, "expire_at": expire}); setErr != nil {
			return setErr
		}
		verdict = v
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("request ai_diagnosis: %w", err)
	}
	return verdict, nil
}

// FailAIDiagnosis は request_id が一致する pending を error にする。
func FailAIDiagnosis(ctx context.Context, userKey, requestID, code string) error {
	ref, c, err := aiDiagnosisRef(userKey)
	if err != nil {
		return err
	}
	err = c.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		doc, getErr := tx.Get(ref)
		if getErr != nil {
			if status.Code(getErr) == codes.NotFound {
				return nil
			}
			return getErr
		}
		st, parseErr := aiSnapshotState(doc)
		if parseErr != nil {
			return parseErr
		}
		if st.RequestID != requestID || st.Status != "pending" {
			return nil
		}
		return tx.Set(ref, map[string]interface{}{
			"status": "error", "error_code": code, "finished_at": time.Now(), "updated_at": firestore.ServerTimestamp,
		}, firestore.MergeAll)
	})
	if err != nil {
		return fmt.Errorf("fail ai_diagnosis: %w", err)
	}
	return nil
}

// ErrAILeaseLost は確保した lease を失った(他の実行が引き継いだ、または既に終わっている)ことを表す。
var ErrAILeaseLost = errors.New("ai_diagnosis の lease を失っている")

// ListPendingAIDiagnosis は status が pending の診断を最大 limit 件返す(単一フィールドの等価なので自動インデックスで足りる)。
func ListPendingAIDiagnosis(ctx context.Context, limit int) ([]model.AIDiagnosisState, error) {
	c := getClient()
	if c == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}
	docs, err := c.Collection(aiDiagnosisCollection).Where("status", "==", "pending").Limit(limit).Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("list pending ai_diagnosis: %w", err)
	}
	states := make([]model.AIDiagnosisState, 0, len(docs))
	skipped := 0
	for _, doc := range docs {
		st, err := aiSnapshotState(doc)
		if err != nil {
			skipped++
			continue
		}
		states = append(states, st)
	}
	if skipped > 0 {
		log.Printf("[WARN] ai_diagnosis: 読めないドキュメントを %d 件スキップ", skipped)
	}
	return states, nil
}

// ClaimAIDiagnosis は pending で request_id が一致する診断を running にして lease を付ける。
// pending のまま pendingStale を過ぎていれば error(timeout)にして false を返す。
func ClaimAIDiagnosis(ctx context.Context, userKey, requestID, owner string, now time.Time, lease, pendingStale time.Duration) (bool, error) {
	ref, c, err := aiDiagnosisRef(userKey)
	if err != nil {
		return false, err
	}
	claimed := false
	err = c.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		claimed = false
		doc, getErr := tx.Get(ref)
		if getErr != nil {
			if status.Code(getErr) == codes.NotFound {
				return nil
			}
			return getErr
		}
		st, parseErr := aiSnapshotState(doc)
		if parseErr != nil {
			return parseErr
		}
		if st.RequestID != requestID || st.Status != "pending" {
			return nil
		}
		if now.Sub(st.RequestedAt) > pendingStale {
			return tx.Set(ref, map[string]interface{}{
				"status": "error", "error_code": "timeout", "finished_at": now, "updated_at": firestore.ServerTimestamp,
			}, firestore.MergeAll)
		}
		claimed = true
		return tx.Set(ref, map[string]interface{}{
			"status": "running", "lease_owner": owner, "lease_until": now.Add(lease), "updated_at": firestore.ServerTimestamp,
		}, firestore.MergeAll)
	})
	if err != nil {
		return false, fmt.Errorf("claim ai_diagnosis: %w", err)
	}
	return claimed, nil
}

// FinishAIDiagnosis は running で request_id と lease_owner が一致するときだけ結果を書く。一致しなければ ErrAILeaseLost。
func FinishAIDiagnosis(ctx context.Context, userKey, requestID, owner, finalStatus, resultJSON, code string, now time.Time) error {
	ref, c, err := aiDiagnosisRef(userKey)
	if err != nil {
		return err
	}
	err = c.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		doc, getErr := tx.Get(ref)
		if getErr != nil {
			if status.Code(getErr) == codes.NotFound {
				return ErrAILeaseLost
			}
			return getErr
		}
		st, parseErr := aiSnapshotState(doc)
		if parseErr != nil {
			return parseErr
		}
		if st.RequestID != requestID || st.Status != "running" || st.LeaseOwner != owner {
			return ErrAILeaseLost
		}
		return tx.Set(ref, map[string]interface{}{
			"status": finalStatus, "result_json": resultJSON, "error_code": code,
			"finished_at": now, "updated_at": firestore.ServerTimestamp,
		}, firestore.MergeAll)
	})
	if err != nil {
		return fmt.Errorf("finish ai_diagnosis: %w", err)
	}
	return nil
}
