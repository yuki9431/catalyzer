package firestore

import (
	"testing"
	"time"

	"github.com/yuki9431/catalyzer/internal/model"
)

func TestFinishFields(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	upd := model.RefreshUpdate{LastResult: "session_expired", SessionToken: "T1", ClearSessionToken: true, StopActive: true}

	t.Run("token が同じなら消す", func(t *testing.T) {
		f := finishFields(model.AutoRefreshState{SessionToken: "T1"}, upd, now)
		if v, ok := f["session_token"]; !ok || v != "" {
			t.Errorf("session_token = %v, %v", v, ok)
		}
		if _, ok := f["active_until"]; !ok {
			t.Error("active_until を止めるはず")
		}
	})

	t.Run("token が変わっていたら消さない", func(t *testing.T) {
		f := finishFields(model.AutoRefreshState{SessionToken: "T2"}, upd, now)
		if _, ok := f["session_token"]; ok {
			t.Error("session_token を消してはいけない")
		}
		if _, ok := f["active_until"]; ok {
			t.Error("active_until を止めてはいけない")
		}
		if f["last_result"] != "session_expired" || f["lease_owner"] != "" {
			t.Errorf("lease 解放と last_result は書く: %v", f)
		}
	})
}
