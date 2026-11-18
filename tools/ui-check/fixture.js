// 固定シードのサンプルデータ(架空名のみ)。乱数は LCG で再現可能
export var USER_KEY = 'a1b2c3d4e5f60718';
export var SCHEMA_VERSION = 1;
export var MATCH_COUNT = 60;

var MS = [
  { name: 'ヴァルキュリア', cost: 3000 }, { name: 'ガルーダ零', cost: 3000 },
  { name: 'ストームレイダー', cost: 2500 }, { name: 'アクアスカウト', cost: 2000 },
  { name: 'ブレイズナイト', cost: 2000 }, { name: 'ミニマルガード', cost: 1500 },
  { name: 'シルフィード', cost: 1500 },
];
var DAYS = ['2026-06-01', '2026-06-02', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07', '2026-06-10', '2026-06-15'];
var BURSTS = ['exbst-f', 'exbst-s', 'exbst-e'];

function rng(seed) {
  var x = seed >>> 0;
  var next = function () { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
  next.int = function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); };
  next.pick = function (arr) { return arr[Math.floor(next() * arr.length)]; };
  return next;
}

function actions(r, deaths, bursts, end) {
  var exStart = r.int(40, 80);
  var list = [{ action: 'ex', action_start_sec: exStart, action_end_sec: exStart + r.int(20, 50) }];
  for (var i = 0; i < deaths; i++) list.push({ action: 'death', action_start_sec: r.int(20, end - 10) + r.int(0, 9) / 10, action_end_sec: 0 });
  for (var j = 0; j < bursts; j++) {
    var s = r.int(15, end - 40);
    list.push({ action: r.pick(BURSTS), action_start_sec: s, action_end_sec: s + r.int(8, 20) });
  }
  return list.sort(function (a, b) { return a.action_start_sec - b.action_start_sec; });
}

// OL は乱数を消費せず試合番号で決める(既存の乱数列を変えない)。k: 0=なし 1=スタンバイのみ 2=発動
function overlimit(list, k, end, fire, standby) {
  if (k === 0) return;
  list.push({ action: 'ov', action_start_sec: standby, action_end_sec: k === 2 ? fire : end });
  if (k === 2) list.push({ action: 'exbst-ov', action_start_sec: fire, action_end_sec: Math.min(fire + 10, end) });
  list.sort(function (a, b) { return a.action_start_sec - b.action_start_sec; });
}

function opponent(r, m, prefix, name, ms) {
  m[prefix + '_ms'] = ms.name;
  m[prefix + '_cost'] = ms.cost;
  m[prefix + '_name'] = name;
  m[prefix + '_score'] = r.int(300, 1100);
  m[prefix + '_kills'] = r.int(0, 4);
  m[prefix + '_deaths'] = r.int(0, 3);
  m[prefix + '_dmg_given'] = r.int(500, 1800) * 10;
  m[prefix + '_dmg_taken'] = r.int(500, 1800) * 10;
  m[prefix + '_ex_dmg'] = r.int(0, 600);
  m[prefix + '_proficiency'] = r.pick(['gold1', 'silver3', 'master']);
  m[prefix + '_score_ranking'] = r.int(1, 4);
}

// 階級(通し番号。∞=41)は乱数を消費せず試合番号で決める。形式不明と11試合に1つは階級なし
var OPP_GRADES = [[41, 41], [41, 39], [39, 38], [37, 35], [34, 31], [28, 24], [41, 41], [15, 12], [8, 5]];
var PARTNER_GRADES = [41, 41, 39, 36, 33, 25];
function grades(m, i) {
  if (!m.mode || i % 11 === 10) return;
  var o = OPP_GRADES[Math.floor(i / 2) % OPP_GRADES.length];
  m.grade = 41;
  m.partner_grade = PARTNER_GRADES[i % PARTNER_GRADES.length];
  m.opponent1_grade = o[0];
  m.opponent2_grade = o[1];
}

// 新しい2日分だけ公式の連勝数を持たせる。それより前は取得前の試合として画面側の推定に任せる
function officialStreaks(matches) {
  var from = DAYS[DAYS.length - 2];
  var prev = 0;
  matches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (m) {
    if (m.date < from) return;
    prev = m.win ? (prev > 0 && prev < 10 ? prev + 1 : 1) : 0;
    if (m.win) m.win_streak = prev;
  });
}

export function generateMatches() {
  var r = rng(20260601);
  var matches = [];
  for (var i = 0; i < MATCH_COUNT; i++) {
    var day = DAYS[Math.floor(i / 7.5)];
    var mine = r.pick(MS), partner = r.pick(MS), e1 = r.pick(MS), e2 = r.pick(MS);
    var win = r() < 0.55;
    var end = r.int(150, 240);
    var deaths = r.int(0, 3), pDeaths = r.int(0, 3), bursts = r.int(0, 3), pBursts = r.int(0, 3);
    var hour = r.pick([14, 15, 20, 21, 22, 23]);
    var m = {
      date: day + ' ' + String(hour).padStart(2, '0') + ':' + String(r.int(0, 59)).padStart(2, '0'),
      name: 'テストパイロット',
      team_name: i % 3 === 0 ? 'テストチーム' : '',
      opponent_team_name: '',
      ms: mine.name, ms_cost: mine.cost,
      partner_ms: partner.name, partner_cost: partner.cost,
      win: win, score: r.int(300, 1200), kills: r.int(0, 5), deaths: deaths,
      dmg_given: r.int(500, 2000) * 10, dmg_taken: r.int(500, 1800) * 10, ex_dmg: r.int(0, 700),
      partner_name: i % 3 === 0 ? 'テスト僚機1' : 'テスト僚機' + r.int(2, 4),
      partner_score: r.int(300, 1200), partner_kills: r.int(0, 5), partner_deaths: pDeaths,
      partner_dmg_given: r.int(500, 2000) * 10, partner_dmg_taken: r.int(500, 1800) * 10, partner_ex_dmg: r.int(0, 700),
      bursts: bursts, partner_bursts: pBursts,
      // 乱数を消費せず試合番号で決める(検索の熟練度の並び順を画面で確かめる)
      proficiency: ['gold2', 'master', 'silver3', 'bronze1', 'legend'][i % 5], partner_proficiency: 'silver1',
      score_ranking: r.int(1, 4), partner_score_ranking: r.int(1, 4),
      arcade: 'テスト店舗',
      // 乱数を消費せず試合番号で決める。7試合に1つは形式不明(取得前のデータ)
      mode: i % 7 === 6 ? undefined : i % 3 === 0 ? 'fixed' : 'shuffle',
      game_end_sec: end,
      match_id: ('0000000' + Math.floor(r() * 4294967296).toString(16)).slice(-8) + ('0000000' + i.toString(16)).slice(-8),
    };
    opponent(r, m, 'opponent1', 'テスト対戦者' + r.int(1, 9), e1);
    opponent(r, m, 'opponent2', 'テスト対戦者' + r.int(10, 19), e2);
    m.opponent1_bursts = r.int(0, 3);
    m.opponent2_bursts = r.int(0, 3);
    m.actions = actions(r, deaths, bursts, end);
    overlimit(m.actions, i % 3, end, end - 20, end - 45);
    m.partner_actions = actions(r, pDeaths, pBursts, end);
    m.opponent1_actions = actions(r, m.opponent1_deaths, m.opponent1_bursts, end);
    m.opponent2_actions = actions(r, m.opponent2_deaths, m.opponent2_bursts, end);
    var oppFire = end - 10 - Math.floor(i / 9) % 2 * 20;
    overlimit(m.opponent1_actions, Math.floor(i / 3) % 3, end, oppFire, oppFire - 25);
    grades(m, i);
    matches.push(m);
  }
  officialStreaks(matches);
  return matches;
}

export function msList() {
  return MS.map(function (m, i) { return { Name: m.name, ImageURL: '/__preview/ms/' + i + '.svg', Cost: m.cost }; });
}

export function nationalStats() {
  return MS.map(function (m, i) { return { name: m.name, cost: m.cost, win_rate: 46 + i * 1.3, usage_rate: 1.5 + i * 0.9 }; });
}

export function tagPartners() {
  return [{ team_name: 'テストチーム', player_name: 'テスト僚機1' }];
}

export function classRecord() {
  return {
    total: { label: '通算', matches: 1200, wins: 640, win_rate: 53.3 },
    breakdown: [
      { label: 'チーム', matches: 700, wins: 380, win_rate: 54.3 },
      { label: 'ソロ', matches: 500, wins: 260, win_rate: 52 },
    ],
    counts: [
      { label: '敵撃破数', value: 2400, unit: '機' },
      { label: '被撃破数', value: 1900, unit: '機' },
      { label: '最大連勝数', value: 9, unit: '連勝' },
    ],
  };
}

// 架空のメモ6件(先頭 pins 件がピン留め。既定1件)。敵機は先頭の試合の相手(ストームレイダー・ヴァルキュリア)と、相性タブの苦手な敵機(ガルーダ零)。僚機は1件だけで、先頭の試合の僚機(ガルーダ零)。日時は固定
export function notes(pins) {
  var n = pins === undefined ? 1 : pins;
  return [
    { id: 'preview-note-1', text: '着地を見てから射撃を合わせる。', enemies: ['ストームレイダー'], my_ms: '', partner_ms: '', date: '', pinned: 0 < n, created_at: '2026-06-14T12:00:00Z', updated_at: '2026-06-15T12:00:00Z' },
    { id: 'preview-note-2', text: '覚醒を吐かせてから前に出る。\n先落ちは避ける。', enemies: ['ストームレイダー'], my_ms: 'ストームレイダー', partner_ms: '', date: '', pinned: 1 < n, created_at: '2026-06-13T12:00:00Z', updated_at: '2026-06-14T12:00:00Z' },
    { id: 'preview-note-3', text: '格闘の間合いに入らない。', enemies: ['ヴァルキュリア', 'ガルーダ零'], my_ms: '', partner_ms: '', date: '2026-06-15', pinned: 2 < n, created_at: '2026-06-12T12:00:00Z', updated_at: '2026-06-13T12:00:00Z' },
    { id: 'preview-note-4', text: '夜は連敗しやすい。早めに切り上げる。', enemies: [], my_ms: '', partner_ms: '', date: '2026-06-15', pinned: 3 < n, created_at: '2026-06-11T12:00:00Z', updated_at: '2026-06-12T12:00:00Z' },
    { id: 'preview-note-5', text: '開幕は前に出すぎない。', enemies: [], my_ms: '', partner_ms: 'ガルーダ零', date: '', pinned: 4 < n, created_at: '2026-06-10T12:00:00Z', updated_at: '2026-06-11T12:00:00Z' },
    { id: 'preview-note-6', text: '距離を詰められたら無理に追わない。', enemies: ['ガルーダ零'], my_ms: '', partner_ms: '', date: '', pinned: 5 < n, created_at: '2026-06-09T12:00:00Z', updated_at: '2026-06-10T12:00:00Z' },
  ];
}

// AI診断の応答のサンプル。status ごとの本文。done の next_at は固定(日時に依存させない)
export function aiDiagnosis(status) {
  var base = { available: true, min_matches: 10 };
  if (status === 'done') {
    return Object.assign(base, {
      status: 'done',
      result: {
        headline: 'おにーさん、勝率は5割ちょっと。伸びしろはまだまだあるじゃん',
        tendencies: ['被ダメが多い試合ほど勝率が落ちる、守りに課題ありのタイプ', '先落ちした試合は勝率が低め。相方との順番を意識したいところ', '直近は少し調子を崩していて、与ダメも伸び悩み気味'],
        cautions: ['被ダメを抑えて、無理な着地を取らないようにする', '先落ちしそうなら覚醒を早めに使う', '苦手な敵機には距離を保って立ち回る'],
        strengths: ['ストームレイダーでの勝率は安定してるじゃん', '最後に遊んだ日は前の日より勝率が上がってるわね'],
      },
      next_at: '2026-10-09T05:00:00+09:00',
    });
  }
  if (status === 'error') return Object.assign(base, { status: 'error', retry: true, attempts_left: 2, error: 'AIの応答を受け取れませんでした' });
  return Object.assign(base, { status: status });
}

export function msSvg(n) {
  var hue = (n * 47) % 360;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(' + hue + ',50%,40%)"/></svg>';
}
