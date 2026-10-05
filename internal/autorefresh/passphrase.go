package autorefresh

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/unicode/norm"
)

// OWASP 推奨の argon2id 最小構成(m=19MiB, t=2, p=1)。
const (
	argonMemory  = 19456
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// normalizePassphrase は端末や入力方法による表記の揺れ(全角・半角、結合文字、前後の空白)を揃える
func normalizePassphrase(passphrase string) string {
	return strings.TrimSpace(norm.NFKC.String(passphrase))
}

// HashPassphrase は合言葉を argon2id の PHC 文字列にする。
func HashPassphrase(passphrase string) (string, error) {
	passphrase = normalizePassphrase(passphrase)
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("salt 生成: %w", err)
	}
	key := argon2.IDKey([]byte(passphrase), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// verifyPassphrase は PHC 文字列に対して合言葉を定数時間で照合する。
func verifyPassphrase(phc, passphrase string) (bool, error) {
	passphrase = normalizePassphrase(passphrase)
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, fmt.Errorf("argon2id の PHC 形式ではありません")
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, fmt.Errorf("argon2 のバージョンが不正です")
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false, fmt.Errorf("argon2 のパラメータが不正です: %w", err)
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("salt のデコード: %w", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, fmt.Errorf("hash が不正です")
	}
	got := argon2.IDKey([]byte(passphrase), salt, iterations, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// Gate は自動更新を使える人を絞る合言葉の設定。Open なら照合を飛ばす(全ユーザー開放)。
type Gate struct {
	Hash string
	Open bool
}

// Available は合言葉か開放設定のどちらかがあるか。
func (g Gate) Available() bool { return g.Open || g.Hash != "" }

// Required は有効化に合言葉の照合が要るか。
func (g Gate) Required() bool { return !g.Open && g.Hash != "" }

// Fingerprint は有効化時点の設定を表す短い指紋。変わると既存ユーザーは無効化される。
func (g Gate) Fingerprint() string {
	if g.Open {
		return "open"
	}
	sum := sha256.Sum256([]byte(g.Hash))
	return hex.EncodeToString(sum[:])[:16]
}

// Verify は合言葉を照合する。照合が不要(開放)なら常に true、ハッシュが無ければ false。
func (g Gate) Verify(passphrase string) (bool, error) {
	if g.Open {
		return true, nil
	}
	if g.Hash == "" {
		return false, nil
	}
	return verifyPassphrase(g.Hash, passphrase)
}
