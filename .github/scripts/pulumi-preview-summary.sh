#!/usr/bin/env bash
# PR コメントには変更の件数とリソースの型・論理名だけを載せる(公開 repo に識別子を出さない)。詳細はジョブログへ
set -euo pipefail
label=$1 stack=$2 out=${PREVIEW_OUT:-/tmp/pulumi-preview.txt}

if ! pulumi stack select "$stack" 2>/dev/null; then
  echo "### $label: stack not initialized, skipping" >>"$out"
  exit 0
fi

json=$(mktemp)
status=0
pulumi preview --json >"$json" || status=$?

echo "--- $label: diagnostics"
jq -r '(.diagnostics // [])[] | "[\(.severity)] \(.message)"' "$json" 2>/dev/null || cat "$json"
echo "--- $label: changes"
jq -r '.steps[]? | select(.op != "same") | "\(.op)\t\(.urn)\t\((.diffReasons // []) | join(","))"' "$json" 2>/dev/null || true

{
  echo "### $label"
  if [ "$status" -ne 0 ]; then
    echo "preview 失敗(詳細はジョブログ)"
  else
    jq -r '[.steps[]? | select(.op != "same")] as $s
      | if ($s | length) == 0 then "変更なし"
        else
          ($s | group_by(.op) | map("\(.[0].op): \(length)") | join(" / ")),
          ($s[] | (.urn | split("::")) as $u | "- \(.op) `\($u[-2] | split("$") | last)` \($u[-1])")
        end' "$json"
  fi
  echo
} >>"$out"
exit "$status"
