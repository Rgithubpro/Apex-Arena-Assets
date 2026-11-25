Router.register('admin', (() => {
    const $ = (id) => document.getElementById(id);
    const el = (tag, props = {}, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v);
        }
        n.append(...kids);
        return n;
    };
    const api = (method, path, body, query) => window.Auth.api(method, path, { body, query });
    const when = (sec) => (sec ? new Date(sec * 1000).toLocaleString() : '-');
    const isAdmin = () => me?.role === 'admin';

    let me = null;
    let tab = 'overview';
    let timer = null;
    let root = null;
    let msg = null;

    const say = (text, ok = false) => { if (msg) { msg.textContent = text; msg.className = `adm-msg${ok ? ' ok' : ''}`; } };
    const table = (heads, rows, onRow) => {
        const t = el('table', { class: 'adm-table' }, el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', { text: h })))));
        const body = el('tbody');
        for (const { cells, id } of rows) {
            const tr = el('tr', onRow && id ? { class: 'click', onclick: () => onRow(id) } : {}, ...cells.map((c) => (c instanceof Node ? el('td', {}, c) : el('td', { text: String(c ?? '-') }))));
            body.append(tr);
        }
        t.append(body);
        return rows.length ? t : el('p', { class: 'adm-muted', text: 'Nothing here.' });
    };

    // Small form dialog: resolves with the typed values, or null when cancelled.
    function ask(title, fields, ok = 'Confirm', danger = false) {
        return new Promise((resolve) => {
            const inputs = {};
            const card = el('div', { class: 'adm-card' }, el('h3', { text: title }));
            for (const f of fields) {
                const input = f.long ? el('textarea', { rows: '2' }) : el('input', { type: f.type || 'text' });
                if (f.value !== undefined) input.value = f.value;
                if (f.placeholder) input.placeholder = f.placeholder;
                inputs[f.name] = input;
                card.append(el('label', { text: f.label }), input);
            }
            const back = el('div', { class: 'adm-dialog' }, card);
            const close = (v) => { back.remove(); resolve(v); };
            card.append(el('div', { class: 'adm-row' },
                el('button', { text: 'Cancel', onclick: () => close(null) }),
                el('button', { class: danger ? 'danger' : 'primary', text: ok, onclick: () => close(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))) })));
            $('admin-screen').append(back);
            Object.values(inputs)[0]?.focus();
        });
    }

    async function run(label, fn, after) {
        say('Working...');
        try { await fn(); say(`${label}: done`, true); if (after) await after(); } catch (e) { say(e.message || e.code || 'Something went wrong'); }
    }

    // ------------------------------------------------------------------ gate: login state + authenticator
    function gate(title, text, ...extra) {
        root.replaceChildren(el('div', { class: 'adm-card' }, el('h2', { text: title }), el('p', { text }), ...extra));
    }

    async function boot() {
        root.replaceChildren(el('p', { text: 'Loading...' }));
        if (!window.Auth?.user) return gate('Log in first', 'Log in to the game with your staff account, then open this page again (add #admin to the address).');
        try {
            me = await api('GET', '/admin/me');
        } catch (e) {
            return gate(e.code === 'forbidden' ? 'No access' : 'Error', e.code === 'forbidden' ? 'This account is not staff.' : e.message);
        }
        $('admin-role').textContent = me.role;
        if (!me.verified) return me.totp_enabled ? codeForm() : setup2fa();
        shell();
    }

    function codeForm(confirmMode = false) {
        const input = el('input', { inputmode: 'numeric', maxlength: '8', placeholder: '6-digit code', autocomplete: 'one-time-code' });
        msg = el('p', { class: 'adm-msg' });
        const go = () => run('Checked', async () => { await api('POST', confirmMode ? '/admin/2fa/confirm' : '/admin/2fa/verify', { code: input.value }); await boot(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        root.replaceChildren(el('div', { class: 'adm-card' }, el('h2', { text: 'Authenticator code' }), el('p', { text: 'Open your authenticator app and type the current code for Apex Arena.' }),
            el('div', { class: 'adm-row' }, input, el('button', { class: 'primary', text: 'Continue', onclick: go })), msg));
        input.focus();
    }

    async function setup2fa() {
        let data;
        try { data = await api('POST', '/admin/2fa/setup', {}); } catch (e) { return gate('Error', e.message); }
        root.replaceChildren(el('div', { class: 'adm-card' }, el('h2', { text: 'Set up two-step login' }),
            el('p', { text: 'Add this key to an authenticator app (Google Authenticator, Authy, 1Password...) as a time-based code, then enter the code it shows.' }),
            el('div', { class: 'adm-secret', text: data.secret }),
            el('p', { class: 'adm-muted' }, el('a', { href: data.otpauth, text: 'Open in the authenticator app', style: 'color:#01fbff' }))));
        const holder = el('div');
        root.append(holder);
        codeForm(true);
        root.prepend(el('div', { class: 'adm-card' }, el('h2', { text: 'Set up two-step login' }), el('p', { text: 'Add this key to an authenticator app as a time-based code:' }), el('div', { class: 'adm-secret', text: data.secret }),
            el('p', { class: 'adm-muted' }, el('a', { href: data.otpauth, text: 'or open it in the authenticator app', style: 'color:#01fbff' }))));
    }

    // ------------------------------------------------------------------ main panel
    const TABS = [['overview', 'Overview'], ['players', 'Players'], ['online', 'Online'], ['bans', 'Bans'], ['rules', 'Username rules', true], ['audit', 'Audit log']];

    function shell() {
        clearInterval(timer);
        const bar = el('div', { class: 'adm-tabs' });
        for (const [id, label, adminOnly] of TABS) {
            if (adminOnly && !isAdmin()) continue;
            bar.append(el('button', { class: id === tab ? 'active' : '', text: label, onclick: () => { tab = id; shell(); } }));
        }
        msg = el('p', { class: 'adm-msg' });
        const view = el('div');
        root.replaceChildren(bar, msg, view);
        views[tab](view);
    }

    const views = {
        async overview(view) {
            const o = await api('GET', '/admin/overview');
            const stat = (n, label) => el('div', { class: 'adm-card adm-stat' }, el('b', { text: n }), el('span', { text: label }));
            const total = Object.values(o.accounts).reduce((a, b) => a + b, 0);
            view.append(el('div', { class: 'adm-stats' }, stat(o.online, 'online now'), stat(total, 'accounts'), stat(o.banned, 'banned / timed out'), stat(o.ip_bans, 'network bans')),
                el('div', { class: 'adm-card' }, el('h3', { text: 'Accounts by login method' }), table(['Method', 'Accounts'], Object.entries(o.accounts).map(([m, n]) => ({ cells: [m, n] }))),
                    el('p', { class: 'adm-muted', text: `Counts refresh every 10 minutes (${o.counts_age_seconds}s old).` })));
        },

        async players(view) {
            const input = el('input', { placeholder: 'Name, e-mail or id', style: 'flex:1;min-width:200px' });
            const results = el('div');
            const search = async () => {
                try {
                    const { users } = await api('GET', '/admin/users', undefined, { q: input.value });
                    results.replaceChildren(table(['Name', 'Login', 'Role', 'Status', 'Last seen'], users.map((u) => ({ id: u.id, cells: [u.username ?? '(no name yet)', u.method, u.role, u.banned && (!u.banned_until || u.banned_until > Date.now() / 1000) ? el('span', { class: 'adm-tag bad', text: u.banned_until ? 'timed out' : 'banned' }) : 'ok', when(u.last_seen_at)] })), profile));
                } catch (e) { say(e.message); }
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
            view.append(el('div', { class: 'adm-card' }, el('div', { class: 'adm-row' }, input, el('button', { class: 'primary', text: 'Search', onclick: search }))), results);
        },

        async online(view) {
            const draw = async () => {
                const { players } = await api('GET', '/admin/online');
                view.replaceChildren(el('div', { class: 'adm-card' }, el('h3', { text: `${players.length} online (updates every 15 s)` }),
                    table(['Name', 'Login', 'Role', 'Devices', 'Last seen'], players.map((p) => ({ id: p.id, cells: [p.username ?? '-', p.method, p.role, p.devices, when(p.last_seen)] })), profile)));
            };
            await draw();
            timer = setInterval(() => draw().catch(() => {}), 15000);
        },

        async bans(view) {
            const [{ bans }, { bans: ips }] = await Promise.all([api('GET', '/admin/bans'), api('GET', '/admin/ip-bans')]);
            const ipForm = isAdmin() ? el('button', { text: 'Ban a network', onclick: async () => {
                const v = await ask('Ban a network (IP address)', [{ name: 'ip', label: 'IP address' }, { name: 'hours', label: 'Hours (empty = permanent)', type: 'number' }, { name: 'public_reason', label: 'Reason shown to them' }, { name: 'private_reason', label: 'Private note' }], 'Ban', true);
                if (v) run('Network banned', () => api('POST', '/admin/ip-bans', { ip: v.ip, hours: v.hours, public_reason: v.public_reason, private_reason: v.private_reason }), shell);
            } }) : '';
            view.append(el('div', { class: 'adm-card' }, el('h3', { text: 'Banned and timed-out players' }),
                table(['Name', 'Until', 'Shown to player', 'Private'], bans.map((b) => ({ id: b.id, cells: [b.username ?? '-', b.banned_until ? when(b.banned_until) : 'permanent', b.ban_public_reason, b.ban_reason] })), profile)),
                el('div', { class: 'adm-card' }, el('h3', { text: 'Banned networks (hashed, addresses are never stored)' }), ipForm,
                    table(['Network id', 'Until', 'Shown', 'Private', 'By', ''], ips.map((b) => ({ cells: [b.ip_hash.slice(0, 8), b.expires_at ? when(b.expires_at) : 'permanent', b.public_reason, b.private_reason, b.created_by,
                        isAdmin() ? el('button', { text: 'Lift', onclick: () => run('Network ban lifted', () => api('DELETE', `/admin/ip-bans/${b.ip_hash}`), shell) }) : ''] })))));
        },

        async rules(view) {
            const { rules, loaded } = await api('GET', '/admin/username-rules');
            const test = el('input', { placeholder: 'Try a name' });
            const out = el('span', { class: 'adm-muted' });
            view.append(el('div', { class: 'adm-card' }, el('h3', { text: 'Username filter' }),
                el('p', { class: 'adm-muted', text: `Loaded: ${loaded.exact} exact, ${loaded.contains} contains, ${loaded.regex} regex, ${loaded.allow} allow. Changes apply within about a minute (at once here).` }),
                el('div', { class: 'adm-row' }, test, el('button', { text: 'Test', onclick: async () => { out.textContent = (await api('POST', '/admin/username-rules/test', { username: test.value })).allowed ? 'allowed' : 'blocked'; } }), out,
                    el('button', { class: 'primary', text: 'Add rule', onclick: async () => {
                        const v = await ask('Add a rule', [{ name: 'kind', label: 'Kind: contains, exact, regex or allow', value: 'contains' }, { name: 'pattern', label: 'Pattern' }, { name: 'note', label: 'Note' }], 'Add');
                        if (v) run('Rule added', () => api('POST', '/admin/username-rules', v), shell);
                    } })),
                table(['#', 'Kind', 'Pattern', 'Note', ''], rules.map((r) => ({ cells: [r.id, r.kind, r.pattern, r.note, el('button', { class: 'danger', text: 'Delete', onclick: () => run('Rule deleted', () => api('DELETE', `/admin/username-rules/${r.id}`), shell) })] })))));
        },

        async audit(view) {
            let before;
            const card = el('div', { class: 'adm-card' }, el('h3', { text: 'Audit log' }));
            const tbody = el('tbody');
            const more = el('button', { text: 'Load more' });
            const load = async () => {
                const { entries } = await api('GET', '/admin/audit', undefined, { limit: '50', ...(before ? { before } : {}) });
                for (const e of entries) tbody.append(el('tr', {}, el('td', { text: when(e.at) }), el('td', { text: e.actor_name }), el('td', { text: e.action }), el('td', { text: e.target_name ?? '-' }), el('td', { text: e.detail ?? '' })));
                if (entries.length) before = entries[entries.length - 1].id;
                more.disabled = entries.length < 50;
            };
            more.addEventListener('click', load);
            const t = el('table', { class: 'adm-table' }, el('thead', {}, el('tr', {}, ...['When', 'Who', 'Action', 'Target', 'Detail'].map((h) => el('th', { text: h })))), tbody);
            card.append(t, more);
            view.append(card);
            await load();
        },
    };

    // ------------------------------------------------------------------ one player
    async function profile(id) {
        views.lastPlayer = id;
        tab = 'players';
        shell();
        const view = root.lastElementChild;
        let p;
        try { p = await api('GET', `/admin/users/${id}`); } catch (e) { return say(e.message); }
        const u = p.user;
        const banned = u.banned && (!u.banned_until || u.banned_until > Date.now() / 1000);
        const act = (label, path, build, opts = {}) => el('button', { class: opts.danger ? 'danger' : '', text: label, onclick: async () => {
            let body = {};
            if (build) { body = await build(); if (body === null) return; }
            run(label, () => api(opts.method || 'POST', `/admin/users/${id}${path}`, body), () => profile(id));
        } });
        const reasons = (title, extra = []) => async () => ask(title, [...extra, { name: 'public_reason', label: 'Reason shown to the player' }, { name: 'private_reason', label: 'Private note (staff only)', long: true }], 'Confirm', true);
        const buttons = [
            act('Log out / kick', '/logout', async () => ask('Log this player out everywhere?', [{ name: 'reason', label: 'Note (optional)' }], 'Log out')),
            act('Time-out', '/timeout', reasons('Time-out', [{ name: 'minutes', label: 'Minutes', type: 'number', value: '30' }]), { danger: true }),
            act('Add note', '/note', async () => ask('Private note', [{ name: 'text', label: 'Note', long: true }], 'Save')),
            banned ? act('Lift ban / time-out', '/unban') : '',
        ];
        if (isAdmin()) {
            buttons.push(
                act('Ban for good', '/ban', reasons('Ban for good'), { danger: true }),
                el('button', { class: 'danger', text: 'Ban their network', onclick: async () => { const v = await ask('Ban the network this player last used', [{ name: 'hours', label: 'Hours (empty = permanent)', type: 'number' }, { name: 'public_reason', label: 'Reason shown' }, { name: 'private_reason', label: 'Private note' }], 'Ban network', true); if (v) run('Network banned', () => api('POST', '/admin/ip-bans', { user_id: id, ...v }), () => profile(id)); } }),
                act('Reset username', '/reset-username', async () => ask('Reset this username? They must pick a new one.', [{ name: 'reason', label: 'Note (optional)' }], 'Reset', true), { danger: true }),
                act('Ask to accept terms again', '/reset-terms'),
                act(p.user.multi_device_ok ? 'Forbid several devices' : 'Allow several devices', '/multi-device', async () => ({ allow: !p.user.multi_device_ok })),
                act('Set role', '/role', async () => ask('Role: player or moderator (admins can only be made with the admin key)', [{ name: 'role', label: 'Role', value: u.staff_role || 'player' }], 'Set')),
                act('Delete account', '', async () => ask(`Type the username (${u.username}) to delete this account for good`, [{ name: 'confirm', label: 'Username' }], 'Delete', true), { danger: true, method: 'DELETE' }),
            );
        }
        const facts = [['Id', u.id], ['Login', u.method], ['Role', u.staff_role || 'player'], ['Created', when(u.created_at)], ['Last seen', when(u.last_seen_at)], ['E-mail', u.email || '-'],
            ['Terms accepted', u.tos_accepted_at ? when(u.tos_accepted_at) : 'no'], ['Online now', p.online ? `yes (${p.online} device${p.online > 1 ? 's' : ''})` : 'no'], ['Several devices allowed', u.multi_device_ok ? 'yes' : 'no'],
            ['Ban', banned ? `${u.banned_until ? `until ${when(u.banned_until)}` : 'permanent'}; shown: ${u.ban_public_reason || '-'}; private: ${u.ban_reason || '-'}` : 'none']];
        view.replaceChildren(el('div', { class: 'adm-card' }, el('h2', { text: u.username ?? '(no name yet)' }), table(['', ''], facts.map(([k, v]) => ({ cells: [k, v] }))), el('div', { class: 'adm-row', style: 'margin-top:.8rem' }, ...buttons)),
            el('div', { class: 'adm-card' }, el('h3', { text: 'Devices logged in' }), table(['Since', 'Last used', 'Network', 'Browser'], p.sessions.map((s) => ({ cells: [when(s.created_at), when(s.last_used_at), s.ip_hash, s.ua] })))),
            el('div', { class: 'adm-card' }, el('h3', { text: 'Other accounts on the same network' }), table(['Name', 'Login'], p.same_network.map((s) => ({ id: s.id, cells: [s.username ?? '-', s.method] })), profile)),
            el('div', { class: 'adm-card' }, el('h3', { text: 'Private notes' }), table(['When', 'By', 'Note'], p.notes.map((n) => ({ cells: [when(n.at), n.author, n.text] })))));
    }

    return {
        start() {
            root = $('admin-main');
            $('admin-back').addEventListener('click', goBack);
            views.lastPlayer = null;
            boot();
        },
        stop() {
            clearInterval(timer);
            $('admin-back')?.removeEventListener('click', goBack);
            root?.replaceChildren();
        },
    };

    function goBack() { Router.go(window.Auth?.user ? 'home' : 'welcome'); }
})());