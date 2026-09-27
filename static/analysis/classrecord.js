// 公式サイトのクラスマッチ通算戦績（/result の class_record）を表示用に整形する純粋関数

// 通算戦数に対する分析済み試合数の割合(%)。通算が不明なら null
export function classRecordCoverage(total, analyzed) {
  if (!total || total <= 0) return null;
  return Math.min(100, (analyzed || 0) / total * 100);
}

// 回数系スタッツの敵撃破数/被撃破数から通算K/D比を出す。どちらか欠けるか被撃破0なら null
export function classRecordKD(counts) {
  var kills = null, deaths = null;
  (counts || []).forEach(function (c) {
    if (c.label === '敵撃破数') kills = c.value;
    if (c.label === '被撃破数') deaths = c.value;
  });
  if (kills == null || !deaths) return null;
  return kills / deaths;
}
