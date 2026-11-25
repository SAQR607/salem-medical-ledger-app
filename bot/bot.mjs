// Telegram bot + reports runner. Executes in GitHub Actions (app repo) with
// secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ADMIN_DATA_KEY, GH_PAT.
// The bot token never appears in any page source.
//
// Run every 2 minutes: drains the alert queue, polls Telegram updates
// (inline-keyboard control panel), and sends scheduled daily/monthly reports
// at 21:00 Cairo time.
import crypto from "node:crypto";

const subtle = crypto.webcrypto.subtle;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "");
const GH = process.env.GH_PAT;
const OWNER = "SAQR607";
const REPO = "salem-medical-ledger";
const BRANCH = "main";

const b64 = (buf) => Buffer.from(buf).toString("base64");
const un64 = (s) => Buffer.from(s, "base64");
function b64ToBytes(s) {
  return new Uint8Array(un64(s));
}

if (!TOKEN || !CHAT_ID || !GH || !process.env.ADMIN_DATA_KEY) {
  console.error("missing secrets: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / GH_PAT / ADMIN_DATA_KEY");
  process.exit(1);
}
const ADMIN_KEY = b64ToBytes(process.env.ADMIN_DATA_KEY);

// ---------- GitHub data-repo helpers ----------
const ghHeaders = {
  Authorization: `Bearer ${GH}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, { headers: ghHeaders });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${r.status} ${path}`);
  const j = await r.json();
  return { text: Buffer.from(j.content, "base64").toString("utf8"), sha: j.sha };
}

async function ghGetJson(path) {
  const raw = await ghGet(path);
  return raw ? JSON.parse(raw.text) : null;
}

async function ghPut(path, text, message, sha) {
  const body = { message, content: Buffer.from(text, "utf8").toString("base64"), branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders,
    body: JSON.stringify(body),
  });
  if (r.status === 409 || r.status === 422) {
    const fresh = await ghGet(path);
    return ghPut(path, text, message, fresh ? fresh.sha : undefined);
  }
  if (!r.ok) throw new Error(`PUT ${r.status} ${path}`);
}

async function ghPutJson(path, obj, message) {
  await ghPut(path, JSON.stringify(obj, null, 2) + "\n", message);
}

async function ghDelete(path, message) {
  const fresh = await ghGet(path);
  if (!fresh) return;
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "DELETE",
    headers: ghHeaders,
    body: JSON.stringify({ message, sha: fresh.sha, branch: BRANCH }),
  });
  if (!r.ok) throw new Error(`DELETE ${r.status} ${path}`);
}

async function ghTree() {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`, { headers: ghHeaders });
  if (!r.ok) throw new Error(`tree ${r.status}`);
  const j = await r.json();
  return (j.tree || []).filter((t) => t.type === "blob").map((t) => t.path);
}

// ---------- crypto (WebCrypto layout identical to the browser side) ----------
async function aesDecrypt(keyBytes, blob) {
  const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct));
  return new Uint8Array(pt);
}

// user.dataKey = AES-GCM-decrypt(ADMIN_DATA_KEY, user.adminWrapped)
async function dataKeyFor(user) {
  if (!user || !user.adminWrapped) return null;
  return aesDecrypt(ADMIN_KEY, user.adminWrapped);
}

async function decryptLedger(user) {
  const key = await dataKeyFor(user);
  if (!key) return null;
  const raw = await ghGet(`data/users/${user.username}/ledger.enc`);
  if (!raw) return null;
  const pt = await aesDecrypt(key, JSON.parse(raw.text));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---------- Telegram ----------
async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.ok) console.warn(`tg ${method} failed:`, j.description);
  return j;
}

async function send(text, keyboard) {
  // Telegram hard limit is 4096 chars; chunk on line boundaries.
  const chunks = [];
  let cur = "";
  for (const line of String(text).split("\n")) {
    if ((cur + "\n" + line).length > 4000) { chunks.push(cur); cur = line; }
    else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    await tg("sendMessage", {
      chat_id: CHAT_ID,
      text: chunks[i],
      ...(keyboard && i === 0 ? { reply_markup: keyboard } : {}),
    });
  }
}

const MAIN_MENU = {
  inline_keyboard: [
    [{ text: "📊 تقرير اليوم", callback_data: "daily" }],
    [{ text: "📅 تقرير الشهر", callback_data: "monthly" }],
    [{ text: "👥 المستخدمون", callback_data: "users" }],
    [{ text: "🔍 استعلام سريع", callback_data: "query_help" }],
    [{ text: "⚙️ الإعدادات", callback_data: "settings" }],
  ],
};

const SETTINGS_MENU = (cfg) => ({
  inline_keyboard: [
    [{ text: `تنبيهات الدخول: ${cfg.loginAlerts ? "✅ مفعّلة" : "❌ موقوفة"}`, callback_data: "toggle_login" }],
    [
      { text: `الحد الأدنى ${cfg.largeTxThreshold}`, callback_data: "noop" },
    ],
    [
      { text: "1000", callback_data: "th_1000" },
      { text: "5000", callback_data: "th_5000" },
      { text: "10000", callback_data: "th_10000" },
    ],
    [{ text: "↩️ القائمة الرئيسية", callback_data: "back" }],
  ],
});

// ---------- time (Cairo, handles DST automatically) ----------
function cairoNow() {
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date())) parts[type] = value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), ym: `${parts.year}-${parts.month}` };
}

function prevMonth(ym) {
  let [y, m] = ym.split("-").map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ---------- reports ----------
const money = (n) => `${Number(n || 0).toLocaleString("en-US")} ج.م`;

function totalsFor(txs, predicate) {
  let inc = 0, exp = 0, count = 0;
  for (const t of txs) {
    if (!predicate(t)) continue;
    count++;
    if (t.type === "income") inc += t.amount;
    else exp += t.amount;
  }
  return { inc, exp, net: inc - exp, count };
}

async function buildReport(users, predicate, title) {
  const lines = [title, ""];
  for (const u of users) {
    if (u.active === false) continue;
    let ledger;
    try { ledger = await decryptLedger(u); } catch (e) { console.warn(`decrypt ${u.username} failed`, e.message); }
    const t = totalsFor((ledger && ledger.transactions) || [], predicate);
    const name = u.displayName || u.username;
    lines.push(`👤 ${name} (${u.username})`);
    lines.push(`   مدخلات: ${money(t.inc)} | مخرجات: ${money(t.exp)} | صافي: ${money(t.net)} | ${t.count} حركة`);
  }
  return lines.join("\n");
}

async function sendDailyReport(users) {
  const { date } = cairoNow();
  const text = await buildReport(users, (t) => t.date === date, `📊 التقرير اليومي — ${date}`);
  await send(text);
}

async function sendMonthlyReport(users, ym) {
  const text = await buildReport(users, (t) => (t.date || "").startsWith(ym), `📅 التقرير الشهري — ${ym}`);
  await send(text);
}

// ---------- alert queue ----------
async function drainQueue(users, cfg) {
  const paths = await ghTree();
  const queue = paths.filter((p) => p.startsWith("data/queue/") && p !== "data/queue/.gitkeep");
  for (const p of queue) {
    try {
      const raw = await ghGet(p);
      if (!raw) continue;
      const payload = JSON.parse(raw.text);

      if (payload.iv && payload.ct && payload.user) {
        // encrypted financial alert (e.g. large transaction)
        const user = users.find((u) => u.username === payload.user);
        const key = await dataKeyFor(user);
        if (!key) throw new Error(`no escrow key for ${payload.user}`);
        const data = JSON.parse(new TextDecoder().decode(await aesDecrypt(key, payload)));
        if (payload.kind === "large_tx") {
          await send(
            `⚠️ تنبيه حركة كبيرة (≥ ${money(cfg.largeTxThreshold)})\n` +
            `المستخدم: ${user.displayName || user.username}\n` +
            `البيان: ${data.desc || "-"}\n` +
            `البند: ${data.category || "-"} | النوع: ${data.type === "income" ? "مدخل" : "مخرج"}\n` +
            `المبلغ: ${money(data.amount)}\n` +
            `التاريخ: ${data.date || "-"}`
          );
        }
      } else if (payload.kind === "login" || payload.kind === "login_fail") {
        if (!cfg.loginAlerts) { /* still consume the event */ }
        else {
          await send(
            (payload.kind === "login" ? "🔑 تسجيل دخول ناجح" : "⛔ محاولة دخول فاشلة") +
            `\nالمستخدم: ${payload.user}\nالوقت: ${payload.at}`
          );
        }
      }
      // consumed — remove so it is never sent twice
      await ghDelete(p, `queue: processed ${p}`);
    } catch (e) {
      // leave the file for the next run (retry), unless it is unreadable junk
      console.warn(`queue ${p} failed:`, e.message);
      try {
        JSON.parse((await ghGet(p)).text);
      } catch {
        await ghDelete(p, `queue: drop corrupt ${p}`).catch(() => {});
      }
    }
  }
}

// ---------- Telegram updates (button control panel) ----------
async function handleUpdate(update, users, cfg, dirty) {
  const msg = update.message;
  const cb = update.callback_query;

  if (msg && String(msg.chat.id) === CHAT_ID) {
    const text = (msg.text || "").trim();
    if (text === "/start" || text === "/menu") {
      await send("لوحة تحكم نظام السجل المالي 🏥\nاختر أحد الأزرار بالأسفل:", MAIN_MENU);
      return;
    }
    // on-demand query: "2026-11", "11-2026", or "اليوم"
    const m = text.match(/(\d{4})-(\d{1,2})/) || text.match(/(\d{1,2})-(\d{4})/);
    if (m) {
      const ym = m[1].length === 4 ? `${m[1]}-${String(m[2]).padStart(2, "0")}` : `${m[2]}-${String(m[1]).padStart(2, "0")}`;
      await send(await buildReport(users, (t) => (t.date || "").startsWith(ym), `🔍 استعلام — الشهر ${ym}`));
      return;
    }
    if (text.includes("يوم") || text.toLowerCase().includes("daily")) {
      await sendDailyReport(users);
      return;
    }
    await send("لم أفهم الطلب. أرسل:\n• «اليوم» أو daily → تقرير اليوم\n• «2026-11» → تقرير شهر محدد\n• /menu → لوحة الأزرار", MAIN_MENU);
    return;
  }

  if (cb && String(cb.message.chat.id) === CHAT_ID) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const data = cb.data;

    if (data === "daily") { await sendDailyReport(users); return; }
    if (data === "monthly") { await sendMonthlyReport(users, cairoNow().ym); return; }
    if (data === "users") {
      const lines = ["👥 المستخدمون:", ""];
      for (const u of users) {
        lines.push(`• ${u.displayName || u.username} (${u.username}) — ${u.role === "admin" ? "مدير" : "محاسب"} — ${u.active === false ? "معطّل" : "نشط"}`);
      }
      await send(lines.join("\n"), MAIN_MENU);
      return;
    }
    if (data === "query_help") {
      await send("🔍 الاستعلام السريع:\n• أرسل «اليوم» → تقرير اليوم لجميع المستخدمين\n• أرسل «2026-11» → تقرير ذلك الشهر\n• /menu → القائمة الرئيسية", MAIN_MENU);
      return;
    }
    if (data === "settings") { await send("⚙️ الإعدادات:", SETTINGS_MENU(cfg)); return; }
    if (data === "back") { await send("لوحة التحكم:", MAIN_MENU); return; }
    if (data === "toggle_login") {
      cfg.loginAlerts = !cfg.loginAlerts;
      dirty.value = true;
      await send(`تنبيهات الدخول: ${cfg.loginAlerts ? "✅ مفعّلة" : "❌ موقوفة"}`, SETTINGS_MENU(cfg));
      return;
    }
    if (data.startsWith("th_")) {
      cfg.largeTxThreshold = Number(data.slice(3));
      dirty.value = true;
      await send(`تم ضبط حد التنبيه على ${money(cfg.largeTxThreshold)}`, SETTINGS_MENU(cfg));
      return;
    }
    if (data === "noop") return;
  }
}

// ---------- main ----------
async function main() {
  const cfg = (await ghGetJson("data/config.json")) || {};
  const users = (await ghGetJson("data/users.json")) || [];
  const dirty = { value: false };

  await drainQueue(users, cfg);

  // poll Telegram (offset persisted in config.json)
  let offset = cfg.botOffset || 0;
  const res = await tg("getUpdates", { offset: offset + 1, timeout: 0, allowed_updates: ["message", "callback_query"] });
  if (res.ok) {
    for (const update of res.result) {
      try {
        await handleUpdate(update, users, cfg, dirty);
        offset = update.update_id;
      } catch (e) {
        console.warn("update failed:", e.message);
      }
    }
    if (offset !== (cfg.botOffset || 0)) { cfg.botOffset = offset; dirty.value = true; }
  }

  // scheduled reports: 21:00 Cairo, daily; monthly on the 1st
  const now = cairoNow();
  if (now.hour >= 21) {
    if (cfg.dailyReportSent !== now.date) {
      await sendDailyReport(users);
      cfg.dailyReportSent = now.date;
      dirty.value = true;
    }
    const monthlyDue = now.date.endsWith("-01") ? cfg.monthlyReportSent !== prevMonth(now.ym) : false;
    if (monthlyDue) {
      await sendMonthlyReport(users, prevMonth(now.ym));
      cfg.monthlyReportSent = prevMonth(now.ym);
      dirty.value = true;
    }
  }

  if (dirty.value) await ghPutJson("data/config.json", cfg, "bot: update config");
}

main().then(
  () => console.log("bot run OK"),
  (e) => { console.error(e); process.exit(1); }
);
