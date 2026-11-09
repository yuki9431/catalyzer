package firestore

import (
	"context"
	"errors"
	"fmt"

	"cloud.google.com/go/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
)

// BackfillResult は対戦形式の補完の集計
type BackfillResult struct {
	Fixed   int // 固定と推定した試合
	Shuffle int // シャッフルと推定した試合
	Skipped int // 自分か相方の記録が無く推定できない試合
}

// inferForDoc は形式が空の試合に入れる形式を返す。補完しない試合は ""
func inferForDoc(md matchDoc, infer func(partnerName, teamName string) string) (mode string, skipped bool) {
	if md.MatchMode != "" {
		return "", false
	}
	var me, partner *playerDoc
	for i := range md.Players {
		switch md.Players[i].PlayerNo {
		case 1:
			me = &md.Players[i]
		case 2:
			partner = &md.Players[i]
		}
	}
	if me == nil || partner == nil {
		return "", true
	}
	return infer(partner.Name, me.TeamName), false
}

// BackfillMatchModes は対戦形式が空の試合に推定した形式を書く。推定の印 match_mode_inferred を付け、execute が false なら数えるだけ
func BackfillMatchModes(ctx context.Context, userKey string, infer func(partnerName, teamName string) string, execute bool) (BackfillResult, error) {
	var res BackfillResult
	c := getClient()
	if c == nil {
		return res, fmt.Errorf("firestore client not initialized")
	}
	docs, err := c.Collection("users").Doc(userKey).Collection("matches").Documents(ctx).GetAll()
	if err != nil {
		return res, fmt.Errorf("query matches: %w", err)
	}

	var bw *firestore.BulkWriter
	var jobs []*firestore.BulkWriterJob
	if execute {
		bw = c.BulkWriter(ctx)
	}
	for _, doc := range docs {
		var md matchDoc
		if err := doc.DataTo(&md); err != nil {
			return res, fmt.Errorf("parse match %s: %w", doc.Ref.ID, err)
		}
		mode, skipped := inferForDoc(md, infer)
		switch {
		case skipped:
			res.Skipped++
			continue
		case mode == "":
			continue
		case mode == model.MatchModeFixed:
			res.Fixed++
		default:
			res.Shuffle++
		}
		if bw == nil {
			continue
		}
		job, err := bw.Update(doc.Ref, []firestore.Update{{Path: "match_mode", Value: mode}, {Path: "match_mode_inferred", Value: true}})
		if err != nil {
			return res, fmt.Errorf("enqueue update %s: %w", doc.Ref.ID, err)
		}
		jobs = append(jobs, job)
	}
	if bw == nil {
		return res, nil
	}
	bw.End()
	var errs []error
	for _, j := range jobs {
		if _, err := j.Results(); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return res, fmt.Errorf("update %d/%d matches failed: %w", len(errs), len(jobs), errors.Join(errs...))
	}
	return res, nil
}
