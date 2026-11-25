// Login, session and lockout. The password itself is never stored or sent
// anywhere: the GCM auth tag on the user's wrapped key IS the verifier.
var Auth = (function () {
  var SESSION_KEY = "salem_session_v1";
  var LOCK_KEY = "salem_lock_v1";
  var MAX_ATTEMPTS = 5;
  var LOCK_MINUTES = 15;

  function session() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (s && s.username && s.dataKey) return s;
    } catch (e) {}
    return null;
  }

  function requireSession() {
    var s = session();
    if (!s) {
      location.replace("login.html");
      return null;
    }
    return s;
  }

  function saveSession(s) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    location.replace("login.html");
  }

  // --- lockout (client-side; shortcut: bypassable by clearing site data,
  // the encrypted-at-rest design still protects the ledger. Add a server-side
  // counter if this ever moves behind a backend.) ---
  function lockState(username) {
    try {
      var l = JSON.parse(localStorage.getItem(LOCK_KEY)) || {};
      return l[username.toLowerCase()] || { fails: 0, until: 0 };
    } catch (e) {
      return { fails: 0, until: 0 };
    }
  }

  function lockedOut(username) {
    var l = lockState(username);
    return l.until > Date.now() ? l.until : 0;
  }

  function recordFail(username) {
    var all = {};
    try { all = JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; } catch (e) {}
    var k = username.toLowerCase();
    var l = all[k] || { fails: 0, until: 0 };
    l.fails += 1;
    if (l.fails >= MAX_ATTEMPTS) {
      l.until = Date.now() + LOCK_MINUTES * 60000;
      l.fails = 0;
    }
    all[k] = l;
    localStorage.setItem(LOCK_KEY, JSON.stringify(all));
    return l;
  }

  function clearFails(username) {
    try {
      var all = JSON.parse(localStorage.getItem(LOCK_KEY)) || {};
      delete all[username.toLowerCase()];
      localStorage.setItem(LOCK_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  // Returns { ok: true, session } or { ok: false, error, lockedUntil? }
  async function login(username, password) {
    username = (username || "").trim();
    if (!username || !password) return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور" };

    var until = lockedOut(username);
    if (until) {
      var mins = Math.ceil((until - Date.now()) / 60000);
      return { ok: false, error: "تم إيقاف محاولات الدخول مؤقتاً. حاول بعد " + mins + " دقيقة" };
    }

    var users;
    try {
      users = await Store.getJson("data/users.json");
    } catch (e) {
      return { ok: false, error: "تعذر الاتصال بقاعدة البيانات" };
    }
    var user = (users || []).find(function (u) { return u.username.toLowerCase() === username.toLowerCase(); });
    if (!user) {
      var lf = recordFail(username);
      return { ok: false, error: lf.until ? "بيانات الدخول غير صحيحة — تم إيقاف المحاولات 15 دقيقة" : "بيانات الدخول غير صحيحة" };
    }
    if (user.active === false) return { ok: false, error: "هذا الحساب معطّل، راجع الإدارة" };

    var kek, dataKey;
    try {
      kek = await Crypto.deriveKek(password, user.salt);
      dataKey = await Crypto.decryptBytes(kek, user.wrapped); // fails ⇒ wrong password
    } catch (e) {
      var f = recordFail(username);
      return { ok: false, error: f.until ? "بيانات الدخول غير صحيحة — تم إيقاف المحاولات 15 دقيقة" : "بيانات الدخول غير صحيحة" };
    }

    clearFails(username);

    var s = {
      username: user.username,
      displayName: user.displayName || user.username,
      role: user.role || "accountant",
      dataKey: Crypto.bytesToB64(dataKey)
    };

    // Admins also receive the system key (escrow) so they can open any user's data.
    if (user.systemWrapped) {
      try {
        var sys = await Crypto.decryptBytes(dataKey, user.systemWrapped);
        s.systemKey = Crypto.bytesToB64(sys);
      } catch (e) {}
    }

    saveSession(s);
    return { ok: true, session: s };
  }

  function dataKeyBytes(s) {
    return Crypto.b64ToBytes(s.dataKey);
  }

  function systemKeyBytes(s) {
    return s.systemKey ? Crypto.b64ToBytes(s.systemKey) : null;
  }

  return {
    session: session,
    requireSession: requireSession,
    saveSession: saveSession,
    logout: logout,
    login: login,
    lockedOut: lockedOut,
    dataKeyBytes: dataKeyBytes,
    systemKeyBytes: systemKeyBytes
  };
})();
