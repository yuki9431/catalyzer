FROM golang:1.27.4-alpine3.24@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY internal/ internal/
COPY cmd/ cmd/
RUN go build -o server ./cmd/server && go build -o auto-refresh ./cmd/auto-refresh && go build -o ai-diagnosis ./cmd/ai-diagnosis

FROM alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS base

WORKDIR /app

# AI 診断の Job 用。Anthropic 署名の apk から版を固定して入れる(メインのイメージには入れない)
FROM base AS ai-diagnosis
ARG CLAUDE_CODE_VERSION=2.1.327-r1
RUN wget -O /etc/apk/keys/claude-code.rsa.pub https://downloads.claude.ai/keys/claude-code.rsa.pub \
 && echo "395759c1f7449ef4cdef305a42e820f3c766d6090d142634ebdb049f113168b6  /etc/apk/keys/claude-code.rsa.pub" | sha256sum -c - \
 && echo "https://downloads.claude.ai/claude-code/apk/latest" >> /etc/apk/repositories \
 && apk add --no-cache bash "claude-code=${CLAUDE_CODE_VERSION}"
COPY --from=builder /app/ai-diagnosis .
ENTRYPOINT ["/app/ai-diagnosis"]

# 既定ターゲット(最後のステージ)はメイン
FROM base

COPY --from=builder /app/server .
COPY --from=builder /app/auto-refresh .

# データファイル
COPY data/ms_list.json data/
COPY data/national_ms_stats.json data/
COPY data/grade_list.json data/
COPY data/jp_ipv4.csv data/
COPY data/jp_ipv6.csv data/

# フロントエンド
COPY static/ static/

# Cloud Run はPORT環境変数を設定する
ENV PORT=8080
EXPOSE 8080

CMD ["./server"]
