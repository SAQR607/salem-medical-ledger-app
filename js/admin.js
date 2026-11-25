// Admin-only: user management over the shared users.json, plus read access to
// every ledger via the system escrow key. Accountants never load this file's
// logic (the tab is hidden and renderAdmin is guarded by role).
(function () {
    "use strict";
    if (!Auth.requireSession()) return;
    var Session = Auth.session();
    if (!Session || Session.role !== "admin") return;

    var systemKey = null; // lazily unwrapped on first need

    // The session already carries ADMIN_DATA_KEY (unwrapped from systemWrapped
    // at login) — that same key is what the bot uses, and what the panel uses
    // to escrow every user's dataKey.
    async function ensureSystemKey() {
        if (systemKey) return systemKey;
        systemKey = Auth.systemKeyBytes(Session);
        if (!systemKey) throw new Error("admin session missing system key");
        return systemKey;
    }

    function renderAdmin() {
        Store.getJson("data/users.json").then(function (users) {
            users = users || [];
            document.getElementById("users-count").textContent = users.length;
            var tbody = document.getElementById("users-table-body");
            tbody.innerHTML = users.map(function (u) {
                var roleBadge = u.role === "admin"
                    ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">مدير</span>'
                    : '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">محاسب</span>';
                var status = u.active === false
                    ? '<span class="text-rose-600 font-bold text-xs">معطّل</span>'
                    : '<span class="text-emerald-600 font-bold text-xs">نشط</span>';
                var created = u.createdAt ? String(u.createdAt).slice(0, 10) : "—";
                var actions =
                    '<button onclick="adminToggle(\'' + u.username + '\')" class="text-xs px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 font-bold ml-1">' +
                    (u.active === false ? "تفعيل" : "تعطيل") + "</button>" +
                    '<button onclick="adminResetPassword(\'' + u.username + '\')" class="text-xs px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 text-amber-800 dark:text-amber-300 font-bold ml-1">كلمة مرور</button>' +
                    (u.username !== Session.username
                        ? '<button onclick="adminDelete(\'' + u.username + '\')" class="text-xs px-2 py-1 rounded-lg bg-rose-100 dark:bg-rose-900/40 hover:bg-rose-200 text-rose-800 dark:text-rose-300 font-bold">حذف</button>'
                        : "");
                return "<tr>" +
                    '<td class="py-3 px-4"><div class="font-bold text-sm">' + (u.displayName || u.username) + '</div><div class="text-xs text-slate-400 font-mono">' + u.username + "</div></td>" +
                    '<td class="py-3 px-4">' + roleBadge + "</td>" +
                    '<td class="py-3 px-4">' + status + "</td>" +
                    '<td class="py-3 px-4 text-xs text-slate-500">' + created + "</td>" +
                    '<td class="py-3 px-4 text-center no-print">' + actions + "</td>" +
                    "</tr>";
            }).join("");
        }).catch(function (e) {
            console.error(e);
            showToast("تعذر تحميل قائمة المستخدمين", "error");
        });
    }
    window.renderAdmin = renderAdmin;

    document.getElementById("add-user-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        var username = document.getElementById("new-username").value.trim();
        var displayName = document.getElementById("new-display-name").value.trim();
        var password = document.getElementById("new-password").value;
        var role = document.getElementById("new-role").value;
        if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
            showToast("اسم المستخدم غير صالح (3-32 حرفاً لاتينياً)", "error");
            return;
        }
        if (password.length < 8) {
            showToast("كلمة المرور 8 أحرف على الأقل", "error");
            return;
        }
        try {
            var users = (await Store.getJson("data/users.json")) || [];
            if (users.some(function (u) { return u.username.toLowerCase() === username.toLowerCase(); })) {
                showToast("اسم المستخدم موجود بالفعل", "error");
                return;
            }

            var salt = Crypto.randomB64(16);
            var kek = await Crypto.deriveKek(password, salt);
            var dataKey = Crypto.randomBytes(32);
            var wrapped = await Crypto.encryptBytes(kek, dataKey);

            var record = {
                username: username,
                displayName: displayName,
                role: role,
                salt: salt,
                wrapped: { iv: wrapped.iv, ct: wrapped.ct },
                active: true,
                createdAt: new Date().toISOString()
            };

            // Escrow: every user's dataKey wrapped under ADMIN_DATA_KEY so the
            // bot can read any ledger for reports/alerts. Only admins also get
            // systemWrapped (ADMIN_DATA_KEY under their dataKey) — accountants
            // never receive the system key.
            var adminKey = await ensureSystemKey();
            var w1 = await Crypto.encryptBytes(adminKey, dataKey);
            record.adminWrapped = { iv: w1.iv, ct: w1.ct };
            if (role === "admin") {
                var w2 = await Crypto.encryptBytes(dataKey, adminKey);
                record.systemWrapped = { iv: w2.iv, ct: w2.ct };
            }

            // Empty encrypted ledger so the accountant starts clean.
            var emptyLedger = await Crypto.encryptJson(dataKey, {
                incomeCategories: ["اشتراكات شهرية", "جلسات فردية", "تقييمات ومقاييس", "استشارات", "إيرادات أخرى"],
                expenseCategories: ["رواتب وأجور", "إيجار ومقر", "كهرباء ومياه وإنترنت", "أدوات ووسائل تعليمية", "صيانة ونظافة", "تسويق وإعلانات", "مصروفات نثرية"],
                transactions: []
            });
            await Store.putJson("data/users/" + username + "/ledger.enc", emptyLedger, "data: create ledger for " + username);

            users.push(record);
            await Store.putJson("data/users.json", users, "users: create " + username);

            document.getElementById("add-user-form").reset();
            renderAdmin();
            Telegram.activity(Session, "إنشاء مستخدم", username + " (" + (role === "admin" ? "مدير" : "محاسب") + ")");
            showToast("تم إنشاء المستخدم " + username + " — كلمة المرور: " + password);
        } catch (err) {
            console.error(err);
            showToast("تعذر إنشاء المستخدم", "error");
        }
    });

    // The ADMIN_DATA_KEY lives in the admin's systemWrapped field (their own
    // dataKey wraps it), so no secret is ever embedded in page source.
    async function getAdminDataKey() {
        return await ensureSystemKey(); // bytes of ADMIN_DATA_KEY
    }

    window.adminToggle = function (username) {
        askConfirm("تغيير حالة المستخدم", "هل تريد تغيير حالة حساب " + username + "؟", async function () {
            try {
                var users = await Store.getJson("data/users.json");
                var u = users.find(function (x) { return x.username === username; });
                if (!u) return;
                u.active = u.active === false;
                await Store.putJson("data/users.json", users, "users: toggle " + username);
                renderAdmin();
                Telegram.activity(Session, "تغيير حالة مستخدم", username + " → " + (u.active ? "نشط" : "معطّل"));
                showToast("تم تحديث الحالة");
            } catch (e) {
                console.error(e);
                showToast("تعذر تحديث الحالة", "error");
            }
        });
    };

    window.adminResetPassword = function (username) {
        askPrompt("كلمة مرور جديدة لـ " + username + " (8+ أحرف)", "", async function (password) {
            if (!password || password.length < 8) {
                showToast("كلمة المرور 8 أحرف على الأقل", "error");
                return;
            }
            try {
                var users = await Store.getJson("data/users.json");
                var u = users.find(function (x) { return x.username === username; });
                if (!u) return;

                var salt = Crypto.randomB64(16);
                var kek = await Crypto.deriveKek(password, salt);
                // Can't unwrap the old dataKey without the old password, so a
                // reset mints a NEW dataKey and re-encrypts the user's files
                // with the admin escrow key (admins only).
                var newDataKey = Crypto.randomBytes(32);
                var wrapped = await Crypto.encryptBytes(kek, newDataKey);

                var ledgerRaw = await Store.getRaw("data/users/" + username + "/ledger.enc");
                if (ledgerRaw) {
                    var sysKey = await ensureSystemKey();
                    try {
                        var plain = await Crypto.decryptJson(sysKey, JSON.parse(ledgerRaw.text));
                        var reenc = await Crypto.encryptJson(newDataKey, plain);
                        await Store.putJson("data/users/" + username + "/ledger.enc", reenc, "data: rekey ledger " + username);
                    } catch (e2) {
                        console.error("rekey ledger failed", e2);
                    }
                    // reports folder rekey
                    var tree = await Store.tree();
                    var reportPaths = tree.map(function (t) { return t.path; }).filter(function (p) {
                        return p.indexOf("data/users/" + username + "/reports/") === 0 && p.slice(-4) === ".enc";
                    });
                    for (var i = 0; i < reportPaths.length; i++) {
                        try {
                            var rr = await Store.getRaw(reportPaths[i]);
                            var rplain = await Crypto.decryptJson(sysKey, JSON.parse(rr.text));
                            var renc = await Crypto.encryptJson(newDataKey, rplain);
                            await Store.putJson(reportPaths[i], renc, "data: rekey " + reportPaths[i]);
                        } catch (e3) { /* skip unreadable */ }
                    }
                }

                u.salt = salt;
                u.wrapped = { iv: wrapped.iv, ct: wrapped.ct };

                // Re-escrow under ADMIN_DATA_KEY for all roles (dataKey changed);
                // only admins additionally hold the system key itself.
                var adminKey = await getAdminDataKey();
                var w1 = await Crypto.encryptBytes(adminKey, newDataKey);
                u.adminWrapped = { iv: w1.iv, ct: w1.ct };
                if (u.role === "admin") {
                    var w2 = await Crypto.encryptBytes(newDataKey, adminKey);
                    u.systemWrapped = { iv: w2.iv, ct: w2.ct };
                }

                await Store.putJson("data/users.json", users, "users: reset password " + username);
                Telegram.activity(Session, "تغيير كلمة مرور", username);
                showToast("تم تغيير كلمة المرور لـ " + username);
            } catch (e) {
                console.error(e);
                showToast("تعذر تغيير كلمة المرور", "error");
            }
        });
    };

    window.adminDelete = function (username) {
        askConfirm("حذف مستخدم", "سيتم حذف حساب " + username + " وجميع بياناته المالية نهائياً. هل أنت متأكد؟", async function () {
            try {
                var users = await Store.getJson("data/users.json");
                users = users.filter(function (x) { return x.username !== username; });
                await Store.putJson("data/users.json", users, "users: delete " + username);

                var tree = await Store.tree();
                var paths = tree.map(function (t) { return t.path; }).filter(function (p) {
                    return p.indexOf("data/users/" + username + "/") === 0;
                });
                for (var i = 0; i < paths.length; i++) {
                    await Store.del(paths[i], "data: delete " + paths[i]);
                }
                renderAdmin();
                Telegram.activity(Session, "حذف مستخدم", username);
                showToast("تم حذف المستخدم وبياناته");
            } catch (e) {
                console.error(e);
                showToast("تعذر حذف المستخدم", "error");
            }
        });
    };
})();
