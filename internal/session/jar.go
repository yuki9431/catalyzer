package session

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
)

var cookieURLs = []*url.URL{
	{Scheme: "https", Host: "web.vsmobile.jp"},
	{Scheme: "https", Host: "www.bandainamcoid.com"},
	{Scheme: "https", Host: "account.bandainamcoid.com"},
	{Scheme: "https", Host: "account-api.bandainamcoid.com"},
}

type serializedCookie struct {
	URL     string        `json:"url"`
	Cookies []cookieEntry `json:"cookies"`
}

type cookieEntry struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Path     string `json:"path,omitempty"`
	Domain   string `json:"domain,omitempty"`
	Secure   bool   `json:"secure,omitempty"`
	HTTPOnly bool   `json:"http_only,omitempty"`
}

// SerializeJar はCookieJarの内容をJSONバイト列にシリアライズする。
func SerializeJar(jar http.CookieJar) ([]byte, error) {
	var entries []serializedCookie
	for _, u := range cookieURLs {
		cookies := jar.Cookies(u)
		if len(cookies) == 0 {
			continue
		}
		ce := make([]cookieEntry, len(cookies))
		for i, c := range cookies {
			ce[i] = cookieEntry{
				Name:     c.Name,
				Value:    c.Value,
				Path:     c.Path,
				Domain:   c.Domain,
				Secure:   c.Secure,
				HTTPOnly: c.HttpOnly,
			}
		}
		entries = append(entries, serializedCookie{
			URL:     u.String(),
			Cookies: ce,
		})
	}
	return json.Marshal(entries)
}

// DeserializeJar はJSONバイト列からCookieJarを復元する。
func DeserializeJar(data []byte) (http.CookieJar, error) {
	var entries []serializedCookie
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("unmarshal cookies: %w", err)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, fmt.Errorf("create cookie jar: %w", err)
	}

	for _, entry := range entries {
		u, err := url.Parse(entry.URL)
		if err != nil {
			continue
		}
		cookies := make([]*http.Cookie, len(entry.Cookies))
		for i, c := range entry.Cookies {
			cookies[i] = &http.Cookie{
				Name:     c.Name,
				Value:    c.Value,
				Path:     c.Path,
				Domain:   c.Domain,
				Secure:   c.Secure,
				HttpOnly: c.HTTPOnly,
			}
		}
		jar.SetCookies(u, cookies)
	}

	return jar, nil
}
