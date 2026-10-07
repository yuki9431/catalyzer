import { saveMatchesToDB } from '/lib/db.js';
import { generateMatches, classRecord, USER_KEY, SCHEMA_VERSION } from './fixture.js';

var matches = generateMatches();
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
// ?mission=1 は直近7試合を記録済みの挑戦中ミッション（全機体）を再現する
if (location.search.includes('mission=1')) {
  var since = matches.map(function (m) { return m.date; }).sort()[matches.length - 8];
  var focus = { goal: { key: 'dmg_taken', line: 12000 }, title: '被ダメージを12000以下に抑える', condition: '被ダメージが12000以下', since: since };
  localStorage.setItem('catalyzer_focus', JSON.stringify({ user_key: USER_KEY, by_ms: { '': focus } }));
}
location.replace('/');
