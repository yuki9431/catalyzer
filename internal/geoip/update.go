package geoip

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Sources は APNIC 補完リストの取得元。Country* は海外利用の JP 登録ブロックを除くための国別判定。
type Sources struct {
	Delegated, CountryV4, CountryV6 string
}

// DefaultSources は既定の取得元（APNIC と geo-whois-asn-country(CC0) の npm 版。既存の JP リストと同じ出典）。
var DefaultSources = Sources{
	Delegated: "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest",
	CountryV4: "https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv4.csv",
	CountryV6: "https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv6.csv",
}

// UpdateAPNIC は src を取得して JP の補完リストを v4Path / v6Path に書き、件数を返す。
func UpdateAPNIC(client *http.Client, src Sources, v4Path, v6Path string) (n4, n6 int, err error) {
	if filepath.Clean(v4Path) == filepath.Clean(v6Path) {
		return 0, 0, fmt.Errorf("IPv4 と IPv6 の出力先が同じ: %s", v4Path)
	}
	var bodies [3][]byte
	for i, url := range []string{src.Delegated, src.CountryV4, src.CountryV6} {
		b, ferr := fetch(client, url)
		if ferr != nil {
			return 0, 0, ferr
		}
		bodies[i] = b
	}
	// AU は除外しない。JPNIC の細分化されていないブロックを geo-whois が AU(APNIC 本体)と判定するため。
	v4, v6, err := BuildFromDelegated(bytes.NewReader(bodies[0]), bytes.NewReader(bodies[1]), bytes.NewReader(bodies[2]), "JP", "AU")
	if err != nil {
		return 0, 0, fmt.Errorf("変換失敗: %w", err)
	}
	for _, out := range []struct {
		path string
		rows []string
	}{{v4Path, v4}, {v6Path, v6}} {
		if werr := os.WriteFile(out.path, []byte(strings.Join(out.rows, "\n")+"\n"), 0o644); werr != nil {
			return 0, 0, fmt.Errorf("書き込み失敗: %w", werr)
		}
	}
	// 書き出した結果が許可リストとして読めることまで確認する
	if _, lerr := Load([]string{v4Path}, []string{v6Path}); lerr != nil {
		return 0, 0, fmt.Errorf("出力の検証失敗: %w", lerr)
	}
	return len(v4), len(v6), nil
}

func fetch(client *http.Client, url string) ([]byte, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("取得失敗 %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("取得失敗 %s: %s", url, resp.Status)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("読み込み失敗 %s: %w", url, err)
	}
	return b, nil
}
