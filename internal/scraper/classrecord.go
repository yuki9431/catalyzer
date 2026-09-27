package scraper

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/gocolly/colly/v2"
	"github.com/yuki9431/catalyzer/internal/model"
)

const mobileClassRecordPage = "https://web.vsmobile.jp/exvs2ib/results/classmatch"

// classRecordTotalLabel は通算行のラベル（ページ上は見出しにあり行内にラベルが無い）
const classRecordTotalLabel = "クラスマッチG"

var decimalRe = regexp.MustCompile(`[0-9][0-9,]*(?:\.[0-9]+)?`)

// ScrapeClassRecord はログイン済みjarで戦績ページを取得し、クラスマッチ通算戦績を返す。
func ScrapeClassRecord(jar http.CookieJar) (*model.ClassRecord, error) {
	var body []byte
	var visitErr error
	c := colly.NewCollector(colly.AllowedDomains(vsmobile))
	c.SetCookieJar(jar)
	c.OnResponse(func(r *colly.Response) { body = r.Body })
	c.OnError(func(r *colly.Response, err error) {
		visitErr = fmt.Errorf("戦績ページ取得に失敗 (HTTP %d): %w", r.StatusCode, err)
	})
	if err := c.Visit(mobileClassRecordPage); err != nil && visitErr == nil {
		visitErr = fmt.Errorf("戦績ページ取得に失敗: %w", err)
	}
	if visitErr != nil {
		return nil, visitErr
	}
	return parseClassRecord(body)
}

// parseClassRecord は戦績ページのHTMLから通算・内訳・回数系スタッツを抽出する。
func parseClassRecord(body []byte) (*model.ClassRecord, error) {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("戦績ページのパースに失敗: %w", err)
	}

	content := doc.Find("div.content").First()
	total, ok := parseWinRecord(classRecordTotalLabel, content.Find("div.prompt-area").First().Find("p"))
	if !ok {
		return nil, errors.New("戦績ページに通算戦績が見つからない")
	}
	rec := &model.ClassRecord{Total: total}

	// 内訳は dd 内に p が3つ（戦/勝/％）、回数系は dd 直下に値1つ
	content.Find("dl").Each(func(_ int, dl *goquery.Selection) {
		label := strings.TrimSpace(dl.Find("dt").First().Text())
		dd := dl.Find("dd").First()
		if label == "" || dd.Length() == 0 {
			return
		}
		if ps := dd.Find("p"); ps.Length() > 0 {
			if wr, ok := parseWinRecord(label, ps); ok {
				rec.Breakdown = append(rec.Breakdown, wr)
			}
			return
		}
		v, ok := parseDecimal(dd.Text())
		if !ok {
			return
		}
		rec.Counts = append(rec.Counts, model.CountStat{
			Label: label,
			Value: int(v),
			Unit:  strings.TrimSpace(dd.Find("span").First().Text()),
		})
	})
	return rec, nil
}

// parseWinRecord は「戦・勝・％」の順に並ぶ3要素を WinRecord にする。
func parseWinRecord(label string, ps *goquery.Selection) (model.WinRecord, bool) {
	if ps.Length() != 3 {
		return model.WinRecord{}, false
	}
	var vals [3]float64
	for i := range vals {
		v, ok := parseDecimal(ps.Eq(i).Text())
		if !ok {
			return model.WinRecord{}, false
		}
		vals[i] = v
	}
	return model.WinRecord{Label: label, Matches: int(vals[0]), Wins: int(vals[1]), WinRate: vals[2]}, true
}

// parseDecimal は "56.7％" のような小数を含む先頭の数値を取り出す（parseNumber は整数専用）。
func parseDecimal(s string) (float64, bool) {
	m := decimalRe.FindString(s)
	if m == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", ""), 64)
	return v, err == nil
}
