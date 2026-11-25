// Thin GitHub Contents API client for the private data repository.
// shortcut: every save is a commit; concurrent writes to the same file resolve
// as last-writer-wins (a retry follows a 409 sha conflict). Upgrade to a queue
// if two people ever edit the same ledger at the same instant.
var Store = (function () {
  var C = typeof LEDGER_CONFIG !== "undefined" ? LEDGER_CONFIG : require("./config.js");
  var BASE = "https://api.github.com/repos/" + C.OWNER + "/" + C.DATA_REPO + "/contents/";

  function headers() {
    return {
      Authorization: "Bearer " + C.TOKEN,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    var bin = atob(b64.replace(/\n/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function getRaw(path) {
    var r = await fetch(BASE + path, { headers: headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("GitHub GET " + r.status + " " + path);
    var j = await r.json();
    return { text: b64ToUtf8(j.content), sha: j.sha };
  }

  async function getJson(path) {
    var raw = await getRaw(path);
    return raw ? JSON.parse(raw.text) : null;
  }

  async function putRaw(path, text, message, sha) {
    var body = { message: message, content: utf8ToB64(text), branch: C.BRANCH };
    if (sha) body.sha = sha;
    var r = await fetch(BASE + path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) {
      // stale sha — refetch once and retry (someone else committed)
      var fresh = await getRaw(path);
      return putRaw(path, text, message, fresh ? fresh.sha : undefined);
    }
    if (!r.ok) throw new Error("GitHub PUT " + r.status + " " + path);
    var j = await r.json();
    return j.content ? j.content.sha : null;
  }

  async function putJson(path, obj, message) {
    return putRaw(path, JSON.stringify(obj, null, 2) + "\n", message);
  }

  async function del(path, message) {
    var fresh = await getRaw(path);
    if (!fresh) return;
    var r = await fetch(BASE + path, {
      method: "DELETE",
      headers: headers(),
      body: JSON.stringify({ message: message, sha: fresh.sha, branch: C.BRANCH })
    });
    if (!r.ok) throw new Error("GitHub DELETE " + r.status + " " + path);
  }

  // One call listing every file in the repo (used by the admin reports view).
  async function tree() {
    var r = await fetch(
      "https://api.github.com/repos/" + C.OWNER + "/" + C.DATA_REPO + "/git/trees/" + C.BRANCH + "?recursive=1",
      { headers: headers() }
    );
    if (!r.ok) throw new Error("GitHub tree " + r.status);
    var j = await r.json();
    return (j.tree || []).filter(function (t) { return t.type === "blob"; });
  }

  return { getRaw: getRaw, getJson: getJson, putRaw: putRaw, putJson: putJson, del: del, tree: tree };
})();
