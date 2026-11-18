package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/yuki9431/catalyzer/internal/geoip"
)

const (
	delegatedURL = "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest"
	// 海外で使われる JP 登録ブロックを除くための国別判定（geo-whois-asn-country, CC0）
	countryV4URL = "https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv4.csv"
	countryV6URL = "https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv6.csv"
)

func main() {
	v4Path := flag.String("v4", "data/jp_apnic_ipv4.csv", "IPv4 出力先")
	v6Path := flag.String("v6", "data/jp_apnic_ipv6.csv", "IPv6 出力先")
	flag.Parse()
	if err := run(*v4Path, *v6Path); err != nil {
		log.Fatal(err)
	}
}

func run(v4Path, v6Path string) error {
	client := &http.Client{Timeout: 2 * time.Minute}
	var bodies [3][]byte
	for i, url := range []string{delegatedURL, countryV4URL, countryV6URL} {
		b, err := fetch(client, url)
		if err != nil {
			return err
		}
		bodies[i] = b
	}

	// AU は除外しない。JPNIC の細分化されていないブロックを geo-whois が AU(APNIC 本体)と判定するため。
	v4, v6, err := geoip.BuildFromDelegated(bytes.NewReader(bodies[0]), bytes.NewReader(bodies[1]), bytes.NewReader(bodies[2]), "JP", "AU")
	if err != nil {
		return fmt.Errorf("変換失敗: %w", err)
	}
	for path, rows := range map[string][]string{v4Path: v4, v6Path: v6} {
		if werr := os.WriteFile(path, []byte(strings.Join(rows, "\n")+"\n"), 0o644); werr != nil {
			return fmt.Errorf("書き込み失敗: %w", werr)
		}
	}
	// 書き出した結果が許可リストとして読めることまで確認する
	if _, lerr := geoip.Load([]string{v4Path}, []string{v6Path}); lerr != nil {
		return fmt.Errorf("出力の検証失敗: %w", lerr)
	}
	log.Printf("[INFO] JP 割当 v4=%d 件 → %s, v6=%d 件 → %s", len(v4), v4Path, len(v6), v6Path)
	return nil
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
	return io.ReadAll(resp.Body)
}
