// Package geoip resolves whether a client IP belongs to an allowed country
// using a bundled public-domain (CC0) country range list.
package geoip

import (
	"bufio"
	"fmt"
	"net/netip"
	"os"
	"sort"
	"strings"
)

// ipRange は [Start, End] の閉区間。読み込み時に併合し非重複・非隣接にする。
type ipRange struct {
	start netip.Addr
	end   netip.Addr
}

// DB は許可国のIPレンジ集合。v4/v6 を分けて保持し開始アドレスで昇順ソートする。
type DB struct {
	v4 []ipRange
	v6 []ipRange
}

// Load は許可国のIPv4/IPv6レンジCSV（start,end,country）を読み込む。
// 不正行が1件でもあれば（許可リストが黙って縮むのを避けるため）エラーにする。
func Load(v4Path, v6Path string) (*DB, error) {
	v4, err := loadRanges(v4Path, false)
	if err != nil {
		return nil, fmt.Errorf("IPv4レンジの読み込み: %w", err)
	}
	v6, err := loadRanges(v6Path, true)
	if err != nil {
		return nil, fmt.Errorf("IPv6レンジの読み込み: %w", err)
	}
	return &DB{v4: v4, v6: v6}, nil
}

// loadRanges は1ファイルを読み、昇順ソートして重なり・隣接を併合する。
// wantV6 は期待するアドレスファミリ。混在・逆転・解釈不能・0件はエラー。
func loadRanges(path string, wantV6 bool) ([]ipRange, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var ranges []ipRange
	var malformed int
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		start, end, ok := parseLine(line)
		if !ok || start.Is4() == wantV6 || end.Is4() == wantV6 || end.Less(start) {
			malformed++
			continue
		}
		ranges = append(ranges, ipRange{start: start, end: end})
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if malformed > 0 {
		return nil, fmt.Errorf("%d 件の不正行", malformed)
	}
	if len(ranges) == 0 {
		return nil, fmt.Errorf("有効なレンジが0件")
	}
	sort.Slice(ranges, func(i, j int) bool {
		return ranges[i].start.Less(ranges[j].start)
	})
	return mergeRanges(ranges), nil
}

// mergeRanges は昇順ソート済みレンジの重なり・隣接を併合し非重複にする。
// 併合しないと入れ子レンジで二分探索が包含を取りこぼす。
func mergeRanges(ranges []ipRange) []ipRange {
	merged := make([]ipRange, 0, len(ranges))
	merged = append(merged, ranges[0])
	for _, r := range ranges[1:] {
		last := len(merged) - 1
		next := merged[last].end.Next()
		if next.IsValid() && r.start.Compare(next) > 0 {
			merged = append(merged, r) // 隙間あり
			continue
		}
		if merged[last].end.Less(r.end) {
			merged[last].end = r.end
		}
	}
	return merged
}

// parseLine は "start,end,country" の先頭2列をアドレスとして解釈する。
func parseLine(line string) (netip.Addr, netip.Addr, bool) {
	first := strings.IndexByte(line, ',')
	if first < 0 {
		return netip.Addr{}, netip.Addr{}, false
	}
	rest := line[first+1:]
	second := strings.IndexByte(rest, ',')
	endStr := rest
	if second >= 0 {
		endStr = rest[:second]
	}
	start, err := netip.ParseAddr(line[:first])
	if err != nil {
		return netip.Addr{}, netip.Addr{}, false
	}
	end, err := netip.ParseAddr(endStr)
	if err != nil {
		return netip.Addr{}, netip.Addr{}, false
	}
	return start, end, true
}

// Contains は addr が許可レンジに含まれるかを返す。
// IPv4射影されたIPv6（::ffff:a.b.c.d）はIPv4として扱う。
func (db *DB) Contains(addr netip.Addr) bool {
	if !addr.IsValid() {
		return false
	}
	addr = addr.Unmap()
	ranges := db.v6
	if addr.Is4() {
		ranges = db.v4
	}
	// start<=addr を満たす最後のレンジを二分探索し、その end で包含を確認する。
	i := sort.Search(len(ranges), func(i int) bool {
		return addr.Less(ranges[i].start)
	})
	if i == 0 {
		return false
	}
	r := ranges[i-1]
	return !addr.Less(r.start) && !r.end.Less(addr)
}

// Size は読み込んだレンジ件数（v4+v6）を返す。起動ログ用。
func (db *DB) Size() int {
	return len(db.v4) + len(db.v6)
}
