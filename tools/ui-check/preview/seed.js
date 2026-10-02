import { saveMatchesToDB } from '/lib/db.js';
import { generateMatches, classRecord, USER_KEY, SCHEMA_VERSION } from './fixture.js';

await saveMatchesToDB(USER_KEY, generateMatches(), SCHEMA_VERSION);
localStorage.setItem('catalyzer_user_key', USER_KEY);
localStorage.setItem('catalyzer_class_record', JSON.stringify({ user_key: USER_KEY, record: classRecord() }));
location.replace('/');
