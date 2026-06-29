// Package session provides session encryption and cookie jar serialization.
package session

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
)

var (
	encryptionKey []byte
	keyOnce       sync.Once
	keyEnabled    bool
)

func initKey() {
	keyHex := os.Getenv("SESSION_ENCRYPTION_KEY")
	if keyHex == "" {
		return
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		log.Printf("[WARN] SESSION_ENCRYPTION_KEY: invalid hex encoding")
		return
	}
	if len(key) != 32 {
		log.Printf("[WARN] SESSION_ENCRYPTION_KEY: must be 32 bytes (64 hex chars), got %d bytes", len(key))
		return
	}
	encryptionKey = key
	keyEnabled = true
	log.Printf("[INFO] Session encryption enabled")
}

// Enabled はセッション暗号化が有効かどうかを返す。
// SESSION_ENCRYPTION_KEY 環境変数が正しく設定されている場合に true を返す。
func Enabled() bool {
	keyOnce.Do(initKey)
	return keyEnabled
}

// Encrypt はAES-256-GCMで平文を暗号化する。
// 戻り値は nonce + ciphertext の結合バイト列。
func Encrypt(plaintext []byte) ([]byte, error) {
	keyOnce.Do(initKey)
	if !keyEnabled {
		return nil, fmt.Errorf("session encryption not configured")
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}

	return aesGCM.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt はAES-256-GCMで暗号文を復号する。
// ciphertext は nonce + 暗号データ の結合バイト列であること。
func Decrypt(ciphertext []byte) ([]byte, error) {
	keyOnce.Do(initKey)
	if !keyEnabled {
		return nil, fmt.Errorf("session encryption not configured")
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ct := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return aesGCM.Open(nil, nonce, ct, nil)
}
