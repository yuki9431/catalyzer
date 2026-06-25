package session

import (
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"
)

func TestSerializeDeserializeJar(t *testing.T) {
	jar, _ := cookiejar.New(nil)

	vsURL, _ := url.Parse("https://web.vsmobile.jp/")
	jar.SetCookies(vsURL, []*http.Cookie{
		{Name: "session_id", Value: "abc123"},
		{Name: "token", Value: "xyz789", Path: "/", Domain: "web.vsmobile.jp"},
	})

	bnURL, _ := url.Parse("https://www.bandainamcoid.com/")
	jar.SetCookies(bnURL, []*http.Cookie{
		{Name: "auth", Value: "bnid_token"},
	})

	data, err := SerializeJar(jar)
	if err != nil {
		t.Fatalf("SerializeJar: %v", err)
	}

	restored, err := DeserializeJar(data)
	if err != nil {
		t.Fatalf("DeserializeJar: %v", err)
	}

	vsCookies := restored.Cookies(vsURL)
	if len(vsCookies) < 2 {
		t.Fatalf("expected at least 2 vsmobile cookies, got %d", len(vsCookies))
	}

	found := false
	for _, c := range vsCookies {
		if c.Name == "session_id" && c.Value == "abc123" {
			found = true
		}
	}
	if !found {
		t.Fatal("session_id cookie not found in restored jar")
	}

	bnCookies := restored.Cookies(bnURL)
	if len(bnCookies) == 0 {
		t.Fatal("expected bandainamcoid cookies")
	}
	found = false
	for _, c := range bnCookies {
		if c.Name == "auth" && c.Value == "bnid_token" {
			found = true
		}
	}
	if !found {
		t.Fatal("auth cookie not found in restored jar")
	}
}

func TestSerializeEmptyJar(t *testing.T) {
	jar, _ := cookiejar.New(nil)

	data, err := SerializeJar(jar)
	if err != nil {
		t.Fatalf("SerializeJar: %v", err)
	}

	restored, err := DeserializeJar(data)
	if err != nil {
		t.Fatalf("DeserializeJar: %v", err)
	}

	vsURL, _ := url.Parse("https://web.vsmobile.jp/")
	if len(restored.Cookies(vsURL)) != 0 {
		t.Fatal("expected no cookies in empty jar")
	}
}
