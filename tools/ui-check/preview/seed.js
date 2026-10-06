import { saveMatchesToDB } from '/lib/db.js';
import { generateMatches, classRecord, USER_KEY, SCHEMA_VERSION } from './fixture.js';

await saveMatchesToDB(USER_KEY, generateMatches(), SCHEMA_VERSION);
localStorage.setItem('catalyzer_user_key', USER_KEY);
localStorage.setItem('catalyzer_class_record', JSON.stringify({ user_key: USER_KEY, record: classRecord() }));
// ?session=1 はログイン保持中の端末を再現する（/session のモックは失効を返す）
if (location.search.includes('session=1')) localStorage.setItem('catalyzer_has_session', '1');
location.replace('/');
