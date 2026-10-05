package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/yuki9431/catalyzer/internal/autorefresh"
)

// 標準入力の 1 行を合言葉として argon2id の PHC 文字列を標準出力に出す。
func main() {
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		log.Fatalf("合言葉を標準入力から読めません: %v", err)
	}
	pass := strings.TrimRight(line, "\r\n")
	if pass == "" {
		log.Fatal("合言葉が空です")
	}
	phc, err := autorefresh.HashPassphrase(pass)
	if err != nil {
		log.Fatalf("ハッシュ生成に失敗: %v", err)
	}
	fmt.Println(phc)
}
