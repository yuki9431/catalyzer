// サーバーの model.UserKey と同じ導出(SHA-256 の先頭8バイトの16進)。DOM・storage を持たない
export async function userKeyOf(username) {
  if (!username || !globalThis.crypto || !crypto.subtle) return '';
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username));
  return Array.from(new Uint8Array(buf).slice(0, 8), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}
