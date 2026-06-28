var MATCH_DB_NAME = 'catalyzer';
var MATCH_DB_VERSION = 1;
var MATCH_STORE = 'matches';

export function openMatchDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(MATCH_DB_NAME, MATCH_DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(MATCH_STORE)) {
        var store = db.createObjectStore(MATCH_STORE, { keyPath: 'id' });
        store.createIndex('userKey', 'user_key', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('ms', 'ms', { unique: false });
        store.createIndex('userKey_date', ['user_key', 'date'], { unique: false });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

export function saveMatchesToDB(userKey, matches) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readwrite');
      var store = tx.objectStore(MATCH_STORE);
      for (var i = 0; i < matches.length; i++) {
        var m = Object.assign({}, matches[i], {
          id: userKey + '_' + matches[i].date,
          user_key: userKey
        });
        store.put(m);
      }
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  });
}

export function loadMatchesFromDB(userKey) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readonly');
      var store = tx.objectStore(MATCH_STORE);
      var index = store.index('userKey');
      var req = index.getAll(userKey);
      req.onsuccess = function (e) { resolve(e.target.result || []); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  });
}

export function getLatestMatchDate(userKey) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readonly');
      var store = tx.objectStore(MATCH_STORE);
      var index = store.index('userKey_date');
      var range = IDBKeyRange.bound([userKey, ''], [userKey, '￿']);
      var req = index.openCursor(range, 'prev');
      req.onsuccess = function (e) {
        var cursor = e.target.result;
        resolve(cursor ? cursor.value.date : null);
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  });
}

export function fetchAndCacheMatches(userKey) {
  getLatestMatchDate(userKey).then(function (latestDate) {
    var url = '/matches?user_key=' + encodeURIComponent(userKey);
    if (latestDate) {
      url += '&after=' + encodeURIComponent(latestDate);
    }
    return fetch(url);
  }).then(function (res) {
    if (!res.ok) throw new Error('fetch failed');
    return res.json();
  }).then(function (data) {
    if (data.matches && data.matches.length > 0) {
      return saveMatchesToDB(userKey, data.matches);
    }
  }).catch(function () {});
}
