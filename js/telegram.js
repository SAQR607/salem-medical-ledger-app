// Browser side of the Telegram integration: drops encrypted alert messages into
// data/queue/ in the database repo. After each write it kicks the GitHub
// Actions bot via repository_dispatch so delivery is real-time; the schedule
// trigger is only a fallback. The bot token never reaches the browser.
var Telegram = (function () {
  var queueBusy = false;

  function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  // Ask Actions to drain the queue now. Fire-and-forget: if this fails the
  // schedule trigger still picks the file up later.
  function kickBot() {
    fetch("https://api.github.com/repos/" + LEDGER_CONFIG.OWNER + "/" + LEDGER_CONFIG.APP_REPO + "/dispatches", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + LEDGER_CONFIG.TOKEN,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ event_type: "queue-drain" })
    }).catch(function (e) { console.warn("bot kick failed", e); });
  }

  // Login notices are metadata (who/when) — written plainly so the bot can read
  // them without needing the user's key; they reveal nothing about finances.
  async function enqueuePlain(payload) {
    var path = "data/queue/" + nowStamp() + "-" + Math.random().toString(36).slice(2, 7) + ".json";
    try {
      await Store.putJson(path, payload, "queue: " + payload.kind);
      kickBot();
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
      kickBot();
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

  // Every user action (add/edit/delete, categories, imports, exports, user
  // management…) — encrypted like financial alerts, forwarded by the bot to
  // every admin chat as a real-time activity feed.
  function activity(session, action, detail) {
    return enqueueEncrypted(session, "activity", {
      action: action,
      detail: detail || "",
      at: new Date().toISOString()
    }).catch(function (e) {
      console.warn("activity log failed", e);
    });
  }

  function largeTransaction(session, tx) {
    return enqueueEncrypted(session, "large_tx", tx).catch(function (e) {
      console.warn("large tx alert failed", e);
    });
  }

  return { loginAlert: loginAlert, largeTransaction: largeTransaction, activity: activity, enqueuePlain: enqueuePlain, enqueueEncrypted: enqueueEncrypted };
})();
