package autorefresh

import (
	"regexp"
	"testing"
)

func TestHashVerifyPassphrase(t *testing.T) {
	phc, err := HashPassphrase("correct-horse")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$`).MatchString(phc) {
		t.Fatalf("PHC 形式でない: %s", phc)
	}
	other, _ := HashPassphrase("correct-horse")
	if phc == other {
		t.Error("salt が毎回変わるはず")
	}

	if ok, err := verifyPassphrase(phc, "correct-horse"); err != nil || !ok {
		t.Errorf("正解が通らない: ok=%v err=%v", ok, err)
	}
	if ok, err := verifyPassphrase(phc, "wrong"); err != nil || ok {
		t.Errorf("誤りが通る: ok=%v err=%v", ok, err)
	}
	for _, bad := range []string{"", "plain", "$argon2i$v=19$m=1,t=1,p=1$AAAA$AAAA", "$argon2id$v=18$m=19456,t=2,p=1$AAAA$AAAA", "$argon2id$v=19$m=x$AAAA$AAAA", "$argon2id$v=19$m=19456,t=2,p=1$!!$AAAA"} {
		if _, err := verifyPassphrase(bad, "x"); err == nil {
			t.Errorf("不正な PHC がエラーにならない: %q", bad)
		}
	}
}

func TestGate(t *testing.T) {
	phc, _ := HashPassphrase("secret")
	phc2, _ := HashPassphrase("secret")

	none := Gate{}
	if none.Available() || none.Required() {
		t.Error("未設定は無効")
	}
	if ok, _ := none.Verify("secret"); ok {
		t.Error("未設定では通さない")
	}

	g := Gate{Hash: phc}
	if !g.Available() || !g.Required() {
		t.Error("ハッシュありは有効で照合が必要")
	}
	if ok, _ := g.Verify("secret"); !ok {
		t.Error("正解が通らない")
	}
	if ok, _ := g.Verify("nope"); ok {
		t.Error("誤りが通る")
	}
	if g.Fingerprint() == "" || g.Fingerprint() == "open" || len(g.Fingerprint()) != 16 {
		t.Errorf("指紋が不正: %q", g.Fingerprint())
	}
	if g.Fingerprint() != (Gate{Hash: phc}).Fingerprint() || g.Fingerprint() == (Gate{Hash: phc2}).Fingerprint() {
		t.Error("指紋は同じハッシュで一致し、別のハッシュで変わる")
	}

	open := Gate{Open: true, Hash: phc}
	if !open.Available() || open.Required() || open.Fingerprint() != "open" {
		t.Error("開放は照合不要で指紋は open")
	}
	if ok, err := open.Verify("anything"); err != nil || !ok {
		t.Error("開放では照合しない")
	}
}
