#!/usr/bin/env bash
# PR コメントには変更の件数とリソースの型・論理名だけを載せる(公開 repo に識別子を出さない)。詳細はジョブログへ
set -euo pipefail
label=$1 stack=$2 out=${PREVIEW_OUT:-/tmp/pulumi-preview.txt}

if ! pulumi stack select "$stack" 2>/dev/null; then
  echo "### $label: stack not initialized, skipping" >>"$out"
  exit 0
fi

json=$(mktemp)
trap 'rm -f "$json"' EXIT
status=0
# PR 用の身元は全リソースを読めないので refresh しない(Pulumi.yaml の refresh: always を打ち消す)
pulumi preview --json --refresh=false >"$json" || status=$?

# digest は config と全リソースの state を含むので、解析できなくても中身は出さない
shape='type == "object"
  and ((.steps // []) | type == "array" and all(.[]; (.op | type) == "string" and (.urn | type) == "string"))
  and ((.diagnostics // []) | type == "array")'
if ! jq -e "$shape" "$json" >/dev/null 2>&1; then
  echo "::error::$label: preview の出力を JSON として解析できない($(wc -c <"$json" | tr -d ' ') bytes)"
  printf '### %s\npreview 失敗(出力を解析できない。詳細はジョブログ)\n\n' "$label" >>"$out"
  [ "$status" -ne 0 ] && exit "$status"
  exit 1
fi

echo "--- $label: diagnostics"
jq -r '(.diagnostics // [])[] | "[\(.severity)] \(.message)"' "$json" 2>/dev/null || true
echo "--- $label: changes"
jq -r '.steps[]? | select(.op != "same") | "\(.op)\t\(.urn)\t\((.diffReasons // []) | join(","))"' "$json" 2>/dev/null || true

{
  echo "### $label"
  if [ "$status" -ne 0 ]; then
    echo "preview 失敗(詳細はジョブログ)"
  else
    # StackReference は差分が無くても毎回 read で載るので数えない
    jq -r '[.steps[]? | select(.op != "same" and .op != "read")] as $s
      | if ($s | length) == 0 then "変更なし"
        else
          ($s | group_by(.op) | map("\(.[0].op): \(length)") | join(" / ")),
          ($s[] | (.urn | split("::")) as $u
            | "- \(.op) `\($u[2] | split("$") | last)` `\($u[3:] | join("::"))`")
        end' "$json"
  fi
  echo
} >>"$out"
exit "$status"
