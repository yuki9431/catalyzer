package session

import (
	"encoding/hex"
	"sync"
	"testing"
)

func resetCrypto() {
	encryptionKey = nil
	keyEnabled = false
	keyOnce = sync.Once{}
}

func TestEncryptDecrypt(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	t.Setenv("SESSION_ENCRYPTION_KEY", hex.EncodeToString(key))
	t.Cleanup(func() {
		resetCrypto()
	})
	resetCrypto()

	plaintext := []byte("hello, session cookies!")

	encrypted, err := Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	if string(encrypted) == string(plaintext) {
		t.Fatal("encrypted data should differ from plaintext")
	}

	decrypted, err := Decrypt(encrypted)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}

	if string(decrypted) != string(plaintext) {
		t.Fatalf("got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptDifferentNonce(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 10)
	}
	t.Setenv("SESSION_ENCRYPTION_KEY", hex.EncodeToString(key))
	t.Cleanup(func() {
		resetCrypto()
	})
	resetCrypto()

	plaintext := []byte("test data")

	enc1, _ := Encrypt(plaintext)
	enc2, _ := Encrypt(plaintext)

	if string(enc1) == string(enc2) {
		t.Fatal("two encryptions of same plaintext should produce different ciphertext (different nonce)")
	}

	dec1, _ := Decrypt(enc1)
	dec2, _ := Decrypt(enc2)
	if string(dec1) != string(dec2) {
		t.Fatal("both should decrypt to same plaintext")
	}
}

func TestDecryptTampered(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("SESSION_ENCRYPTION_KEY", hex.EncodeToString(key))
	t.Cleanup(func() {
		resetCrypto()
	})
	resetCrypto()

	encrypted, _ := Encrypt([]byte("secret"))
	encrypted[len(encrypted)-1] ^= 0xff

	_, err := Decrypt(encrypted)
	if err == nil {
		t.Fatal("Decrypt should fail on tampered ciphertext")
	}
}

func TestNotEnabled(t *testing.T) {
	t.Setenv("SESSION_ENCRYPTION_KEY", "")
	resetCrypto()

	if Enabled() {
		t.Fatal("should not be enabled without env var")
	}
	_, err := Encrypt([]byte("test"))
	if err == nil {
		t.Fatal("Encrypt should fail when not enabled")
	}
}
