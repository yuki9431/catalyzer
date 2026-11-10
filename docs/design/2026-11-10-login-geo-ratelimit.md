# 設計: ログインフォームの国別アクセス制限とレート制限有効化

- ステータス: implemented
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
- `internal/server/ratelimit.go`: `clientIP` を XFF 末尾（実クライアントIP）に修正。
- `internal/server/server.go`: `/analyze`・`handleReanalyze` に geo 判定を追加。
- `Dockerfile`: JP CSV を2行 COPY 追加。
- `infra/app/index.ts` + `Pulumi.{stg,prod}.yaml`: `rateLimit=60`・`geoRestrict=true`。

## 主要な設計判断

- **GeoIPデータ源**: MaxMind GeoLite2 は public repo で再配布不可。CC0 の geo-whois-asn-country
  を採用し、JP許可リストに絞って同梱(全世界22MB→JP 400KB)。mmdbライブラリも入れず CSV を自前探索。
- **XFF信頼位置**: Cloud Run（domain mapping）は XFF 末尾に実クライアントIPを1つだけ追記する
  （外部LB経由のような末尾 GoogleFE は付かない）。よって末尾が詐称不能の実IP。末尾より前は
  クライアントが足せるので使わない。当初「右から2番目」としていたが stg 実機検証で覆した
  （下記「実機検証の結果」参照）。
- **フェイルオープン**: 許可リスト読込失敗・IP解釈不能時は締め出さず全許可(正規JPユーザー保護)。
  レート制限が backstop。許可リスト未収録のJPは拒否されうるが、JP割当のカバー率は高く許容。
- **適用範囲**: geo は `/analyze`・`/reanalyze` のみ。全体に掛けると Googlebot(US)が
  robots.txt/sitemap を取れずSEOが死ぬ。スキャナの404ノイズは静的側で無害なので放置。

## テスト計画

- `internal/geoip`: 実データでの JP/海外/IPv4射影/境界(閉区間・隙間)/不正アドレス/読込失敗。
- `internal/server`: `clientIP` の末尾採用・詐称耐性、`geoGuard` の許可/拒否/フェイルオープン、
  `GEO_RESTRICT` の有効無効ゲート。

## 完了条件(決定論的)

1. `go test -race ./internal/...` 全緑(geoip 新規テスト含む)。
2. `golangci-lint run` 0件・`gofmt -l .` 差分ゼロ・`go build ./...` 成功。
3. `clientIP("6.6.6.6, 203.0.113.50, 70.41.3.18")` が `203.0.113.50` を返す(詐称耐性)。
4. `geoGuard.allowed` が JP実IP=許可・海外実IP=拒否。
5. **stg検証(prod昇格の前提)**: 実クライアントIPが XFF 末尾かを Cloud Run 実機で確定する。
   - (b) **JPから偽装XFF(海外IP先頭)付き → `/analyze` は非403**（末尾=実JPIPなので許可）。
   - (c) **海外送信元(Cloud Shell)から偽装XFF(JP IP先頭)付き → `/analyze` は 403**（末尾=実海外IP）。
   - geo判定はハンドラ先頭なので空ボディで送れば 403(geo拒否)/400(許可後の本処理)で判別でき
     BNID に到達しない。(c)の 403 が決定打。非403なら末尾採用が誤り。

## 実機検証の結果（2026-11-10）

PR #579 を develop→stg に反映後、stg で実測して当初仮説を覆した。

- **当初「右から2番目」は誤り**。stg(domain mapping)は XFF 末尾に実IPを1つだけ追記し、
  末尾 GoogleFE は付かない。`parts[len-2]` はクライアントが送れる値を読む=geo バイパスの穴だった。
- 実測（JP端末・空ボディ・stg `/analyze`）: `1.1.1.1, 2.2.2.2`→403（コードが `2.2.2.2` を採用）、
  `1.1.1.1, <JP IP>`→400（JP を採用）。Cloud Run リクエストログの `httpRequest.remoteIp` は実JP。
  これで「末尾=実IP、末尾より前=詐称可能」を確定。
- 対応: `clientIP` を末尾の非空エントリ採用に修正（PR #585, develop マージ済み）。prod は本機能未反映のため影響なし。
- 再検証(修正版 stg rev 00196, 全ケース期待通り): J1(XFF無し)=400 / J2(偽装海外先頭)=400 /
  A(偽装2つ)=400（いずれも末尾=実JPを採用、旧版の403から反転）/ C1(海外発・XFF無し)=403 /
  C2(海外発・偽装JP先頭)=403。(c)の C2=403 でバイパス封鎖を確定。海外発は Cloud Build(us-central1)から実施。
  → **main 昇格可**。

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
