package firestore

import (
	"context"
	"fmt"
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
		return model.AIDiagnosisState{}, fmt.Errorf("parse ai_diagnosis %s: %w", doc.Ref.ID, err)
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
