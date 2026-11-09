# 設計: ログインフォームの国別アクセス制限とレート制限有効化

- ステータス: draft
- 日付: 2026-11-10
- 関連 issue: (なし / セキュリティ診断からの対応)

## 背景

prod のログイン入口 `/analyze`・`/reanalyze` は、受け取った ID/PW をバンダイナムコID の
実ログインAPIにそのまま中継する。prod では `RATE_LIMIT` 未設定でレート制限が無効のため、
単一IPからのブルートフォース／クレデンシャルスタッフィングの踏み台になりうる。GCPログ調査
では悪用の痕跡は無いが、海外からの脆弱性スキャンは日常的に来ている(全件404)。利用者は
実測で全員日本(スキャナは US/NL/DE/AD)。

## 方針

多層防御で入口を絞る。コスト最優先のためエッジ(Cloud Armor)ではなくアプリ層で実装する。

1. **国別アクセス制限(主防御)**: `/analyze`・`/reanalyze` を日本からのみ許可。
2. **レート制限(backstop)**: prod で `RATE_LIMIT=60`(回/時/IP)を有効化。
3. **クライアントIP解決の修正**: 上記2つが依存する実クライアントIPを詐称不能な位置から取る。

## 変更ファイル

- `internal/geoip/geoip.go`(新規): CC0の許可リストCSVをソート済みレンジに読み込み二分探索。依存ゼロ。
- `data/jp_ipv4.csv` / `data/jp_ipv6.csv`(新規): geo-whois-asn-country(CC0)から JP 行のみ抽出(計約400KB)。
- `internal/server/geoblock.go`(新規): `geoGuard`。`GEO_RESTRICT=true` で許可リスト読込。
- `internal/server/ratelimit.go`: `clientIP` を XFF 右から2番目に修正。
- `internal/server/server.go`: `/analyze`・`handleReanalyze` に geo 判定を追加。
- `Dockerfile`: JP CSV を2行 COPY 追加。
- `infra/app/index.ts` + `Pulumi.{stg,prod}.yaml`: `rateLimit=60`・`geoRestrict=true`。

## 主要な設計判断

- **GeoIPデータ源**: MaxMind GeoLite2 は public repo で再配布不可。CC0 の geo-whois-asn-country
  を採用し、JP許可リストに絞って同梱(全世界22MB→JP 400KB)。mmdbライブラリも入れず CSV を自前探索。
- **XFF信頼位置**: Cloud Run は XFF を `…, 実クライアントIP, GoogleFE` の順でappendするため
  右から2番目が実IP。左端はクライアントが詐称可能なので使わない。Googleが実IPを常にappendする
  ので、攻撃者はこの位置を制御できない。
- **フェイルオープン**: 許可リスト読込失敗・IP解釈不能時は締め出さず全許可(正規JPユーザー保護)。
  レート制限が backstop。許可リスト未収録のJPは拒否されうるが、JP割当のカバー率は高く許容。
- **適用範囲**: geo は `/analyze`・`/reanalyze` のみ。全体に掛けると Googlebot(US)が
  robots.txt/sitemap を取れずSEOが死ぬ。スキャナの404ノイズは静的側で無害なので放置。

## テスト計画

- `internal/geoip`: 実データでの JP/海外/IPv4射影/境界(閉区間・隙間)/不正アドレス/読込失敗。
- `internal/server`: `clientIP` の右から2番目・詐称耐性、`geoGuard` の許可/拒否/フェイルオープン、
  `GEO_RESTRICT` の有効無効ゲート。

## 完了条件(決定論的)

1. `go test -race ./internal/...` 全緑(geoip 新規テスト含む)。
2. `golangci-lint run` 0件・`gofmt -l .` 差分ゼロ・`go build ./...` 成功。
3. `clientIP("6.6.6.6, 203.0.113.50, 70.41.3.18")` が `203.0.113.50` を返す(詐称耐性)。
4. `geoGuard.allowed` が JP実IP=許可・海外実IP=拒否。
5. **stg検証(prod昇格の前提)**: stg(`GEO_RESTRICT=true`)へ JP から正常アクセスでき、
   海外偽装XFFで `/analyze` が 403 になることを実測。clientIP の右から2番目仮説が Cloud Run
   実機で正しいことをここで確定する。誤っていれば `clientIP` を修正して再検証してから prod へ。

## エスカレーション事項

- **prodデプロイはユーザーがマージで実行**(外部公開)。
- stg検証(完了条件5)を満たすまで prod(main)へ昇格しない。XFF位置が誤ると全JPユーザーを
  締め出すため、必ず stg で実機確認する。

## 残課題(別issue)

- 許可リストCSVの定期更新(update-mslist 同様の仕組み)。現状は手動同梱。
- インメモリ防御(レート制限・403ブロック)は maxScale=3 でインスタンス跨ぎに弱い。共有ストア化は別規模。
