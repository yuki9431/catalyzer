package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yuki9431/catalyzer/internal/model"
	"github.com/yuki9431/catalyzer/internal/pipeline"
)

func TestHandleResult_ClassRecord(t *testing.T) {
	tests := []struct {
		name string
		rec  *model.ClassRecord // nil なら class_record キーを省略
	}{
		{"取得成功", &model.ClassRecord{Total: model.WinRecord{Label: "クラスマッチG", Matches: 1234, Wins: 700, WinRate: 56.7}}},
		{"取得失敗", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			j := pipeline.NewJob()
			j.Status = model.StatusDone
			j.Report = "[]"
			j.ClassRecord = tt.rec

			rec := httptest.NewRecorder()
			handleResult(rec, httptest.NewRequest(http.MethodGet, "/result/"+j.ID, nil), j.ID)
			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d", rec.Code)
			}

			var body map[string]json.RawMessage
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("failed to decode response body: %v", err)
			}
			raw, ok := body["class_record"]
			if tt.rec == nil {
				if ok {
					t.Errorf("class_record should be omitted, got %s", raw)
				}
				return
			}
			var got model.ClassRecord
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatalf("failed to decode class_record: %v", err)
			}
			if got.Total.Matches != tt.rec.Total.Matches {
				t.Errorf("class_record.total.matches = %d, want %d", got.Total.Matches, tt.rec.Total.Matches)
			}
		})
	}
}
