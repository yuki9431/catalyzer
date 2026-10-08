import { saveMatchesToDB } from '/lib/db.js';
import { generateMatches, classRecord, USER_KEY, SCHEMA_VERSION } from './fixture.js';
import { currentPlayDay } from '/analysis/today.js';

var matches = generateMatches();
// ?today=N は最後の N 試合を今日、その前の10試合を2日前に移し、今日の成績を再現する
var todayN = Number(new URLSearchParams(location.search).get('today'));
if (todayN > 0) {
  var today = currentPlayDay(new Date());
  var d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - 2);
  var prev = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  matches.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  matches.forEach(function (m, i) {
    var day = i >= matches.length - todayN ? today : i >= matches.length - todayN - 10 ? prev : null;
    if (day) m.date = day + ' ' + (m.date.slice(11, 13) < '05' ? '20' : m.date.slice(11, 13)) + m.date.slice(13);
  });
}
// ?focus=N は後ろから N 戦を「挑戦中」の対象にする。与ダメ12500以上のミッションで、fixture では ✗ が3戦
var focusN = Number(new URLSearchParams(location.search).get('focus'));
if (focusN > 0) {
  var sorted = matches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var goal = { key: 'dmg_given', line: 12500 };
  localStorage.setItem('catalyzer_focus', JSON.stringify({ user_key: USER_KEY, by_ms: { '': {
    goal: goal, title: '与ダメ12500以上を取る', condition: '与ダメ12500以上', since: sorted[sorted.length - focusN - 1].date, win_rate_from: 50, win_rate_to: 58,
  } } }));
}
await saveMatchesToDB(USER_KEY, matches, SCHEMA_VERSION);
localStorage.setItem('catalyzer_user_key', USER_KEY);
localStorage.setItem('catalyzer_class_record', JSON.stringify({ user_key: USER_KEY, record: classRecord() }));
// ?session=1 はログイン保持中の端末を再現する（/session のモックは失効を返す）
if (location.search.includes('session=1')) localStorage.setItem('catalyzer_has_session', '1');
// ?session=valid は有効なセッションを持つ端末を再現する（Cookie で /session のモックが valid を返す）
if (location.search.includes('session=valid')) {
  localStorage.setItem('catalyzer_has_session', '1');
  document.cookie = 'preview_session=valid; path=/';
}
// ?seen=N は各タブを試合数 N の時点で見たことにし、更新の点を再現する
var seenN = Number(new URLSearchParams(location.search).get('seen'));
if (seenN > 0) localStorage.setItem('catalyzer_tab_seen', JSON.stringify({ user_key: USER_KEY, seen: { home: seenN, report: seenN, search: seenN, classrecord: 1100 } }));
location.replace('/');
