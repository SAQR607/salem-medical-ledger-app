// Browser side of the Telegram integration: drops encrypted alert messages into
// data/queue/ in the database repo. The GitHub Actions bot picks them up
// (every minute), decrypts them with the admin key it holds as a secret, and
// forwards them to the admin's chat. The bot token never reaches the browser.
var Telegram = (function () {
  var queueBusy = false;

  function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  // Login notices are metadata (who/when) — written plainly so the bot can read
  // them without needing the user's key; they reveal nothing about finances.
  async function enqueuePlain(payload) {
    var path = "data/queue/" + nowStamp() + "-" + Math.random().toString(36).slice(2, 7) + ".json";
    try {
      await Store.putJson(path, payload, "queue: " + payload.kind);
    } catch (e) {
      console.warn("queue write failed", e);
    }
  }

  // Financial alerts are encrypted with the acting user's data key; the bot
  // unwraps that key via the admin escrow before sending. user/kind stay in
  // plaintext so the bot knows whose escrow entry to use before decrypting.
  async function enqueueEncrypted(session, kind, data) {
    var key = Auth.dataKeyBytes(session);
    var blob = await Crypto.encryptBytes(key, new TextEncoder().encode(JSON.stringify(data)));
    var payload = { user: session.username, kind: kind, iv: blob.iv, ct: blob.ct };
    var path = "data/queue/" + nowStamp() + "-" + Math.random().toString(36).slice(2, 7) + ".enc";
    try {
      await Store.putJson(path, payload, "queue: " + kind);
    } catch (e) {
      console.warn("queue write failed", e);
    }
  }

  function loginAlert(username, success) {
    return enqueuePlain({
      kind: success ? "login" : "login_fail",
      user: username,
      at: new Date().toISOString()
    });
  }

  function largeTransaction(session, tx) {
    return enqueueEncrypted(session, "large_tx", tx).catch(function (e) {
      console.warn("large tx alert failed", e);
    });
  }

  return { loginAlert: loginAlert, largeTransaction: largeTransaction, enqueuePlain: enqueuePlain, enqueueEncrypted: enqueueEncrypted };
})();
