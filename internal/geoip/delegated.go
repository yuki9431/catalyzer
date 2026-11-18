package geoip

import (
	"bufio"
	"fmt"
	"io"
	"net/netip"
	"sort"
	"strconv"
	"strings"
)

// BuildFromDelegated は RIR の delegated 統計の country 割当から、国別CSVで他国と判定された範囲を除いて
// "start,end,country" 行を作る。cc は登録国で使用地ではないため、海外で使われるブロックを除く必要がある。
// 国別CSV(start,end,cc)で country と ignore 以外の国の範囲を除外対象にする。
func BuildFromDelegated(delegated, countryV4, countryV6 io.Reader, country string, ignore ...string) (v4, v6 []string, err error) {
	d4, d6, err := parseDelegated(delegated, country)
	if err != nil {
		return nil, nil, err
	}
	skip := map[string]bool{country: true}
	for _, c := range ignore {
		skip[c] = true
	}
	f4, err := readForeign(countryV4, false, skip)
	if err != nil {
		return nil, nil, fmt.Errorf("IPv4 国別CSV: %w", err)
	}
	f6, err := readForeign(countryV6, true, skip)
	if err != nil {
		return nil, nil, fmt.Errorf("IPv6 国別CSV: %w", err)
	}
	v4 = formatRanges(subtractRanges(d4, f4), country)
	v6 = formatRanges(subtractRanges(d6, f6), country)
	if len(v4) == 0 || len(v6) == 0 {
		return nil, nil, fmt.Errorf("%s のレンジが0件 (v4=%d, v6=%d)", country, len(v4), len(v6))
	}
	return v4, v6, nil
}

// parseDelegated は delegated の country 割当を併合済みレンジにする。
// 書式: registry|cc|type|start|value|date|status（v4 の value はアドレス数、v6 はプレフィックス長）。
func parseDelegated(r io.Reader, country string) (v4, v6 []ipRange, err error) {
	sc := bufio.NewScanner(r)
	lineNo := 0
	for sc.Scan() {
		lineNo++
		f := strings.Split(strings.TrimSpace(sc.Text()), "|")
		if len(f) < 7 || f[1] != country || (f[2] != "ipv4" && f[2] != "ipv6") {
			continue // コメント・版数行・集計行・他国
		}
		if f[6] != "allocated" && f[6] != "assigned" {
			continue
		}
		start, end, ok := delegatedRange(f[2], f[3], f[4])
		if !ok {
			return nil, nil, fmt.Errorf("%d 行目を解釈できない: %q", lineNo, sc.Text())
		}
		if f[2] == "ipv4" {
			v4 = append(v4, ipRange{start: start, end: end})
		} else {
			v6 = append(v6, ipRange{start: start, end: end})
		}
	}
	if serr := sc.Err(); serr != nil {
		return nil, nil, serr
	}
	if len(v4) == 0 || len(v6) == 0 {
		return nil, nil, fmt.Errorf("%s の割当が0件 (v4=%d, v6=%d)", country, len(v4), len(v6))
	}
	return sortMerge(v4), sortMerge(v6), nil
}

// readForeign は国別CSVから skip 以外の国のレンジを併合済みで返す。不正行はエラー。
func readForeign(r io.Reader, wantV6 bool, skip map[string]bool) ([]ipRange, error) {
	var out []ipRange
	sc := bufio.NewScanner(r)
	lineNo := 0
	for sc.Scan() {
		lineNo++
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		start, end, ok := parseLine(line)
		cc := line[strings.LastIndexByte(line, ',')+1:]
		if !ok || strings.Count(line, ",") != 2 || start.Is4() == wantV6 || end.Is4() == wantV6 || end.Less(start) {
			return nil, fmt.Errorf("%d 行目を解釈できない: %q", lineNo, line)
		}
		if !skip[cc] {
			out = append(out, ipRange{start: start, end: end})
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("除外対象のレンジが0件")
	}
	return sortMerge(out), nil
}

func sortMerge(rs []ipRange) []ipRange {
	sort.Slice(rs, func(i, j int) bool { return rs[i].start.Less(rs[j].start) })
	return mergeRanges(rs)
}

// subtractRanges は併合済みの a から併合済みの b に含まれる部分を取り除く。
func subtractRanges(a, b []ipRange) []ipRange {
	var out []ipRange
	j := 0
	for _, r := range a {
		for j < len(b) && b[j].end.Less(r.start) {
			j++
		}
		cur := r.start
		done := false
		for k := j; k < len(b) && !r.end.Less(b[k].start); k++ {
			if cur.Less(b[k].start) {
				out = append(out, ipRange{start: cur, end: b[k].start.Prev()})
			}
			if !b[k].end.Less(r.end) {
				done = true
				break
			}
			cur = b[k].end.Next()
		}
		if !done {
			out = append(out, ipRange{start: cur, end: r.end})
		}
	}
	return out
}

func formatRanges(rs []ipRange, country string) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.start.String() + "," + r.end.String() + "," + country
	}
	return out
}

// delegatedRange は delegated の1行から閉区間 [start, end] を求める。
func delegatedRange(typ, startStr, value string) (netip.Addr, netip.Addr, bool) {
	start, err := netip.ParseAddr(startStr)
	if err != nil || start.Is4() != (typ == "ipv4") {
		return netip.Addr{}, netip.Addr{}, false
	}
	if typ == "ipv4" {
		count, cerr := strconv.ParseUint(value, 10, 32)
		b := start.As4()
		s := uint64(b[0])<<24 | uint64(b[1])<<16 | uint64(b[2])<<8 | uint64(b[3])
		if cerr != nil || count == 0 || s+count-1 > 0xffffffff {
			return netip.Addr{}, netip.Addr{}, false
		}
		e := uint32(s + count - 1)
		return start, netip.AddrFrom4([4]byte{byte(e >> 24), byte(e >> 16), byte(e >> 8), byte(e)}), true
	}
	bits, err := strconv.Atoi(value)
	if err != nil {
		return netip.Addr{}, netip.Addr{}, false
	}
	p, perr := start.Prefix(bits)
	if perr != nil || p.Addr() != start {
		return netip.Addr{}, netip.Addr{}, false
	}
	b := start.As16()
	for i := bits; i < 128; i++ {
		b[i/8] |= 1 << (7 - i%8)
	}
	return start, netip.AddrFrom16(b), true
}
