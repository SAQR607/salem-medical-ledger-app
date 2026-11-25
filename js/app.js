// Main application. Identical behaviour to the original single-file version,
// except persistence moved from localStorage to the encrypted GitHub database:
// load/save are async, and every user reads/writes only their own file.
(function () {
    "use strict";

    var Session = Auth.requireSession();
    if (!Session) return; // redirecting to login.html

    var State = {
        data: null,
        selectedMonth: new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0"),
        activeTab: "overview",
        chartMode: "expense",
        charts: {},
        saving: 0
    };

    var DEFAULT_STATE = {
        incomeCategories: ["اشتراكات شهرية", "جلسات فردية", "تقييمات ومقاييس", "استشارات", "إيرادات أخرى"],
        expenseCategories: ["رواتب وأجور", "إيجار ومقر", "كهرباء ومياه وإنترنت", "أدوات ووسائل تعليمية", "صيانة ونظافة", "تسويق وإعلانات", "مصروفات نثرية"],
        transactions: []
    };

    var ARABIC_MONTHS = {
        '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل',
        '05': 'مايو', '06': 'يونيو', '07': 'يوليو', '08': 'أغسطس',
        '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
    };

    function ledgerPath(username) {
        return "data/users/" + (username || Session.username) + "/ledger.enc";
    }

    function formatMonthLabel(ym) {
        if (!ym || !ym.includes('-')) return ym;
        var p = ym.split('-');
        return `${ARABIC_MONTHS[p[1]] || p[1]} ${p[0]}`;
    }

    function formatMoney(val) {
        return `${Number(val || 0).toLocaleString('en-US')} ج.م`;
    }

    // ---------- persistence ----------
    async function loadState() {
        try {
            var blob = await Store.getRaw(ledgerPath());
            if (blob) {
                State.data = await Crypto.decryptJson(Auth.dataKeyBytes(Session), JSON.parse(blob.text));
            } else {
                State.data = JSON.parse(JSON.stringify(DEFAULT_STATE));
                await saveState();
            }
        } catch (e) {
            console.error(e);
            State.data = JSON.parse(JSON.stringify(DEFAULT_STATE));
            showToast("تعذر تحميل البيانات — تحقق من الاتصال وأعد المحاولة", "error");
        }
        if (!Array.isArray(State.data.transactions)) State.data.transactions = [];
        if (!Array.isArray(State.data.incomeCategories)) State.data.incomeCategories = DEFAULT_STATE.incomeCategories.slice();
        if (!Array.isArray(State.data.expenseCategories)) State.data.expenseCategories = DEFAULT_STATE.expenseCategories.slice();
    }

    async function saveState() {
        var n = ++State.saving;
        try {
            var blob = await Crypto.encryptJson(Auth.dataKeyBytes(Session), State.data);
            await Store.putJson(ledgerPath(), blob, `data: update ledger (${State.data.transactions.length} tx)`);
        } catch (e) {
            console.error(e);
            if (n === State.saving) showToast("تعذر الحفظ في قاعدة البيانات — أعد المحاولة", "error");
        } finally {
            State.saving--;
        }
    }

    function showToast(msg, type = 'success') {
        var container = document.getElementById('toast-container');
        var el = document.createElement('div');
        el.className = `px-4 py-2.5 rounded-xl shadow-lg text-xs sm:text-sm font-bold text-white transition-all duration-300 pointer-events-auto ${
            type === 'error' ? 'bg-rose-600' : type === 'info' ? 'bg-slate-800' : 'bg-emerald-600'
        }`;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('opacity-0', '-translate-y-2');
            setTimeout(() => el.remove(), 300);
        }, 2800);
    }
    window.showToast = showToast;

    var confirmCallback = null;
    function askConfirm(title, desc, cb) {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-desc').textContent = desc;
        confirmCallback = cb;
        document.getElementById('modal-confirm').classList.remove('hidden');
    }
    window.askConfirm = askConfirm;

    document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
        document.getElementById('modal-confirm').classList.add('hidden');
        confirmCallback = null;
    });

    document.getElementById('confirm-ok-btn').addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        document.getElementById('modal-confirm').classList.add('hidden');
        confirmCallback = null;
    });

    // Simple prompt modal (used by admin.js too)
    var promptCallback = null;
    function askPrompt(title, value, cb) {
        document.getElementById('prompt-title').textContent = title;
        document.getElementById('prompt-input').value = value || '';
        promptCallback = cb;
        document.getElementById('modal-prompt').classList.remove('hidden');
        document.getElementById('prompt-input').focus();
    }
    window.askPrompt = askPrompt;
    document.getElementById('prompt-cancel-btn').addEventListener('click', () => {
        document.getElementById('modal-prompt').classList.add('hidden');
        promptCallback = null;
    });
    document.getElementById('prompt-ok-btn').addEventListener('click', () => {
        var v = document.getElementById('prompt-input').value;
        document.getElementById('modal-prompt').classList.add('hidden');
        if (promptCallback) promptCallback(v);
        promptCallback = null;
    });

    // Theme
    function initTheme() {
        try {
            var isDark = localStorage.theme === 'dark';
            document.documentElement.classList.toggle('dark', isDark);
            document.getElementById('theme-sun-icon').classList.toggle('hidden', !isDark);
            document.getElementById('theme-moon-icon').classList.toggle('hidden', isDark);
        } catch (e) {}
    }

    document.getElementById('theme-toggle-btn').addEventListener('click', () => {
        var isDark = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', isDark);
        try { localStorage.theme = isDark ? 'dark' : 'light'; } catch (e) {}
        document.getElementById('theme-sun-icon').classList.toggle('hidden', !isDark);
        document.getElementById('theme-moon-icon').classList.toggle('hidden', isDark);
        renderAll();
    });

    // User chip + logout
    document.getElementById('user-display').textContent = Session.displayName;
    document.getElementById('user-role').textContent = Session.role === 'admin' ? 'مدير النظام' : 'محاسب';
    document.getElementById('user-avatar').textContent = (Session.displayName || '?').trim().charAt(0);
    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());
    if (Session.role === 'admin') {
        document.getElementById('admin-tab-btn').classList.remove('hidden');
    }

    // Month picker
    var monthPicker = document.getElementById('month-picker');
    monthPicker.value = State.selectedMonth;
    monthPicker.addEventListener('change', (e) => {
        State.selectedMonth = e.target.value;
        syncQuickDate();
        renderAll();
    });

    function syncQuickDate() {
        var qDate = document.getElementById('quick-date');
        var m = State.selectedMonth;
        if (m) {
            var today = new Date();
            var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
            qDate.value = m === todayStr ? today.toISOString().slice(0, 10) : `${m}-01`;
        }
        document.getElementById('quick-form-month-label').textContent = formatMonthLabel(State.selectedMonth);
    }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    function switchTab(tabId) {
        State.activeTab = tabId;
        document.querySelectorAll('.tab-btn').forEach(b => {
            var active = b.dataset.tab === tabId;
            b.className = active
                ? 'tab-btn px-3.5 py-1.5 rounded-lg font-bold bg-emerald-50 text-emerald-700 dark:bg-slate-700 dark:text-white transition whitespace-nowrap'
                : 'tab-btn px-3.5 py-1.5 rounded-lg font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition whitespace-nowrap';
        });
        document.querySelectorAll('.tab-content').forEach(s => {
            s.classList.toggle('hidden', s.id !== `tab-${tabId}`);
        });
        document.getElementById('kpi-section').classList.toggle('hidden', tabId === 'categories' || tabId === 'admin');
        renderAll();
    }
    window.switchTab = switchTab;

    document.getElementById('go-to-ledger-btn').addEventListener('click', () => switchTab('ledger'));

    // Category dropdowns
    function populateCategorySelect(typeSelectEl, catSelectEl, selectedVal = '') {
        var type = typeSelectEl.value;
        var list = type === 'income' ? State.data.incomeCategories : State.data.expenseCategories;
        catSelectEl.innerHTML = list.map(c => `<option value="${c}" ${c === selectedVal ? 'selected' : ''}>${c}</option>`).join('');
    }

    document.getElementById('quick-type').addEventListener('change', () => {
        populateCategorySelect(document.getElementById('quick-type'), document.getElementById('quick-category'));
    });

    document.getElementById('tx-type').addEventListener('change', () => {
        populateCategorySelect(document.getElementById('tx-type'), document.getElementById('tx-category'));
    });

    // Large-transaction Telegram alert (threshold comes from data/config.json)
    var txThreshold = 5000;
    Store.getJson('data/config.json').then(cfg => {
        if (cfg && cfg.largeTxThreshold) txThreshold = cfg.largeTxThreshold;
    }).catch(() => {});

    function maybeAlertLargeTx(tx) {
        if (tx && Number(tx.amount) >= txThreshold) {
            Telegram.largeTransaction(Session, tx);
        }
    }

    // Quick Add Form
    document.getElementById('quick-tx-form').addEventListener('submit', (e) => {
        e.preventDefault();
        var date = document.getElementById('quick-date').value;
        var tx = {
            id: 'T-' + Date.now(),
            type: document.getElementById('quick-type').value,
            category: document.getElementById('quick-category').value,
            amount: parseFloat(document.getElementById('quick-amount').value),
            date: date,
            method: 'نقدي',
            desc: document.getElementById('quick-desc').value.trim()
        };
        State.data.transactions.unshift(tx);
        State.selectedMonth = date.slice(0, 7);
        monthPicker.value = State.selectedMonth;
        saveState();
        maybeAlertLargeTx(tx);
        e.target.reset();
        syncQuickDate();
        populateCategorySelect(document.getElementById('quick-type'), document.getElementById('quick-category'));
        renderAll();
        showToast('تم تسجيل الحركة بنجاح');
    });

    // Modal Add/Edit
    function openTxModal(tx = null) {
        document.getElementById('tx-form').reset();
        var typeEl = document.getElementById('tx-type');
        var catEl = document.getElementById('tx-category');
        if (tx) {
            document.getElementById('modal-tx-title').textContent = 'تعديل حركة مادية';
            document.getElementById('tx-id').value = tx.id;
            typeEl.value = tx.type;
            populateCategorySelect(typeEl, catEl, tx.category);
            document.getElementById('tx-amount').value = tx.amount;
            document.getElementById('tx-date').value = tx.date;
            document.getElementById('tx-method').value = tx.method || 'نقدي';
            document.getElementById('tx-desc').value = tx.desc;
        } else {
            document.getElementById('modal-tx-title').textContent = 'تسجيل حركة مادية جديدة';
            document.getElementById('tx-id').value = '';
            typeEl.value = 'income';
            populateCategorySelect(typeEl, catEl);
            var today = new Date();
            var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
            document.getElementById('tx-date').value = State.selectedMonth === todayStr ? today.toISOString().slice(0, 10) : `${State.selectedMonth}-01`;
        }
        document.getElementById('modal-tx').classList.remove('hidden');
    }

    document.getElementById('open-add-tx-btn').addEventListener('click', () => openTxModal());
    document.getElementById('close-tx-modal-btn').addEventListener('click', () => document.getElementById('modal-tx').classList.add('hidden'));
    document.getElementById('cancel-tx-modal-btn').addEventListener('click', () => document.getElementById('modal-tx').classList.add('hidden'));

    document.getElementById('tx-form').addEventListener('submit', (e) => {
        e.preventDefault();
        var id = document.getElementById('tx-id').value;
        var date = document.getElementById('tx-date').value;
        var payload = {
            id: id || ('T-' + Date.now()),
            type: document.getElementById('tx-type').value,
            category: document.getElementById('tx-category').value,
            amount: parseFloat(document.getElementById('tx-amount').value),
            date: date,
            method: document.getElementById('tx-method').value,
            desc: document.getElementById('tx-desc').value.trim()
        };
        if (id) {
            var idx = State.data.transactions.findIndex(t => t.id === id);
            if (idx !== -1) State.data.transactions[idx] = payload;
            showToast('تم تحديث الحركة المادية');
        } else {
            State.data.transactions.unshift(payload);
            showToast('تمت إضافة الحركة المادية');
            maybeAlertLargeTx(payload);
        }
        State.selectedMonth = date.slice(0, 7);
        monthPicker.value = State.selectedMonth;
        saveState();
        document.getElementById('modal-tx').classList.add('hidden');
        renderAll();
    });

    window.editTx = function (id) {
        var tx = State.data.transactions.find(t => t.id === id);
        if (tx) openTxModal(tx);
    };

    window.deleteTx = function (id) {
        askConfirm('حذف حركة مادية', 'هل تريد حذف هذه الحركة من السجل المالي؟', () => {
            State.data.transactions = State.data.transactions.filter(t => t.id !== id);
            saveState();
            renderAll();
            showToast('تم حذف الحركة');
        });
    };

    // Render KPIs
    function getMonthTransactions(ym = State.selectedMonth) {
        return State.data.transactions
            .filter(t => t.date && t.date.startsWith(ym))
            .sort((a, b) => b.date.localeCompare(a.date));
    }
    window.getMonthTransactions = getMonthTransactions;

    function renderKPIs() {
        var list = getMonthTransactions();
        var incomes = list.filter(t => t.type === 'income');
        var expenses = list.filter(t => t.type === 'expense');
        var totalIn = incomes.reduce((s, t) => s + t.amount, 0);
        var totalOut = expenses.reduce((s, t) => s + t.amount, 0);
        var net = totalIn - totalOut;
        var margin = totalIn > 0 ? Math.round((net / totalIn) * 100) : 0;

        document.getElementById('kpi-income').textContent = formatMoney(totalIn);
        document.getElementById('kpi-income-count').textContent = `${incomes.length} عملية واردة في ${formatMonthLabel(State.selectedMonth)}`;
        document.getElementById('kpi-expense').textContent = formatMoney(totalOut);
        document.getElementById('kpi-expense-count').textContent = `${expenses.length} عملية منصرفة`;

        var netEl = document.getElementById('kpi-net');
        netEl.textContent = formatMoney(net);
        netEl.className = `text-2xl font-extrabold mt-2 ${net > 0 ? 'text-emerald-600' : net < 0 ? 'text-rose-600' : 'text-slate-800 dark:text-white'}`;
        document.getElementById('kpi-net-status').textContent = net > 0 ? 'فائض مالي إيجابي' : net < 0 ? 'عجز (المصروفات أعلى من الدخل)' : 'متوازن';
        document.getElementById('kpi-margin').textContent = `${margin}%`;
    }

    // Render Charts
    document.getElementById('chart-mode-expense').addEventListener('click', () => {
        State.chartMode = 'expense';
        updateChartModeButtons();
        renderCategoryChart();
    });

    document.getElementById('chart-mode-income').addEventListener('click', () => {
        State.chartMode = 'income';
        updateChartModeButtons();
        renderCategoryChart();
    });

    function updateChartModeButtons() {
        var expBtn = document.getElementById('chart-mode-expense');
        var incBtn = document.getElementById('chart-mode-income');
        if (State.chartMode === 'expense') {
            expBtn.className = 'px-2.5 py-1 rounded-md font-bold bg-white dark:bg-slate-600 text-rose-600 dark:text-rose-300 shadow-sm';
            incBtn.className = 'px-2.5 py-1 rounded-md font-medium text-slate-500 dark:text-slate-300';
        } else {
            incBtn.className = 'px-2.5 py-1 rounded-md font-bold bg-white dark:bg-slate-600 text-emerald-600 dark:text-emerald-300 shadow-sm';
            expBtn.className = 'px-2.5 py-1 rounded-md font-medium text-slate-500 dark:text-slate-300';
        }
    }

    function renderCharts() {
        var monthsSet = new Set(State.data.transactions.map(t => t.date.slice(0, 7)));
        monthsSet.add(State.selectedMonth);
        var sortedMonths = Array.from(monthsSet).sort();

        var incomeSeries = sortedMonths.map(m =>
            State.data.transactions.filter(t => t.date.startsWith(m) && t.type === 'income').reduce((s, t) => s + t.amount, 0)
        );
        var expenseSeries = sortedMonths.map(m =>
            State.data.transactions.filter(t => t.date.startsWith(m) && t.type === 'expense').reduce((s, t) => s + t.amount, 0)
        );

        var ctx1 = document.getElementById('monthlyComparisonChart');
        if (ctx1) {
            if (State.charts.monthly) State.charts.monthly.destroy();
            State.charts.monthly = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: sortedMonths.map(formatMonthLabel),
                    datasets: [
                        { label: 'المدخلات (الإيرادات)', data: incomeSeries, backgroundColor: '#10b981', borderRadius: 6 },
                        { label: 'المخرجات (المصروفات)', data: expenseSeries, backgroundColor: '#f43f5e', borderRadius: 6 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { font: { family: 'Cairo' } } } },
                    scales: { y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.15)' } }, x: { grid: { display: false } } }
                }
            });
        }
        renderCategoryChart();
    }

    function renderCategoryChart() {
        var ctx2 = document.getElementById('categoryBreakdownChart');
        if (!ctx2) return;
        if (State.charts.category) State.charts.category.destroy();

        var filtered = getMonthTransactions().filter(t => t.type === State.chartMode);
        var totals = {};
        filtered.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });

        var labels = Object.keys(totals);
        var values = Object.values(totals);

        State.charts.category = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: labels.length ? labels : ['لا توجد بيانات'],
                datasets: [{
                    data: values.length ? values : [1],
                    backgroundColor: values.length
                        ? ['#10b981', '#3b82f6', '#f59e0b', '#f43f5e', '#8b5cf6', '#14b8a6', '#ec4899']
                        : ['#cbd5e1'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Cairo' } } } }
            }
        });
    }

    // Render Recent Transactions
    function renderRecentTx() {
        var container = document.getElementById('recent-tx-list');
        var list = getMonthTransactions().slice(0, 6);
        if (!list.length) {
            container.innerHTML = `<div class="p-8 text-center text-xs text-slate-400">لا توجد حركات مسجلة في ${formatMonthLabel(State.selectedMonth)}</div>`;
            return;
        }
        container.innerHTML = list.map(t => `
            <div class="p-4 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                        t.type === 'income' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                    }">
                        ${t.type === 'income' ? '↑' : '↓'}
                    </div>
                    <div>
                        <p class="font-bold text-sm text-slate-800 dark:text-white">${t.desc}</p>
                        <p class="text-xs text-slate-400">${t.category} • ${t.date} • ${t.method}</p>
                    </div>
                </div>
                <span class="font-extrabold text-sm whitespace-nowrap ${t.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}">
                    ${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount)}
                </span>
            </div>
        `).join('');
    }

    // Render Ledger
    function getFilteredLedger() {
        var q = (document.getElementById('ledger-search').value || '').trim().toLowerCase();
        var typeF = document.getElementById('ledger-filter-type').value;
        var methodF = document.getElementById('ledger-filter-method').value;
        return getMonthTransactions().filter(t => {
            var matchQ = !q || t.desc.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
            var matchT = typeF === 'all' || t.type === typeF;
            var matchM = methodF === 'all' || t.method === methodF;
            return matchQ && matchT && matchM;
        });
    }

    function renderLedger() {
        var list = getFilteredLedger();
        var tbody = document.getElementById('ledger-table-body');
        var tfoot = document.getElementById('ledger-table-foot');

        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-xs text-slate-400">لا توجد حركات مطابقة في هذا الشهر</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        tbody.innerHTML = list.map(t => `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                <td class="py-3 px-4 font-mono text-xs text-slate-500">${t.date}</td>
                <td class="py-3 px-4">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        t.type === 'income' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                    }">${t.type === 'income' ? 'مدخل' : 'مخرج'}</span>
                </td>
                <td class="py-3 px-4 font-semibold text-xs text-slate-700 dark:text-slate-200">${t.category}</td>
                <td class="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">${t.desc}</td>
                <td class="py-3 px-4 text-xs text-slate-500">${t.method}</td>
                <td class="py-3 px-4 font-extrabold text-sm ${t.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}">
                    ${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount)}
                </td>
                <td class="py-3 px-4 text-center no-print">
                    <button onclick="editTx('${t.id}')" class="p-1 text-slate-400 hover:text-indigo-600" title="تعديل">✏️</button>
                    <button onclick="deleteTx('${t.id}')" class="p-1 text-slate-400 hover:text-rose-600" title="حذف">🗑️</button>
                </td>
            </tr>
        `).join('');

        var sumIn = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        var sumOut = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        tfoot.innerHTML = `
            <tr>
                <td colspan="5" class="py-3 px-4 text-slate-600 dark:text-slate-300">إجمالي الحركات المعروضة (${list.length} حركة)</td>
                <td colspan="2" class="py-3 px-4">
                    <span class="text-emerald-600 ml-3">مدخلات: ${formatMoney(sumIn)}</span>
                    <span class="text-rose-600 ml-3">مخرجات: ${formatMoney(sumOut)}</span>
                    <span class="text-slate-800 dark:text-white">الصافي: ${formatMoney(sumIn - sumOut)}</span>
                </td>
            </tr>
        `;
    }

    document.getElementById('ledger-search').addEventListener('input', renderLedger);
    document.getElementById('ledger-filter-type').addEventListener('change', renderLedger);
    document.getElementById('ledger-filter-method').addEventListener('change', renderLedger);

    // Monthly Summary Table
    function renderMonthlySummary() {
        var monthsSet = new Set(State.data.transactions.map(t => t.date.slice(0, 7)));
        var sorted = Array.from(monthsSet).sort().reverse();
        var tbody = document.getElementById('monthly-summary-body');

        if (!sorted.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-xs text-slate-400">لا توجد بيانات شهرية مسجلة</td></tr>`;
            return;
        }

        tbody.innerHTML = sorted.map(ym => {
            var list = getMonthTransactions(ym);
            var inc = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            var exp = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
            var net = inc - exp;
            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition ${ym === State.selectedMonth ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''}">
                    <td class="py-3 px-4 font-bold text-slate-800 dark:text-white">${formatMonthLabel(ym)}</td>
                    <td class="py-3 px-4 text-xs text-slate-500">${list.length} حركة</td>
                    <td class="py-3 px-4 font-bold text-emerald-600">${formatMoney(inc)}</td>
                    <td class="py-3 px-4 font-bold text-rose-600">${formatMoney(exp)}</td>
                    <td class="py-3 px-4 font-extrabold ${net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}">${formatMoney(net)}</td>
                    <td class="py-3 px-4">
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${net >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
                            ${net > 0 ? 'فائض' : net < 0 ? 'عجز' : 'متوازن'}
                        </span>
                    </td>
                    <td class="py-3 px-4 text-center no-print">
                        <button onclick="selectMonthAndOpen('${ym}')" class="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 px-3 py-1 rounded-lg font-bold transition">
                            فتح الشهر
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.selectMonthAndOpen = function (ym) {
        State.selectedMonth = ym;
        monthPicker.value = ym;
        syncQuickDate();
        switchTab('ledger');
    };

    // Save a monthly report snapshot into the encrypted store
    document.getElementById('save-report-btn').addEventListener('click', async () => {
        var ym = State.selectedMonth;
        var list = getMonthTransactions(ym);
        var inc = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        var exp = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        var byCat = {};
        list.forEach(t => {
            var k = (t.type === 'income' ? 'in:' : 'out:') + t.category;
            byCat[k] = (byCat[k] || 0) + t.amount;
        });
        var report = {
            month: ym,
            label: formatMonthLabel(ym),
            generatedAt: new Date().toISOString(),
            generatedBy: Session.username,
            txCount: list.length,
            income: inc,
            expense: exp,
            net: inc - exp,
            byCategory: byCat
        };
        try {
            var blob = await Crypto.encryptJson(Auth.dataKeyBytes(Session), report);
            await Store.putJson(`data/users/${Session.username}/reports/${ym}.json.enc`, blob, `report: ${ym} by ${Session.username}`);
            showToast(`تم حفظ تقرير ${formatMonthLabel(ym)} في قاعدة البيانات`);
        } catch (e) {
            console.error(e);
            showToast('تعذر حفظ التقرير', 'error');
        }
    });

    // Categories Management
    function renderCategories() {
        var incWrap = document.getElementById('income-cats-list');
        var expWrap = document.getElementById('expense-cats-list');

        incWrap.innerHTML = State.data.incomeCategories.map(c => `
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <span>${c}</span>
                <button onclick="removeCategory('income', '${c}')" class="text-emerald-600 hover:text-rose-600 font-bold">×</button>
            </span>
        `).join('');

        expWrap.innerHTML = State.data.expenseCategories.map(c => `
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                <span>${c}</span>
                <button onclick="removeCategory('expense', '${c}')" class="text-rose-600 hover:text-rose-800 font-bold">×</button>
            </span>
        `).join('');
    }

    document.getElementById('add-income-cat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        var val = document.getElementById('new-income-cat').value.trim();
        if (val && !State.data.incomeCategories.includes(val)) {
            State.data.incomeCategories.push(val);
            saveState();
            e.target.reset();
            renderAll();
            showToast('تمت إضافة بند الإيراد');
        }
    });

    document.getElementById('add-expense-cat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        var val = document.getElementById('new-expense-cat').value.trim();
        if (val && !State.data.expenseCategories.includes(val)) {
            State.data.expenseCategories.push(val);
            saveState();
            e.target.reset();
            renderAll();
            showToast('تمت إضافة بند المصروف');
        }
    });

    window.removeCategory = function (type, name) {
        var key = type === 'income' ? 'incomeCategories' : 'expenseCategories';
        if (State.data[key].length <= 1) {
            showToast('يجب الإبقاء على بند واحد على الأقل', 'error');
            return;
        }
        State.data[key] = State.data[key].filter(c => c !== name);
        saveState();
        renderAll();
        showToast('تم حذف البند');
    };

    // Export CSV & JSON / Import / Print
    document.getElementById('export-month-csv-btn').addEventListener('click', () => {
        var list = getFilteredLedger();
        var rows = [['التاريخ', 'النوع', 'البند', 'البيان', 'طريقة الدفع', 'المبلغ']];
        list.forEach(t => {
            rows.push([
                t.date,
                t.type === 'income' ? 'مدخل' : 'مخرج',
                t.category,
                `"${(t.desc || '').replace(/"/g, '""')}"`,
                t.method,
                t.amount
            ]);
        });
        var csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ledger_${State.selectedMonth}.csv`;
        a.click();
        showToast('تم تصدير ملف CSV للشهر');
    });

    document.getElementById('print-ledger-btn').addEventListener('click', () => window.print());
    document.getElementById('print-annual-btn').addEventListener('click', () => window.print());

    document.getElementById('export-json-btn').addEventListener('click', () => {
        var blob = new Blob([JSON.stringify(State.data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `financial_ledger_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        showToast('تم تحميل النسخة الاحتياطية');
    });

    document.getElementById('import-json-btn').addEventListener('click', () => {
        document.getElementById('import-json-input').click();
    });

    document.getElementById('import-json-input').addEventListener('change', (e) => {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = (ev) => {
            try {
                var parsed = JSON.parse(ev.target.result);
                if (Array.isArray(parsed.transactions)) {
                    State.data = parsed;
                    saveState();
                    renderAll();
                    showToast('تم استيراد البيانات بنجاح');
                } else {
                    showToast('صيغة الملف غير صحيحة', 'error');
                }
            } catch (err) {
                showToast('تعذر قراءة الملف', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    document.getElementById('reset-data-btn').addEventListener('click', () => {
        askConfirm('استعادة البيانات الافتراضية', 'سيتم استبدال كافة الحركات الحالية بقائمة فارغة (بنود افتراضية). لا يمكن التراجع.', () => {
            State.data = JSON.parse(JSON.stringify(DEFAULT_STATE));
            saveState();
            renderAll();
            showToast('تمت استعادة البيانات الافتراضية');
        });
    });

    function renderAll() {
        if (!State.data) return;
        renderKPIs();
        populateCategorySelect(document.getElementById('quick-type'), document.getElementById('quick-category'));
        if (State.activeTab === 'overview') {
            renderCharts();
            renderRecentTx();
        } else if (State.activeTab === 'ledger') {
            renderLedger();
        } else if (State.activeTab === 'monthly-summary') {
            renderMonthlySummary();
        } else if (State.activeTab === 'categories') {
            renderCategories();
        } else if (State.activeTab === 'admin' && window.renderAdmin) {
            window.renderAdmin();
        }
    }
    window.renderApp = renderAll;
    window.appState = State;

    window.addEventListener('DOMContentLoaded', async () => {
        initTheme();
        await loadState();
        syncQuickDate();
        renderAll();
    });
})();
