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

const autoRefreshCollection = "auto_refresh"

// touchInterval 以内に同じ token で来た touch は書き込まない(書き込み回数の抑制)。
const touchInterval = 60 * time.Second

// autoRefreshDoc は auto_refresh/{userKey} ドキュメント。
type autoRefreshDoc struct {
	Enabled             bool      `firestore:"enabled"`
	SessionToken        string    `firestore:"session_token"`
	PassphraseFP        string    `firestore:"passphrase_fp"`
	LastAccess          time.Time `firestore:"last_access"`
	ActiveUntil         time.Time `firestore:"active_until"`
	LeaseUntil          time.Time `firestore:"lease_until"`
	LeaseOwner          string    `firestore:"lease_owner"`
	LastRunAt           time.Time `firestore:"last_run_at"`
	LastResult          string    `firestore:"last_result"`
	ConsecutiveFailures int       `firestore:"consecutive_failures"`
}

func (d autoRefreshDoc) state(userKey string) model.AutoRefreshState {
	return model.AutoRefreshState{
		UserKey: userKey, SessionToken: d.SessionToken, PassphraseFP: d.PassphraseFP,
		LeaseOwner: d.LeaseOwner, LastResult: d.LastResult, Enabled: d.Enabled,
		LastAccess: d.LastAccess, ActiveUntil: d.ActiveUntil, LeaseUntil: d.LeaseUntil,
		LastRunAt: d.LastRunAt, ConsecutiveFailures: d.ConsecutiveFailures,
	}
}

func autoRefreshRef(userKey string) (*firestore.DocumentRef, *firestore.Client, error) {
	c := getClient()
	if c == nil {
		return nil, nil, fmt.Errorf("firestore client not initialized")
	}
	return c.Collection(autoRefreshCollection).Doc(userKey), c, nil
}

func snapshotState(doc *firestore.DocumentSnapshot) (model.AutoRefreshState, error) {
	var d autoRefreshDoc
	if err := doc.DataTo(&d); err != nil {
		return model.AutoRefreshState{}, fmt.Errorf("parse auto_refresh %s: %w", doc.Ref.ID, err)
	}
	return d.state(doc.Ref.ID), nil
}

// GetAutoRefresh は自動更新の状態を返す。ドキュメントが無ければ nil, nil。
func GetAutoRefresh(ctx context.Context, userKey string) (*model.AutoRefreshState, error) {
	ref, _, err := autoRefreshRef(userKey)
	if err != nil {
		return nil, err
	}
	doc, err := ref.Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("get auto_refresh: %w", err)
	}
	st, err := snapshotState(doc)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// enableFields は有効化で書くフィールドを返す。lease には触れない(手動分析の取得中なら lease が残り、Job はそのユーザーを取らない)。
func enableFields(token, fp string, now time.Time, window time.Duration) map[string]interface{} {
	return map[string]interface{}{
		"enabled":              true,
		"session_token":        token,
		"passphrase_fp":        fp,
		"last_access":          now,
		"active_until":         now.Add(window),
		"consecutive_failures": 0,
		"updated_at":           firestore.ServerTimestamp,
	}
}

// EnableAutoRefresh は自動更新を有効にする。失敗回数は 0 に戻す。
func EnableAutoRefresh(ctx context.Context, userKey, token, fp string, now time.Time, window time.Duration) error {
	ref, _, err := autoRefreshRef(userKey)
	if err != nil {
		return err
	}
	if _, err = ref.Set(ctx, enableFields(token, fp, now, window), firestore.MergeAll); err != nil {
		return fmt.Errorf("enable auto_refresh: %w", err)
	}
	return nil
}

// DisableAutoRefresh は自動更新を無効にし、tick の対象から外す。
func DisableAutoRefresh(ctx context.Context, userKey string) error {
	ref, _, err := autoRefreshRef(userKey)
	if err != nil {
		return err
	}
	_, err = ref.Set(ctx, map[string]interface{}{
		"enabled":      false,
		"active_until": time.Time{},
		"updated_at":   firestore.ServerTimestamp,
	}, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("disable auto_refresh: %w", err)
	}
	return nil
}

// TouchAutoRefresh は有効なユーザーの最終アクセスと token を更新し、更新後の状態を返す。
// 無効・未登録なら書かずに状態(未登録は nil)を返す。直近 touchInterval 以内の同じ token は書かない。
func TouchAutoRefresh(ctx context.Context, userKey, token string, now time.Time, window time.Duration) (*model.AutoRefreshState, error) {
	ref, c, err := autoRefreshRef(userKey)
	if err != nil {
		return nil, err
	}
	var out *model.AutoRefreshState
	err = c.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		out = nil
		doc, getErr := tx.Get(ref)
		if getErr != nil {
			if status.Code(getErr) == codes.NotFound {
				return nil
			}
			return getErr
		}
		st, parseErr := snapshotState(doc)
		if parseErr != nil {
			return parseErr
		}
		out = &st
		if !st.Enabled {
			return nil
		}
		active := st.ActiveUntil.After(now)
		if active && st.SessionToken == token && now.Sub(st.LastAccess) < touchInterval {
			return nil
		}
		upd := map[string]interface{}{
			"session_token": token,
			"last_access":   now,
			"active_until":  now.Add(window),
			"updated_at":    firestore.ServerTimestamp,
		}
		if !active {
			upd["consecutive_failures"] = 0
			st.ConsecutiveFailures = 0
		}
		st.SessionToken, st.LastAccess, st.ActiveUntil = token, now, now.Add(window)
		return tx.Set(ref, upd, firestore.MergeAll)
	})
	if err != nil {
		return nil, fmt.Errorf("touch auto_refresh: %w", err)
	}
	return out, nil
}

// ListActiveAutoRefresh は active_until が now より後のドキュメントを返す(単一フィールドの index のみ)。
func ListActiveAutoRefresh(ctx context.Context, now time.Time) ([]model.AutoRefreshState, error) {
	c := getClient()
	if c == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}
	docs, err := c.Collection(autoRefreshCollection).Where("active_until", ">", now).Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("list active auto_refresh: %w", err)
	}
	out := make([]model.AutoRefreshState, 0, len(docs))
	for _, doc := range docs {
		st, err := snapshotState(doc)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, nil
}

// acquireLeaseFields は lease を取るときに書くフィールドを返す。他者が保持中なら ok=false。
// ドキュメントが無い(st が nil)ときも書く。手動分析の取得中に自動更新が有効にされても、
// 次の tick の Job がこの lease を見て同じアカウントを取らないようにする(#481)。
func acquireLeaseFields(st *model.AutoRefreshState, owner string, now time.Time, ttl time.Duration) (map[string]interface{}, bool) {
	if st != nil && !st.LeaseFree(owner, now) {
		return nil, false
	}
	return map[string]interface{}{
		"lease_until": now.Add(ttl),
		"lease_owner": owner,
		"updated_at":  firestore.ServerTimestamp,
	}, true
}

// AcquireRefreshLease は userKey の lease を取る。ドキュメントが無ければ lease だけのドキュメントを作る。
func AcquireRefreshLease(ctx context.Context, userKey, owner string, now time.Time, ttl time.Duration) (bool, error) {
	ref, c, err := autoRefreshRef(userKey)
	if err != nil {
		return false, err
	}
	acquired := false
	err = c.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		acquired = false
		var cur *model.AutoRefreshState
		doc, getErr := tx.Get(ref)
		switch {
		case status.Code(getErr) == codes.NotFound:
		case getErr != nil:
			return getErr
		default:
			st, parseErr := snapshotState(doc)
			if parseErr != nil {
				return parseErr
			}
			cur = &st
		}
		fields, ok := acquireLeaseFields(cur, owner, now, ttl)
		if !ok {
			return nil
		}
		acquired = true
		return tx.Set(ref, fields, firestore.MergeAll)
	})
	if err != nil {
		return false, fmt.Errorf("acquire refresh lease: %w", err)
	}
	return acquired, nil
}

// finishFields は終了時に書くフィールドを返す。token が処理中に変わっていたら(別端末の touch)token と期間は消さない。
func finishFields(st model.AutoRefreshState, upd model.RefreshUpdate, now time.Time) map[string]interface{} {
	fields := map[string]interface{}{
		"lease_until":          time.Time{},
		"lease_owner":          "",
		"last_run_at":          now,
		"last_result":          upd.LastResult,
		"consecutive_failures": upd.ConsecutiveFailures,
		"updated_at":           firestore.ServerTimestamp,
	}
	if st.SessionToken != upd.SessionToken {
		return fields
	}
	if upd.ClearSessionToken {
		fields["session_token"] = ""
	}
	if upd.StopActive {
		fields["active_until"] = time.Time{}
	}
	return fields
}

// FinishRefresh は owner が lease を持っているときだけ、lease を空けて結果を書く。
func FinishRefresh(ctx context.Context, userKey, owner string, upd model.RefreshUpdate) error {
	ref, c, err := autoRefreshRef(userKey)
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
		st, parseErr := snapshotState(doc)
		if parseErr != nil {
			return parseErr
		}
		if st.LeaseOwner != owner {
			return nil
		}
		return tx.Set(ref, finishFields(st, upd, time.Now()), firestore.MergeAll)
	})
	if err != nil {
		return fmt.Errorf("finish refresh: %w", err)
	}
	return nil
}

// releaseLeaseOp は lease の解放で行う操作を返す。owner が保持していなければ何もしない(apply=false)。
// 自動更新を一度も有効にしていない(lease のためだけに作った)ドキュメントは消す(remove=true)。
func releaseLeaseOp(st model.AutoRefreshState, owner string) (fields map[string]interface{}, remove, apply bool) {
	if st.LeaseOwner != owner {
		return nil, false, false
	}
	if !st.Enabled && st.PassphraseFP == "" {
		return nil, true, true
	}
	return map[string]interface{}{
		"lease_until": time.Time{},
		"lease_owner": "",
		"updated_at":  firestore.ServerTimestamp,
	}, false, true
}

// ReleaseRefreshLease は owner が持つ lease を空ける(手動分析の終了時)。
func ReleaseRefreshLease(ctx context.Context, userKey, owner string) error {
	ref, c, err := autoRefreshRef(userKey)
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
		st, parseErr := snapshotState(doc)
		if parseErr != nil {
			return parseErr
		}
		fields, remove, apply := releaseLeaseOp(st, owner)
		switch {
		case !apply:
			return nil
		case remove:
			return tx.Delete(ref)
		default:
			return tx.Set(ref, fields, firestore.MergeAll)
		}
	})
	if err != nil {
		return fmt.Errorf("release refresh lease: %w", err)
	}
	return nil
}
