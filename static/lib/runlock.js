// 分析の多重起動ロック。release で実行中でも切り離せる(ログアウト用)。

export function createRunLock() {
  var token = null;
  return {
    busy: function () { return token !== null; },
    run: async function (fn) {
      if (token !== null) return false;
      var mine = {};
      token = mine;
      try {
        await fn();
      } finally {
        if (token === mine) token = null;
      }
      return true;
    },
    release: function () { token = null; },
  };
}
