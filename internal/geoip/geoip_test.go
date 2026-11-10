package geoip

import (
	"net/netip"
	"path/filepath"
	"testing"
)

// loadTestDB は実際の同梱JP許可リストを読み込む。
func loadTestDB(t *testing.T) *DB {
	t.Helper()
	v4 := filepath.Join("..", "..", "data", "jp_ipv4.csv")
	v6 := filepath.Join("..", "..", "data", "jp_ipv6.csv")
	db, err := Load(v4, v6)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if db.Size() == 0 {
		t.Fatal("expected non-empty DB")
	}
	return db
}

func TestContains_RealData(t *testing.T) {
	db := loadTestDB(t)

	tests := []struct {
		name string
		ip   string
		want bool
	}{
		{"JP実クライアント(ログ由来)", "60.71.146.85", true},
		{"JP実クライアント2", "122.212.36.74", true},
		{"US Google DNS", "8.8.8.8", false},
		{"US スキャナ(GCP)", "35.201.27.3", false},
		{"NL スキャナ", "2.57.122.202", false},
		{"IPv4射影されたJP", "::ffff:60.71.146.85", true},
		{"プライベートIP", "192.168.1.1", false},
		// 入れ子レンジの外側に含まれるJP。併合前は二分探索が取りこぼしていた。
		{"入れ子外側のJP(v4)", "103.62.49.6", true},
		{"入れ子外側のJP(v4)2", "134.159.160.224", true},
		{"入れ子外側のJP(v6)", "2606:f187:c002::", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			addr, err := netip.ParseAddr(tt.ip)
			if err != nil {
				t.Fatalf("ParseAddr(%q): %v", tt.ip, err)
			}
			if got := db.Contains(addr); got != tt.want {
				t.Errorf("Contains(%s) = %v, want %v", tt.ip, got, tt.want)
			}
		})
	}
}

func TestContains_Boundaries(t *testing.T) {
	// 合成DBで境界（開始・終了を含む閉区間、隣接レンジの隙間）を確認する。
	db := &DB{
		v4: []ipRange{
			{start: netip.MustParseAddr("10.0.0.0"), end: netip.MustParseAddr("10.0.0.255")},
			{start: netip.MustParseAddr("10.0.2.0"), end: netip.MustParseAddr("10.0.2.255")},
		},
	}
	tests := []struct {
		ip   string
		want bool
	}{
		{"10.0.0.0", true},       // 開始(含む)
		{"10.0.0.255", true},     // 終了(含む)
		{"10.0.1.0", false},      // レンジ間の隙間
		{"10.0.2.128", true},     // 2つ目のレンジ内
		{"9.255.255.255", false}, // 最初のレンジより前
		{"10.0.3.0", false},      // 最後のレンジより後
	}
	for _, tt := range tests {
		if got := db.Contains(netip.MustParseAddr(tt.ip)); got != tt.want {
			t.Errorf("Contains(%s) = %v, want %v", tt.ip, got, tt.want)
		}
	}
}

func TestContains_NestedRanges(t *testing.T) {
	// 外側レンジの中に内側レンジが入れ子になっても、併合後は外側全体を含む。
	raw := []ipRange{
		{start: netip.MustParseAddr("10.0.0.0"), end: netip.MustParseAddr("10.0.0.255")},
		{start: netip.MustParseAddr("10.0.0.5"), end: netip.MustParseAddr("10.0.0.5")}, // 入れ子
	}
	db := &DB{v4: mergeRanges(raw)} // raw は start 昇順
	for _, ip := range []string{"10.0.0.5", "10.0.0.6", "10.0.0.255"} {
		if !db.Contains(netip.MustParseAddr(ip)) {
			t.Errorf("Contains(%s) = false, want true (入れ子外側)", ip)
		}
	}
}

func TestLoad_MergedRangesDisjoint(t *testing.T) {
	db := loadTestDB(t)
	for _, rs := range [][]ipRange{db.v4, db.v6} {
		for i := 1; i < len(rs); i++ {
			if !rs[i-1].end.Less(rs[i].start) {
				t.Fatalf("併合後に重なり/隣接が残っている (index %d)", i)
			}
		}
	}
}

func TestLoad_FamilyMismatch(t *testing.T) {
	// v4ファイルをv6スロットに渡すとファミリ不一致でエラーになる。
	v4 := filepath.Join("..", "..", "data", "jp_ipv4.csv")
	if _, err := Load(v4, v4); err == nil {
		t.Error("expected error when IPv4 file is loaded as IPv6")
	}
}

func TestContains_InvalidAddr(t *testing.T) {
	db := &DB{}
	if db.Contains(netip.Addr{}) {
		t.Error("invalid addr should not be contained")
	}
}

func TestLoad_MissingFile(t *testing.T) {
	if _, err := Load("nonexistent_v4.csv", "nonexistent_v6.csv"); err == nil {
		t.Error("expected error for missing file")
	}
}
