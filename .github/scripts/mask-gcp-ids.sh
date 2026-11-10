#!/usr/bin/env bash
# 公開 repo のジョブログに GCP のプロジェクト ID・番号を出さない。secret のマスクは値全体にしか効かないため部分を登録する
set -euo pipefail

fail() { echo "::error::$1"; exit 1; }
[ -n "${SA:-}" ] || fail "WIF_SERVICE_ACCOUNT が未設定"
[ -n "${WIF_PROVIDER:-}" ] || fail "WIF_PROVIDER が未設定"
# 文字列全体で照合する(改行入りの値で一部だけが平文で出るのを防ぐ)
[[ $SA =~ ^[^@[:space:]]+@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$ ]] \
  || fail "サービスアカウントの形式が想定外で、プロジェクト ID を取り出せない"
project=${BASH_REMATCH[1]}
[[ $WIF_PROVIDER =~ ^projects/([0-9]{6,})/[^[:space:]]+$ ]] \
  || fail "WIF provider の形式が想定外で、プロジェクト番号を取り出せない"
number=${BASH_REMATCH[1]}

echo "::add-mask::$project"
echo "::add-mask::$number"
