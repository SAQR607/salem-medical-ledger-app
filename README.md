# نظام إدارة المدخلات والمخرجات المادية — الويب

نظام سجل مالي شهري متعدد المستخدمين: تسجيل دخول باسم مستخدم وكلمة مرور، عزل كامل لبيانات كل مستخدم، لوحة تحكم تليجرام بزرار.

## المكونات

| ملف | الدور |
|---|---|
| `login.html` | صفحة الدخول (PBKDF2 + AES-256-GCM) |
| `index.html` | التطبيق الرئيسي (نفس الواجهة الأصلية + تبويب إدارة المستخدمين) |
| `js/` | crypto / store (GitHub API) / auth / app / admin / telegram |
| `bot/bot.mjs` | بوت تليجرام + التقارير — يعمل في Actions فقط |
| `.github/workflows/bot.yml` | تشغيل البوت كل دقيقتين |
| `.github/workflows/backup.yml` | نسخة احتياطية يومية لمخزن `salem-medical-ledger-backup` |

قاعدة البيانات هي مخزن **`SAQR607/salem-medical-ledger`** (خاص): كل ملفات الدفاتر مشفّرة per-user، والتوكن العام في `js/config.js` لا يفتح شيئاً مالياً.

## خطوات التشغيل (مرة واحدة)

1. إنشاء المخزن العام `SAQR607/salem-medical-ledger-app` ورفع محتويات هذا المجلد إلى `main`.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Settings → Secrets and variables → **Actions** — إضافة:
   - `TELEGRAM_BOT_TOKEN` = توكن البوت
   - `TELEGRAM_CHAT_ID` = معرّفك في تليجرام
   - `ADMIN_DATA_KEY` = مفتاح التفويض (من تقرير الـ seed)
   - `GH_PAT` = توكن الوصول لقاعدة البيانات
4. إنشاء مخزن خاص فارغ `SAQR607/salem-medical-ledger-backup` (للنسخ الاحتياطي اليومي).
5. إرسال `/start` للبوت `@salem_system_bot` لتفعيل استقبال الرسائل.

## الأمان

- كلمة المرور لا تُخزَّن ولا تُرسل: GCM auth tag هو التحقق نفسه.
- المفتاح الأساسي `ADMIN_DATA_KEY` لا يظهر في أي مصدر صفحة — يُفكّ شفرته من سجل المستخدم بكلمة مرور المدير فقط، ويُحفظ كـ secret في Actions.
- المدير يرى ويدير كل المستخدمين؛ المحاسب يرى بياناته فقط.
- كل عملية حفظ = commit في git، فالسجل التاريخي نفسه نسخة احتياطية.
