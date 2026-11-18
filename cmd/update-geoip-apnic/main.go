package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/yuki9431/catalyzer/internal/geoip"
)

func main() {
	v4Path := flag.String("v4", "data/jp_apnic_ipv4.csv", "IPv4 出力先")
	v6Path := flag.String("v6", "data/jp_apnic_ipv6.csv", "IPv6 出力先")
	flag.Parse()
	n4, n6, err := geoip.UpdateAPNIC(&http.Client{Timeout: 2 * time.Minute}, geoip.DefaultSources, *v4Path, *v6Path)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("[INFO] JP 割当 v4=%d 件 → %s, v6=%d 件 → %s", n4, *v4Path, n6, *v6Path)
}
