#!/usr/bin/env bash
# 公開 repo のジョブログに GCP のプロジェクト ID・番号を出さない。secret のマスクは値全体にしか効かないため部分を登録する
set -euo pipefail

case "${SA:-}" in
  ?*@?*.iam.gserviceaccount.com) ;;
  *) echo "::error::サービスアカウントの形式が想定外で、プロジェクト ID を取り出せない"; exit 1 ;;
esac
project=${SA#*@}
project=${project%.iam.gserviceaccount.com}

number=$(sed -nE 's|^projects/([0-9]+)/.*|\1|p' <<<"${WIF_PROVIDER:-}")
if [ -z "$number" ]; then
  echo "::error::WIF provider の形式が想定外で、プロジェクト番号を取り出せない"
  exit 1
fi

echo "::add-mask::$project"
echo "::add-mask::$number"
