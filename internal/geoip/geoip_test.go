package geoip

import (
	"net/netip"
	"os"
	"path/filepath"
	"testing"
)

// loadTestDB は実際の同梱JP許可リストを読み込む。
func loadTestDB(t *testing.T) *DB {
	t.Helper()
	data := filepath.Join("..", "..", "data")
	db, err := Load(
		[]string{filepath.Join(data, "jp_ipv4.csv"), filepath.Join(data, "jp_apnic_ipv4.csv")},
		[]string{filepath.Join(data, "jp_ipv6.csv"), filepath.Join(data, "jp_apnic_ipv6.csv")},
	)
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
		// geo-whois に無く APNIC の割当で補ったJP(誤拒否の実例)。
		{"APNIC補完のJP(OPTAGE)", "2001:ce8:160:a0dd:7997:74d:dace:4f9d", true},
		{"APNIC補完のJP(KDDI)", "2001:268:c2c2:28a0:f0bd:8717:839b:cf08", true},
		// APNIC では JP 登録だが geo-whois が海外と判定する範囲は許可しない。
		{"JP登録の海外利用(KR)", "158.247.192.1", false},
		{"JP登録の海外利用(KR)2", "141.164.32.1", false},
		{"JP登録の海外利用(v6)", "2401:c080:1c00::1", false},
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
	if _, err := Load([]string{v4}, []string{v4}); err == nil {
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
	if _, err := Load([]string{"nonexistent_v4.csv"}, []string{"nonexistent_v6.csv"}); err == nil {
		t.Error("expected error for missing file")
	}
}

func TestLoad_MultipleFilesUnion(t *testing.T) {
	// 複数ファイルは和集合にし、ファイルをまたぐ重なりも併合する。
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	a4 := write("a4.csv", "10.0.0.0,10.0.0.255,JP\n")
	b4 := write("b4.csv", "10.0.0.128,10.0.1.255,JP\n")
	a6 := write("a6.csv", "2001:db8::,2001:db8::ff,JP\n")
	b6 := write("b6.csv", "2001:db9::,2001:db9::ff,JP\n")
	db, err := Load([]string{a4, b4}, []string{a6, b6})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(db.v4) != 1 || db.v4[0].start != netip.MustParseAddr("10.0.0.0") || db.v4[0].end != netip.MustParseAddr("10.0.1.255") {
		t.Errorf("v4 = %v, want 併合された1件 10.0.0.0-10.0.1.255", db.v4)
	}
	for _, ip := range []string{"2001:db8::1", "2001:db9::1"} {
		if !db.Contains(netip.MustParseAddr(ip)) {
			t.Errorf("Contains(%s) = false, want true", ip)
		}
	}
	if _, err := Load([]string{a4, "missing.csv"}, []string{a6}); err == nil {
		t.Error("1ファイルでも読めなければエラーにする")
	}
}
