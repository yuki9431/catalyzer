#!/usr/bin/env bash
# PR コメントには変更の件数とアドレスだけを載せる(公開 repo に識別子を出さない)。詳細はジョブログへ
set -euo pipefail
label=$1 dir=$2
shift 2
out=${PLAN_OUT:-/tmp/tofu-plan.txt}

json=$(mktemp)
trap 'rm -f "$json"' EXIT
status=0
# PR 用の身元は全リソースを読めないので refresh しない。plan ファイルも作らない
tofu -chdir="$dir" plan -json -input=false -lock=false -refresh=false -detailed-exitcode "$@" >"$json" || status=$?
[ "$status" -eq 2 ] && status=0

# 出力は全属性の値を含みうるので、解析できなくても中身は出さない
shape='length > 0 and all(.[]; type == "object" and (.type | type) == "string")
  and all(.[] | select(.type == "planned_change"); (.change.action | type) == "string" and (.change.resource.addr | type) == "string")
  and all(.[] | select(.type == "diagnostic"); (.diagnostic.severity | type) == "string" and (.diagnostic.summary | type) == "string")'
if ! jq -e -s "$shape" "$json" >/dev/null 2>&1; then
  echo "::error::$label: plan の出力を JSON Lines として解析できない($(wc -c <"$json" | tr -d ' ') bytes)"
  printf '### %s\nplan 失敗(出力を解析できない。詳細はジョブログ)\n\n' "$label" >>"$out"
  [ "$status" -ne 0 ] && exit "$status"
  exit 1
fi

echo "--- $label: diagnostics"
jq -r 'select(.type == "diagnostic") | "[\(.diagnostic.severity)] \(.diagnostic.summary)"' "$json"
echo "--- $label: changes"
jq -r 'select(.type == "planned_change") | "\(.change.action)\t\(.change.resource.addr)"' "$json"

{
  echo "### $label"
  if [ "$status" -ne 0 ]; then
    echo "plan 失敗(詳細はジョブログ)"
  else
    jq -r -s '[.[] | select(.type == "planned_change") | .change] as $c
      | if ($c | length) == 0 then "変更なし"
        else
          ($c | group_by(.action) | map("\(.[0].action): \(length)") | join(" / ")),
          ($c[] | "- \(.action) `\(.resource.addr)`")
        end' "$json"
  fi
  echo
} >>"$out"
exit "$status"
