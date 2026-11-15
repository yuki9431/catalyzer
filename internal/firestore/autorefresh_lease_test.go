package firestore

import (
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

// leaseDoc は auto_refresh/{userKey} を MergeAll の書き込みで模す(nil はドキュメント無し)。
type leaseDoc struct {
	t   *testing.T
	doc *model.AutoRefreshState
}

func (d *leaseDoc) merge(fields map[string]interface{}) {
	d.t.Helper()
	if d.doc == nil {
		d.doc = &model.AutoRefreshState{UserKey: "u"}
	}
	for k, v := range fields {
		switch k {
		case "enabled":
			d.doc.Enabled = v.(bool)
		case "session_token":
			d.doc.SessionToken = v.(string)
		case "passphrase_fp":
			d.doc.PassphraseFP = v.(string)
		case "last_access":
			d.doc.LastAccess = v.(time.Time)
		case "active_until":
			d.doc.ActiveUntil = v.(time.Time)
		case "lease_until":
			d.doc.LeaseUntil = v.(time.Time)
		case "lease_owner":
			d.doc.LeaseOwner = v.(string)
		case "consecutive_failures":
			d.doc.ConsecutiveFailures = v.(int)
		case "updated_at":
		default:
			d.t.Fatalf("未対応のフィールド %q", k)
		}
	}
}

func (d *leaseDoc) acquire(owner string, now time.Time, ttl time.Duration) bool {
	fields, ok := acquireLeaseFields(d.doc, owner, now, ttl)
	if ok {
		d.merge(fields)
	}
	return ok
}

func (d *leaseDoc) release(owner string) {
	if d.doc == nil {
		return
	}
	fields, remove, apply := releaseLeaseOp(*d.doc, owner)
	switch {
	case !apply:
	case remove:
		d.doc = nil
	default:
		d.merge(fields)
	}
}

// jobWouldRefresh は tick の Eligible と Job の lease 取得の両方を通るか(Job がそのユーザーを取得するか)。
func (d *leaseDoc) jobWouldRefresh(now time.Time) bool {
	s := d.doc
	if s == nil || !s.Enabled || s.SessionToken == "" || !s.ActiveUntil.After(now) || !s.LeaseFree("", now) {
		return false
	}
	_, ok := acquireLeaseFields(s, "job:x", now, 5*time.Minute)
	return ok
}

// 手動分析の取得中に有効化しても、直後の tick の Job はそのユーザーを取らない(#481)。
func TestManualLeaseSurvivesEnable(t *testing.T) {
	t0 := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	d := &leaseDoc{t: t}

	// 自動更新を使っていないユーザーの手動分析: ドキュメントが無くても lease を残す
	if !d.acquire("manual:1", t0, 60*time.Minute) {
		t.Fatal("ドキュメントが無ければ取れるはず")
	}
	if d.doc == nil || d.doc.LeaseOwner != "manual:1" {
		t.Fatalf("lease が残っていない: %+v", d.doc)
	}

	// 取得中に有効化
	d.merge(enableFields("tok", "fp", t0.Add(time.Minute), 10*time.Minute))
	if d.doc.LeaseOwner != "manual:1" {
		t.Fatalf("有効化で lease を消してはいけない: %+v", d.doc)
	}

	// 直後の tick: Job はスキップする
	tick := t0.Add(5 * time.Minute)
	if d.jobWouldRefresh(tick) {
		t.Error("手動分析の取得中は Job がそのユーザーを取ってはいけない")
	}

	// 手動分析が終われば lease を空け、ドキュメントは残す(有効化済み)
	d.release("manual:1")
	if d.doc == nil {
		t.Fatal("有効化済みのドキュメントは消さない")
	}
	if !d.jobWouldRefresh(tick) {
		t.Error("手動分析の終了後は Job が取得できるはず")
	}
}

func TestManualLeaseOnlyDocIsRemoved(t *testing.T) {
	t0 := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	d := &leaseDoc{t: t}
	d.acquire("manual:1", t0, time.Hour)

	d.release("manual:other")
	if d.doc == nil {
		t.Fatal("他者の解放で消してはいけない")
	}
	d.release("manual:1")
	if d.doc != nil {
		t.Errorf("lease のためだけに作ったドキュメントは解放で消す: %+v", d.doc)
	}
}

func TestAcquireLeaseFields(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	held := &model.AutoRefreshState{LeaseOwner: "job:a", LeaseUntil: now.Add(time.Minute)}
	if _, ok := acquireLeaseFields(held, "manual:1", now, time.Hour); ok {
		t.Error("他者が保持中は取れない")
	}
	f, ok := acquireLeaseFields(held, "job:a", now, time.Hour)
	if !ok || f["lease_until"] != now.Add(time.Hour) || f["lease_owner"] != "job:a" {
		t.Errorf("自分の lease は延長できる: ok=%v %v", ok, f)
	}
}

func TestReleaseLeaseOpKeepsDisabledDoc(t *testing.T) {
	// 一度有効にして無効にしたユーザーのドキュメントは消さず、lease だけ空ける
	st := model.AutoRefreshState{PassphraseFP: "fp", LeaseOwner: "manual:1"}
	fields, remove, apply := releaseLeaseOp(st, "manual:1")
	if !apply || remove || fields["lease_owner"] != "" {
		t.Errorf("apply=%v remove=%v fields=%v", apply, remove, fields)
	}
}
