package geoip

import (
	"net/netip"
	"reflect"
	"strings"
	"testing"
)

const testDelegated = `# コメント
2|apnic|20261118|89783|19830613|20261117|+1000
apnic|*|ipv4|*|52000|summary
apnic|JP|ipv4|1.0.16.0|4096|20110412|allocated
apnic|JP|ipv4|1.1.64.0|768|20110412|assigned
apnic|CN|ipv4|1.0.1.0|256|20110414|allocated
apnic|JP|asn|2497|1|19930901|allocated
apnic||ipv4|1.2.3.0|256||available
apnic|JP|ipv6|2001:268:8000::|33|20020715|allocated
apnic|JP|ipv6|2001:ce8::|32|20030113|allocated|extra
`

func TestBuildFromDelegated(t *testing.T) {
	// 1.0.20.0/24 は KR(海外利用)で除外、1.1.64.0/24 は AU(ignore)なので残す。
	gw4 := "1.0.16.0,1.0.19.255,JP\n1.0.20.0,1.0.20.255,KR\n1.1.64.0,1.1.64.255,AU\n8.8.8.0,8.8.8.255,US\n"
	gw6 := "2001:268:8000::,2001:268:8000:ffff:ffff:ffff:ffff:ffff,SG\n2001:ce8:b1:8600::,2001:cef:ffff:ffff:ffff:ffff:ffff:ffff,AU\n"
	v4, v6, err := BuildFromDelegated(strings.NewReader(testDelegated), strings.NewReader(gw4), strings.NewReader(gw6), "JP", "AU")
	if err != nil {
		t.Fatalf("BuildFromDelegated: %v", err)
	}
	wantV4 := []string{
		"1.0.16.0,1.0.19.255,JP",
		"1.0.21.0,1.0.31.255,JP",
		"1.1.64.0,1.1.66.255,JP", // 2の冪でない個数
	}
	wantV6 := []string{
		"2001:268:8001::,2001:268:ffff:ffff:ffff:ffff:ffff:ffff,JP",
		"2001:ce8::,2001:ce8:ffff:ffff:ffff:ffff:ffff:ffff,JP",
	}
	if !reflect.DeepEqual(v4, wantV4) {
		t.Errorf("v4 = %v, want %v", v4, wantV4)
	}
	if !reflect.DeepEqual(v6, wantV6) {
		t.Errorf("v6 = %v, want %v", v6, wantV6)
	}
}

func TestBuildFromDelegated_Malformed(t *testing.T) {
	gw4 := "8.8.8.0,8.8.8.255,US\n"
	gw6 := "2001:db8::,2001:db8::ff,US\n"
	ok := "apnic|JP|ipv4|1.0.16.0|256|20110412|allocated\napnic|JP|ipv6|2001:ce8::|32|20030113|allocated\n"
	for _, bad := range []string{
		"apnic|JP|ipv4|1.0.16.0|0|20110412|allocated",        // 0個
		"apnic|JP|ipv4|255.255.255.0|512|20110412|allocated", // 桁あふれ
		"apnic|JP|ipv4|2001:ce8::|256|20110412|allocated",    // ファミリ不一致
		"apnic|JP|ipv6|2001:ce8:1::|32|20030113|allocated",   // ホスト部が0でない
		"apnic|JP|ipv6|2001:ce8::|abc|20030113|allocated",    // 長さ不正
		"apnic|JP|ipv4|1.0.20.0|256|20110412",                // status 欠落
	} {
		if _, _, err := BuildFromDelegated(strings.NewReader(ok+bad), strings.NewReader(gw4), strings.NewReader(gw6), "JP"); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
	if _, _, err := BuildFromDelegated(strings.NewReader(ok), strings.NewReader("8.8.8.0,bad,US\n"), strings.NewReader(gw6), "JP"); err == nil {
		t.Error("expected error for malformed country CSV")
	}
	if _, _, err := BuildFromDelegated(strings.NewReader("apnic|JP|ipv4|1.0.16.0|256|20110412|allocated\n"), strings.NewReader(gw4), strings.NewReader(gw6), "JP"); err == nil {
		t.Error("expected error when a family has no rows")
	}
}

func TestSubtractRanges(t *testing.T) {
	r := func(s, e string) ipRange { return ipRange{start: netip.MustParseAddr(s), end: netip.MustParseAddr(e)} }
	a := []ipRange{r("10.0.0.0", "10.0.0.255"), r("10.0.2.0", "10.0.2.255"), r("10.0.4.0", "10.0.4.255")}
	b := []ipRange{
		r("9.0.0.0", "10.0.0.9"),    // a[0] の先頭を削る
		r("10.0.0.20", "10.0.0.29"), // a[0] の中に穴
		r("10.0.0.250", "10.0.2.9"), // a[0] の末尾と a[1] の先頭をまたぐ
		r("10.0.4.0", "10.0.4.255"), // a[2] を丸ごと消す
	}
	want := []ipRange{
		r("10.0.0.10", "10.0.0.19"),
		r("10.0.0.30", "10.0.0.249"),
		r("10.0.2.10", "10.0.2.255"),
	}
	if got := subtractRanges(a, b); !reflect.DeepEqual(got, want) {
		t.Errorf("subtractRanges = %v, want %v", got, want)
	}
}
