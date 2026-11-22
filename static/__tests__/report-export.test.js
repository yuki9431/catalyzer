import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportMarkdown, EXPORT_PERIODS, exportMsOptions, keepMs, reportFileName } from '../analysis/report-export.js';
import { generateMatches, tagPartners } from '../../tools/ui-check/fixture.js';

var NOW = new Date(2026, 5, 16, 12, 34);
var BASE = generateMatches();

function sectionRows(md, heading) {
  var body = md.split('## ' + heading + '\n')[1].split('\n## ')[0];
  return body.split('\n').filter(function (l) { return l.startsWith('| ') && !l.startsWith('| 敵機 |'); });
}

describe('buildReportMarkdown', function () {
  it('試合が無ければ null', function () {
    assert.equal(buildReportMarkdown([], [], NOW), null);
    assert.equal(buildReportMarkdown(null, [], NOW), null);
  });

  it('対象範囲と主要な見出しを出す', function () {
    var md = buildReportMarkdown(BASE, tagPartners(), NOW);
    assert.match(md, /^# catalyzer 戦績レポート\n/);
    assert.match(md, /- 出力日時: 2026-06-16 12:34/);
    assert.match(md, /全期間・全形式・全機体の 60試合\(2026-06-01 〜 2026-06-15\)/);
    ['このレポートについて', '全体', '対戦形式', '直近の変化', '勝率アップの候補', '自機別', '勝ち試合と負け試合の差', '敵機との相性', '相手の階級', '僚機', 'コスト編成(3試合以上・多い順)', '機体編成(3試合以上・多い順)', '固定相方(名前は伏せている)', '被撃墜', 'ダメージ貢献', '覚醒と OL', '試合時間', '時間帯・曜日・日別']
      .forEach(function (h) { assert.ok(md.includes('\n## ' + h + '\n'), h); });
    assert.match(md, /\| 勝率 \| 45% \|/);
  });

  it('プレイヤー名・チーム名・店舗名を出さない', function () {
    var md = buildReportMarkdown(BASE, tagPartners(), NOW);
    var names = new Set();
    BASE.forEach(function (m) {
      ['name', 'partner_name', 'opponent1_name', 'opponent2_name', 'team_name', 'opponent_team_name', 'arcade'].forEach(function (k) { if (m[k]) names.add(m[k]); });
    });
    tagPartners().forEach(function (t) { names.add(t.team_name); names.add(t.player_name); });
    assert.ok(names.size > 5);
    names.forEach(function (n) { assert.ok(!md.includes(n), n); });
  });

  it('固定相方は記号で置き換える', function () {
    var md = buildReportMarkdown(BASE, tagPartners(), NOW);
    assert.match(md, /\| 固定相方A \| 20 \| 40% \|/);
  });

  it('試合経過の無い古い試合だけでも作れる', function () {
    var legacy = BASE.map(function (m) { return Object.assign({}, m, { actions: [], partner_actions: [], opponent1_actions: [], opponent2_actions: [], mode: undefined, grade: undefined, partner_grade: undefined, opponent1_grade: undefined, opponent2_grade: undefined }); });
    var md = buildReportMarkdown(legacy, [], NOW);
    assert.match(md, /\| 不明 \| 60 \|/);
    assert.match(md, /### 落ち順\n\n\(該当なし\)/);
    assert.match(md, /### 覚醒タイプ\n\n\(該当なし\)/);
  });

  it('表のセルの \\ と | と改行をエスケープする', function () {
    var ms = BASE.map(function (m) { return Object.assign({}, m, { ms: 'A\\|B\nC' }); });
    var md = buildReportMarkdown(ms, [], NOW);
    assert.ok(md.includes('| A\\\\\\|B C | 60 |'));
  });

  it('3000試合・敵機200種でも 32KB 未満で、敵機は30行まで', function () {
    var ms = [];
    for (var i = 0; i < 3000; i++) {
      var d = new Date(Date.UTC(2025, 0, 1) + i * 3 * 3600e3);
      ms.push(Object.assign({}, BASE[i % BASE.length], {
        date: d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16),
        ms: '自機' + (i % 40), partner_ms: '僚機' + (i % 60),
        opponent1_ms: '敵機' + (i % 200), opponent2_ms: '敵機' + ((i * 7) % 200),
      }));
    }
    var md = buildReportMarkdown(ms, [], NOW);
    var bytes = new TextEncoder().encode(md).length;
    assert.ok(bytes < 32 * 1024, 'bytes=' + bytes);
    var enemyRows = sectionRows(md, '敵機との相性').filter(function (l) { return !l.startsWith('| ---'); });
    assert.equal(enemyRows.length, 30);
  });

  it('ファイル名は出力した日付', function () {
    assert.equal(reportFileName(new Date(2026, 0, 5, 23, 59)), 'catalyzer-report-20260105.md');
  });

  it('10試合未満でも作れて、ミッションは判定しない', function () {
    [1, 5, 9].forEach(function (n) {
      var md = buildReportMarkdown(BASE.slice(0, n), [], NOW);
      assert.match(md, /## 勝率アップの候補\n\n\(ミッションの判定は10試合以上で行う\)/);
    });
  });

  it('無いグループの勝率を 0% と出さない', function () {
    var md = buildReportMarkdown(BASE.map(function (m) { return Object.assign({}, m, { win: true }); }), [], NOW);
    assert.match(md, /## 勝ち試合と負け試合の差\n\n\(勝ち試合と負け試合の両方があるときだけ比べる\)/);
    assert.match(md, /\| 全体 \| 60 \| [\d.]+% \| [\d.]+% \| - \|/);
    assert.ok(!/\| そのまま負け \| 0 \|/.test(buildReportMarkdown(BASE, [], NOW)));
  });

  it('期間は試合のあった日で数えて絞る', function () {
    var md = buildReportMarkdown(BASE, [], NOW, { period: '3d' });
    var n = BASE.filter(function (m) { return m.date >= '2026-06-07'; }).length;
    assert.ok(md.includes('- 対象: 直近3日(全機体で試合のあった日を新しい順に3日分)・全形式・全機体の ' + n + '試合(2026-06-07 〜 2026-06-15)'));
  });

  it('機体で絞る', function () {
    var name = BASE[0].ms;
    var n = BASE.filter(function (m) { return m.ms === name; }).length;
    var md = buildReportMarkdown(BASE, [], NOW, { period: 'all', ms: name });
    assert.ok(md.includes('- 対象: 全期間・全形式・自機 ' + name + 'の ' + n + '試合'));
    assert.match(md, new RegExp('\\| 試合数 \\| ' + n + ' \\|'));
  });

  it('期間と機体の両方に合う試合が無ければ null。知らない期間は全期間', function () {
    assert.equal(buildReportMarkdown(BASE, [], NOW, { period: '1d', ms: '存在しない機体' }), null);
    assert.match(buildReportMarkdown(BASE, [], NOW, { period: 'valueOf' }), /全期間・全形式・全機体の 60試合/);
  });

  it('選択肢: 期間はレポート画面と同じ並び、機体は試合数の多い順', function () {
    assert.deepEqual(EXPORT_PERIODS.map(function (o) { return o.value; }), ['all', '90d', '60d', '30d', '14d', '7d', '3d', '1d']);
    assert.equal(EXPORT_PERIODS[3].label, '直近30日');
    var opts = exportMsOptions(BASE);
    assert.equal(opts[0].value, 'アクアスカウト');
    assert.equal(opts[0].label, 'アクアスカウト(13戦)');
    assert.equal(opts.reduce(function (a, o) { return a + Number(o.label.match(/(\d+)戦/)[1]); }, 0), 60);
    var recent = exportMsOptions(BASE, '3d');
    assert.equal(recent.reduce(function (a, o) { return a + Number(o.label.match(/(\d+)戦/)[1]); }, 0), BASE.filter(function (m) { return m.date >= '2026-06-07'; }).length);
  });

  it('期間を往復しても、その期間に無かった機体の選択は戻らない', function () {
    var old = BASE.filter(function (m) { return m.date < '2026-06-15'; }).map(function (m) { return m.ms; });
    var latest = BASE.filter(function (m) { return m.date >= '2026-06-15'; }).map(function (m) { return m.ms; });
    var gone = old.find(function (n) { return latest.indexOf(n) < 0; });
    assert.ok(gone, 'fixture に直近1日で遊んでいない機体がある');
    var sel = keepMs(exportMsOptions(BASE, 'all'), gone);
    assert.equal(sel, gone);
    sel = keepMs(exportMsOptions(BASE, '1d'), sel);
    assert.equal(sel, '');
    assert.equal(keepMs(exportMsOptions(BASE, 'all'), sel), '');
    assert.equal(keepMs(exportMsOptions(BASE, '1d'), latest[0]), latest[0]);
  });
});
