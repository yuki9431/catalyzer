package server

import (
	"log"
	"net/http"
	"net/netip"
	"os"

	"github.com/yuki9431/catalyzer/internal/geoip"
)

// 許可国IPレンジ（CC0: geo-whois-asn-country。現状は日本のみ同梱）
const (
	defaultGeoIPv4Path = "data/jp_ipv4.csv"
	defaultGeoIPv6Path = "data/jp_ipv6.csv"
)

// geoBlockedMessage は許可国外からのアクセスを拒否したときの応答文。
const geoBlockedMessage = "日本国内からのみ利用できます。"

// geoGuard は許可国以外からのアクセスを拒否する。同梱DBは日本の許可リスト。
type geoGuard struct {
	db *geoip.DB
}

// newGeoGuard は GEO_RESTRICT=true のとき許可リストを読み込む。
// 無効時・読み込み失敗時は nil を返し、呼び出し側は全許可（フェイルオープン）する。
func newGeoGuard(v4Path, v6Path string) *geoGuard {
	if os.Getenv("GEO_RESTRICT") != "true" {
		return nil
	}
	db, err := geoip.Load(v4Path, v6Path)
	if err != nil {
		log.Printf("[WARN] GEO_RESTRICT enabled but allowlist load failed, allowing all: %v", err)
		return nil
	}
	log.Printf("[INFO] Geo restriction enabled (JP allowlist, %d ranges)", db.Size())
	return &geoGuard{db: db}
}

// allowed は接続元が許可国かを返す。guard が nil のときは常に許可。
// 実クライアントIPは XFF 末尾（clientIP 参照）で攻撃者が詐称できない。
// IPを解釈できない異常時は締め出さない。
func (g *geoGuard) allowed(r *http.Request) bool {
	if g == nil {
		return true
	}
	ip := clientIP(r)
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		log.Printf("[WARN] Geo guard: unparseable client IP %q, allowing", ip)
		return true
	}
	return g.db.Contains(addr)
}
