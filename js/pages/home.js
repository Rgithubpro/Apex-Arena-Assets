/* ================================================================
   HOME SCREEN — page = 'home'
================================================================= */
const HOME_CONFIG = {
    numberFormat: 'plain',          // 'plain' → 5291   |  'separators' → 5,291

    // ---------- TOP ----------
    player: {
        enabled: true,
        username: 'Player',
        usernameColor: '#ff4fd8',   // name text always shrinks to fit its box
        profilePicture: 'assets/icons/profile-pictures/abstract-002.svg',
    },
    trophyRoad: {
        enabled: true,
        trophies: 91021,
        progress: 0.4,                                   // 0..1 fill of the bar
        nextReward: { enabled: true, icon: 'assets/icons/general/coins.png', name: 'Coins' },
        rank: {
            enabled: true,
            icon: 'assets/icons/ranks/trophyroad/rank5.png',
            name: 'Rank 5',
            substage: 'III',                             // '' / null hides the little plate
        },
    },
    currencies: {
        enabled: true,
        gems:        { enabled: true, amount: 134 },
        coins:       { enabled: true, amount: 5291 },
        powerpoints: { enabled: true, amount: 9821 },
        crystals:    { enabled: true, amount: 29512 },
    },
    settings: {
        enabled: true,
        notification: { enabled: false, count: 2 },
    },

    // ---------- LEFT ----------
    shop: {
        enabled: true,
        style: 'yellow',                                 // 'yellow' | 'normal'
        flag: { enabled: true, text: 'Free' },
    },
    battlers: {
        enabled: true,
        notification: { enabled: true, count: 20 },
    },
    unlockBattler: {
        enabled: true,
        icon: 'assets/icons/general/placeholder.png',
        current: 1810,
        goal: 3800,
    },

    // ---------- RIGHT ----------
    news: {
        enabled: true,
        flag: { enabled: true, text: 'New' },
    },
    friends: {
        enabled: true,
        notification: { enabled: true, count: 5 },
    },
    club: {
        enabled: true,
        icon: 'assets/icons/general/club-white.png',
        notification: { enabled: true, count: 2 },
    },
    teamChat: {
        enabled: true,
        style: 'yellow',                                 // 'yellow' | 'normal'
        mode: 'team',                                    // 'team' | 'chat'
        team: { icon: 'assets/icons/general/teamup.png', label: 'Team up!' },
        chat: { icon: 'assets/icons/general/chat.png',   label: 'Chat' },   // ← chat.png is a guess, point at your real icon
    },

    // ---------- CENTER ----------
    battler: {
        trophies: {
            enabled: true,
            rankIcon: 'assets/icons/ranks/battler/rank4.png',
            rankText: 'II',                              // '' / null hides it
            trophies: 920,
            progress: 0.6,                               // 0..1
        },
        powerLevel: { enabled: true, level: 9, ultra: false },   // ultra → flame icon instead of the pink circle
        upgrades: {
            enabled: true,
            gear1:    { enabled: true, icon: 'assets/icons/general/placeholder.png' },
            gear2:    { enabled: true, icon: 'assets/icons/general/placeholder.png' },
            gadget:   { enabled: true, icon: 'assets/icons/general/placeholder.png' },
            starPower:{ enabled: true, icon: 'assets/icons/general/placeholder.png' },
        },
        skins:  { enabled: true },
        render: { enabled: true },                       // the <canvas>; kept sized to its box (dpr-aware)
    },

    // ---------- BOTTOM ----------
    battlepass: {
        enabled: true,
        style: 'normal',                                 // 'yellow' | 'normal'
        icon: 'assets/icons/general/battlepass-normal.png',
        xp: 421,
        xpGoal: 950,
        nextReward: { enabled: true, icon: 'assets/icons/general/stardrop.png', name: 'Star Drop' },
    },
    quests: {
        enabled: true,
        style: 'normal',                                 // 'yellow' | 'normal'
        flag: { enabled: true, text: 'New' },
    },
    streak: {
        enabled: true,
        icon: 'assets/icons/general/flame1.png',
        count: 5,
    },
    event: {
        enabled: true,
        gamemode: 'Football',
        mapName: 'Beach',
        image: 'assets/maps/football.png',
        infoButton: true,
        nextEventInSeconds: 9000,                        // null hides the timer line, counts down live
        nextEventText: 'New event in: {time}',
        newBanner: { enabled: true, text: 'NEW EVENTS!' },
    },
    play: {
        text: 'Play',
        rewards: {
            enabled: true,
            icon: 'assets/icons/general/stardrop.png',
            total: 6,                                    // 1–6 slots; one reward sits at the end of each segment
            progress: 3.4,                               // in rewards: 3.4 = 3 reached (hidden) + 40% into the 4th
            nextInSeconds: 19380,                        // shown ONLY when progress >= total (bar complete); null = hide strip then
            nextText: 'Next rewards {time}',
            showClock: true,
        },
    },

    // ---------- CLICK ACTIONS ----------
    // value = a Router page name (see router.js `pages`) or a function. null = nothing happens.
    // Navigation goes through Router.go(), so allowedTransitions are enforced by the router, and
    // run() also refuses pages whose <id>-screen element isn't in the DOM yet (no blank screens).
    actions: {
        profile: 'profile', trophyRoad: 'trophieroad', gems: null, coins: null, powerpoints: null, crystals: null,
        settings: 'settings', shop: 'shop', battlers: 'battlers', unlockBattler: 'unlock-battler',
        news: 'news', friends: 'friends', club: 'club',
        teamChat: null,                                  // router has no team/chat page yet
        skins: 'battler',
        battlepass: 'battlepass', quests: 'quests', streak: null,
        event: 'events', eventInfo: null,
        play: 'matchmaking',
    },
};

Router.register('home', (() => {
    const C = HOME_CONFIG;
    const ACTION_TARGETS = {
        profile: 'profile', trophyRoad: 'trophieroad', gems: 'currencies-gems', coins: 'currencies-coins',
        powerpoints: 'currencies-powerpoints', crystals: 'currencies-crystals', settings: 'settings',
        shop: 'shop', battlers: 'battlers', unlockBattler: 'unlock-battler', news: 'news', friends: 'friends',
        club: 'club', teamChat: 'team-chat', skins: 'battler-skins', battlepass: 'battlepass', quests: 'quests',
        streak: 'streak', event: 'event', eventInfo: 'event-info', play: 'play-button',
    };
    const FIT_IDS = ['profile-username', 'event-box-gamemode', 'event-box-map-name'];

    let running = false;
    let intervalId = null;
    let resizeObserver = null;
    let assetsDirty = false;
    let eventEndAt = null;
    let rewardsEndAt = null;
    let rewardsComplete = false;
    let bound = [];

    // ---------- helpers (all lookups are lazy, nothing runs at parse time) ----------
    const el = (id) => document.getElementById('home-screen-' + id);
    const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
    const fmtNum = (n) => (C.numberFormat === 'separators' ? Number(n).toLocaleString('en-US') : String(n));
    const fmtTime = (s) => {
        s = Math.max(0, Math.floor(s));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    };
    const setText = (id, t) => { const e = el(id); if (e) e.textContent = t; };
    const setShown = (id, on) => { const e = el(id); if (e) e.hidden = !on; return !!on; };
    const setFill = (id, ratio) => { const e = el(id); if (e) e.style.width = clamp01(ratio) * 100 + '%'; };
    const setAlt = (id, t) => { const e = el(id); if (e) e.alt = t; };
    const setVariant = (id, style) => { const e = el(id); if (e) e.classList.toggle('hs-yellow', style === 'yellow'); };
    const setAsset = (id, path) => {
        const e = el(id);
        if (e && path && e.getAttribute('data-asset') !== path) { e.setAttribute('data-asset', path); assetsDirty = true; }
    };
    const setBadge = (base, cfg) => {
        const on = !!(cfg && cfg.enabled && cfg.count > 0);
        if (setShown(base, on)) setText(base + '-text', cfg.count > 99 ? '99+' : cfg.count);
    };
    const setFlag = (base, cfg) => {
        if (setShown(base, !!(cfg && cfg.enabled))) setText(base + '-text', cfg.text);
    };

    // Shrinks a text element's font until it fits its box (re-run on every resize).
    function fitText(e) {
        if (!e) return;
        e.style.fontSize = '';
        const cw = e.clientWidth, sw = e.scrollWidth;
        if (!cw || sw <= cw) return;
        e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * (cw / sw) * 0.96) + 'px';
    }
    const fitAll = () => FIT_IDS.forEach((id) => fitText(el(id)));

    // ---------- apply config → DOM ----------
    function applyConfig() {
        assetsDirty = false;
        const c = C;

        // Top
        if (setShown('profile', c.player.enabled)) {
            setText('profile-username', c.player.username);
            el('profile-username').style.setProperty('--hs-username-color', c.player.usernameColor);
            setAsset('profile-picture', c.player.profilePicture);
        }
        const tr = c.trophyRoad;
        if (setShown('trophieroad', tr.enabled)) {
            setText('trophieroad-count', fmtNum(tr.trophies));
            setFill('trophieroad-progressbar-fill', tr.progress);
            if (setShown('trophieroad-next-reward', tr.nextReward.enabled)) {
                setAsset('trophieroad-next-reward', tr.nextReward.icon);
                setAlt('trophieroad-next-reward', `Next reward = ${tr.nextReward.name}`);
            }
            if (setShown('trophieroad-rank', tr.rank.enabled)) {
                setAsset('trophieroad-rank', tr.rank.icon);
                setAlt('trophieroad-rank', `Rank: ${tr.rank.name}`);
            }
            if (setShown('trophieroad-rank-substage', tr.rank.enabled && !!tr.rank.substage)) {
                setText('trophieroad-rank-substage-text', tr.rank.substage);
            }
        }
        if (setShown('currencies', c.currencies.enabled)) {
            for (const k of ['gems', 'coins', 'powerpoints', 'crystals']) {
                if (setShown('currencies-' + k, c.currencies[k].enabled)) setText(`currencies-${k}-count`, fmtNum(c.currencies[k].amount));
            }
        }
        if (setShown('settings', c.settings.enabled)) setBadge('settings-notification', c.settings.notification);

        // Left
        if (setShown('shop', c.shop.enabled)) { setVariant('shop', c.shop.style); setFlag('shop-flag', c.shop.flag); }
        if (setShown('battlers', c.battlers.enabled)) setBadge('battlers-notification', c.battlers.notification);
        const ub = c.unlockBattler;
        if (setShown('unlock-battler', ub.enabled)) {
            setAsset('unlock-battler-icon', ub.icon);
            setText('unlock-battler-text', `${fmtNum(ub.current)}/${fmtNum(ub.goal)}`);
            setFill('unlock-battler-bar-fill', ub.current / ub.goal);
        }

        // Right
        if (setShown('news', c.news.enabled)) setFlag('news-flag', c.news.flag);
        if (setShown('friends', c.friends.enabled)) setBadge('friends-notification', c.friends.notification);
        if (setShown('club', c.club.enabled)) {
            setAsset('club-icon', c.club.icon);
            setBadge('club-notification', c.club.notification);
        }
        const tc = c.teamChat, tcm = tc.mode === 'chat' ? tc.chat : tc.team;
        if (setShown('team-chat', tc.enabled)) {
            setVariant('team-chat', tc.style);
            setAsset('team-chat-icon', tcm.icon);
            setText('team-chat-text', tcm.label);
        }

        // Center
        const b = c.battler;
        if (setShown('battler-trophies', b.trophies.enabled)) {
            setAsset('battler-trophies-rank-icon', b.trophies.rankIcon);
            if (setShown('battler-trophies-rank-text', !!b.trophies.rankText)) setText('battler-trophies-rank-text', b.trophies.rankText);
            setText('battler-trophies-progressbar-text', fmtNum(b.trophies.trophies));
            setFill('battler-trophies-progressbar-fill', b.trophies.progress);
        }
        if (setShown('battler-power-level', b.powerLevel.enabled)) {
            setText('battler-power-level-text', b.powerLevel.level);
            setShown('battler-power-level-ultra-icon', !!b.powerLevel.ultra);
            el('battler-power-level').classList.toggle('is-ultra', !!b.powerLevel.ultra);
        }
        if (setShown('battler-upgrades', b.upgrades.enabled)) {
            for (const [key, id] of [['gear1', 'gear1'], ['gear2', 'gear2'], ['gadget', 'gadget'], ['starPower', 'starpower']]) {
                if (setShown('battler-upgrades-' + id, b.upgrades[key].enabled)) setAsset('battler-upgrades-' + id, b.upgrades[key].icon);
            }
        }
        setShown('battler-skins', b.skins.enabled);
        setShown('battler-render', b.render.enabled);

        // Bottom
        const bp = c.battlepass;
        if (setShown('battlepass', bp.enabled)) {
            setVariant('battlepass', bp.style);
            setAsset('battlepass-icon', bp.icon);
            setText('battlepass-progressbar-text', `${fmtNum(bp.xp)}/${fmtNum(bp.xpGoal)}`);
            setFill('battlepass-progressbar-fill', bp.xp / bp.xpGoal);
            if (setShown('battlepass-next-reward', bp.nextReward.enabled)) {
                setAsset('battlepass-next-reward', bp.nextReward.icon);
                setAlt('battlepass-next-reward', `Next reward = ${bp.nextReward.name}`);
            }
        }
        if (setShown('quests', c.quests.enabled)) { setVariant('quests', c.quests.style); setFlag('quests-flag', c.quests.flag); }
        if (setShown('streak', c.streak.enabled)) {
            setAsset('streak-icon', c.streak.icon);
            setText('streak-text', c.streak.count);
        }
        const ev = c.event;
        if (setShown('event-wrap', ev.enabled)) {
            setText('event-box-gamemode', ev.gamemode);
            setText('event-box-map-name', ev.mapName);
            setAsset('event-box-mode-image', ev.image);
            setShown('event-info', ev.infoButton);
            setFlag('event-new', ev.newBanner);
            setShown('event-new-event-in', ev.nextEventInSeconds != null);
            eventEndAt = ev.nextEventInSeconds != null ? Date.now() + ev.nextEventInSeconds * 1000 : null;
        } else eventEndAt = null;

        setText('play-button-text', c.play.text);
        applyRewards(c.play.rewards);

        // Re-resolve cached asset URLs for anything whose data-asset changed.
        if (assetsDirty && typeof applyAssetAttributes === 'function') applyAssetAttributes(document.getElementById('home-screen'));
        fitAll();
    }

    // Rewards bar: one reward at the end of each segment; a reached reward disappears.
    // Once progress >= total the bar + rewards are hidden and only "Next rewards in …" remains.
    function applyRewards(r) {
        const total = Math.min(6, Math.max(1, Math.floor(r.total) || 1));
        const reached = Math.floor(r.progress);
        rewardsComplete = r.enabled && r.progress >= total;
        const hasTimer = r.nextInSeconds != null;
        el('play').style.setProperty('--n', total);

        setShown('play-rewards-bar', r.enabled && (!rewardsComplete || hasTimer));
        setShown('play-rewards-bar-fill', !rewardsComplete);
        setFill('play-rewards-bar-fill', r.progress / total);
        for (let i = 1; i <= 6; i++) {
            const seg = el('play-rewards-bar-segment' + i), icon = el('play-reward' + i);
            seg.style.setProperty('--k', i);
            icon.style.setProperty('--k', i);
            seg.hidden = !(r.enabled && !rewardsComplete && i < total);
            icon.hidden = !(r.enabled && !rewardsComplete && i <= total && i > reached);
            setAsset('play-reward' + i, r.icon);
        }
        setShown('play-rewards-bar-next-text', rewardsComplete && hasTimer);
        setShown('play-rewards-bar-next-icon', rewardsComplete && hasTimer && r.showClock);
        rewardsEndAt = rewardsComplete && hasTimer ? Date.now() + r.nextInSeconds * 1000 : null;
    }

    // ---------- live countdowns ----------
    function tick() {
        if (eventEndAt != null) setText('event-new-event-in', C.event.nextEventText.replace('{time}', fmtTime((eventEndAt - Date.now()) / 1000)));
        if (rewardsEndAt != null) setText('play-rewards-bar-next-text', C.play.rewards.nextText.replace('{time}', fmtTime((rewardsEndAt - Date.now()) / 1000)));
    }

    // ---------- resize: canvas + text fitting ----------
    function fitCanvas() {
        const cv = el('battler-render-canvas');
        if (!cv) return;
        const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
    }
    function onResize() { fitCanvas(); fitAll(); }

    // ---------- clicks ----------
    function run(action) {
        if (typeof action === 'function') return action();
        if (typeof action !== 'string') return;
        if (!Router.exists(action)) return console.warn(`[home] "${action}" is not a router page`);
        if (!document.getElementById(action + '-screen')) return console.warn(`[home] page "${action}" is not built yet`);
        Router.go(action);   // router validates allowedTransitions
    }
    function bindActions() {
        for (const [key, id] of Object.entries(ACTION_TARGETS)) {
            const e = el(id), a = C.actions[key];
            if (!e || !a) continue;
            const h = () => run(a);
            e.addEventListener('click', h);
            bound.push([e, h]);
        }
    }

    return {
        start() {
            running = true;
            applyConfig();
            tick();
            intervalId = setInterval(tick, 1000);
            bindActions();
            onResize();
            const root = document.getElementById('home-screen');
            if (root && typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(onResize);
                resizeObserver.observe(root);
            } else window.addEventListener('resize', onResize);
            // The custom font may finish loading after start → re-fit once it has.
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (running) fitAll(); });
        },
        stop() {
            running = false;
            clearInterval(intervalId);
            intervalId = null;
            if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
            window.removeEventListener('resize', onResize);
            for (const [e, h] of bound) e.removeEventListener('click', h);
            bound = [];
        }
    };
})());