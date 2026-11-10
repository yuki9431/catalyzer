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
5. **stg検証(prod昇格の前提)**: clientIP の「右から2番目」仮説を Cloud Run 実機で確定する。
   合否条件を仮説の真偽と正しく対応させる(逆にしない):
   - (a) stg で一時的に生XFFとentry数をログ出力。**XFF無しのJPリクエストで entry 数が2**で、
     右から2番目が Cloud Run リクエストログの `httpRequest.remoteIp` と一致することを確認する。
   - (b) **JPから偽装XFF(海外IP)付き → `/analyze` は 200**（右から2番目=実JPIPなので許可）。
   - (c) **海外送信元(Cloud Shell等)から偽装XFF(JP IP)付き → `/analyze` は 403**（右から2番目=実海外IP）。
   - 複数行XFFのケースも(b)で確認する。仮説が崩れていれば `clientIP` を直して再検証してから prod へ。
   - 注意: 仮説が誤っていても普通のJPユーザー(XFF無し=entry1個)は `parts[0]` で許可されるため、
     誤りは締め出しとして表に出ず**黙ってバイパスが開く**。だから(c)の 403 を必ず実測する。

## エスカレーション事項

- **prodデプロイはユーザーがマージで実行**(外部公開)。
- stg検証(完了条件5)を満たすまで prod(main)へ昇格しない。XFF位置が誤ると全JPユーザーを
  締め出すため、必ず stg で実機確認する。

## 限界

- geo判定は whois の登録国であり実際の利用場所ではない。東京リージョンの VPS やクラウド
  (AWS/GCP/Vultr の JP)を借りれば回避できる。主防御の限界であり、レート制限・将来の
  アカウント単位制限と併せて多層で使う。

## 残課題(別issue)

- アカウント(メールアドレス)単位の試行制限。IPを回す攻撃への backstop(geo・レート制限とも
  送信元IP依存のため、1アカウントへの総当たりはアカウント単位で止める方が確実)。
- 許可リストCSVの定期更新(update-mslist 同様の仕組み)。更新時に併合と非重複不変条件の検査も通す。
- データセンター/クラウドの ASN 拒否の検討(上記「限界」への対策)。
- インメモリ防御(レート制限・403ブロック)は maxScale=3 でインスタンス跨ぎに弱い。共有ストア化は別規模。
