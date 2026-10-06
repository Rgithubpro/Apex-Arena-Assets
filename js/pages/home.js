/* ================================================================
   HOME SCREEN — page = 'home'
================================================================= */
const HOME_CONFIG = {
    numberFormat: 'plain',          // 'plain' → 5291   |  'separators' → 5,291

    // ---------- TOP ----------
    player: {
        enabled: true,
        username: 'Player',
        usernameColor: '#ff4fd8',
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
        notification: { enabled: false, count: 2 },      // red badge (see 2nd reference image)
    },

    // ---------- LEFT ----------
    shop: {
        enabled: true,
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
        render: { enabled: true },                       // the <canvas>; it is kept sized to its box (dpr-aware)
    },

    // ---------- BOTTOM ----------
    battlepass: {
        enabled: true,
        icon: 'assets/icons/general/battlepass-normal.png',
        xp: 421,
        xpGoal: 950,
        nextReward: { enabled: true, icon: 'assets/icons/general/stardrop.png', name: 'Star Drop' },
    },
    quests: {
        enabled: true,
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
            total: 6,                                    // 1–6 (HTML has 6 slots)
            progress: 3.4,                               // in rewards; 3.4 = 3 reached + 40% into the 4th
            nextInSeconds: 19380,                        // null hides the timer text, counts down live
            nextText: 'Next rewards {time}',
            showClock: true,
        },
    },

    // ---------- CLICK ACTIONS ----------
    // value = a page name (→ Router.go(name)) or a function. null = nothing happens.
    actions: {
        profile: null, trophyRoad: null, gems: null, coins: null, powerpoints: null, crystals: null,
        settings: null, shop: null, battlers: null, unlockBattler: null,
        news: null, friends: null, club: null, teamChat: null,
        powerLevel: null, upgrades: null, skins: null,
        battlepass: null, quests: null, streak: null, event: null,
        play: () => console.log('[home] play pressed'),
    },
};

Router.register('home', (() => {
    const C = HOME_CONFIG;
    const ACTION_TARGETS = {
        profile: 'profile', trophyRoad: 'trophieroad', gems: 'currencies-gems', coins: 'currencies-coins',
        powerpoints: 'currencies-powerpoints', crystals: 'currencies-crystals', settings: 'settings',
        shop: 'shop', battlers: 'battlers', unlockBattler: 'unlock-brawler', news: 'news', friends: 'friends',
        club: 'club', teamChat: 'team-chat', powerLevel: 'battler-power-level', upgrades: 'battler-upgrades',
        skins: 'battler-skins', battlepass: 'battlepass', quests: 'quests', streak: 'streak',
        event: 'event', play: 'play',
    };

    let intervalId = null;
    let resizeObserver = null;
    let assetsDirty = false;
    let eventEndAt = null;
    let rewardsEndAt = null;
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

    // ---------- apply config → DOM ----------
    function applyConfig() {
        assetsDirty = false;
        const c = C;

        // Top
        if (setShown('profile', c.player.enabled)) {
            setText('profile-username', c.player.username);
            el('profile').parentElement.parentElement.style.setProperty('--hs-username-color', c.player.usernameColor);
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
        if (setShown('shop', c.shop.enabled)) setFlag('shop-flag', c.shop.flag);
        if (setShown('battlers', c.battlers.enabled)) setBadge('battlers-notification', c.battlers.notification);
        const ub = c.unlockBattler;
        if (setShown('unlock-brawler', ub.enabled)) {
            setAsset('unlock-brawler-icon', ub.icon);
            setText('unlock-brawler-text', `${fmtNum(ub.current)}/${fmtNum(ub.goal)}`);
            setFill('unlock-brawler-bar-fill', ub.current / ub.goal);
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
            setAsset('battlepass-icon', bp.icon);
            setText('battlepass-progressbar-text', `${fmtNum(bp.xp)}/${fmtNum(bp.xpGoal)}`);
            setFill('battlepass-progressbar-fill', bp.xp / bp.xpGoal);
            if (setShown('battlepass-next-reward', bp.nextReward.enabled)) {
                setAsset('battlepass-next-reward', bp.nextReward.icon);
                setAlt('battlepass-next-reward', `Next reward = ${bp.nextReward.name}`);
            }
        }
        if (setShown('quests', c.quests.enabled)) setFlag('quests-flag', c.quests.flag);
        if (setShown('streak', c.streak.enabled)) {
            setAsset('streak-icon', c.streak.icon);
            setText('streak-text', c.streak.count);
        }
        const ev = c.event;
        if (setShown('event', ev.enabled)) {
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
    }

    function applyRewards(r) {
        const total = Math.min(6, Math.max(1, Math.floor(r.total) || 1));
        const play = el('play');
        play.style.setProperty('--n', total);
        setShown('play-rewards-bar', r.enabled);
        setShown('play-rewards-bar-next-icon', r.enabled && r.showClock);
        setFill('play-rewards-bar-fill', r.progress / total);
        for (let i = 1; i <= 6; i++) {
            const seg = el('play-rewards-bar-segment' + i), icon = el('play-reward' + i);
            seg.style.setProperty('--k', i);
            icon.style.setProperty('--k', i);
            seg.hidden = !(r.enabled && i < total);          // dividers only between slots
            icon.hidden = !(r.enabled && i <= total);
            icon.classList.toggle('is-reached', i <= Math.floor(r.progress));
            setAsset('play-reward' + i, r.icon);
        }
        setShown('play-rewards-bar-next-text', r.enabled && r.nextInSeconds != null);
        rewardsEndAt = r.enabled && r.nextInSeconds != null ? Date.now() + r.nextInSeconds * 1000 : null;
    }

    // ---------- live countdowns ----------
    function tick() {
        if (eventEndAt != null) setText('event-new-event-in', C.event.nextEventText.replace('{time}', fmtTime((eventEndAt - Date.now()) / 1000)));
        if (rewardsEndAt != null) setText('play-rewards-bar-next-text', C.play.rewards.nextText.replace('{time}', fmtTime((rewardsEndAt - Date.now()) / 1000)));
    }

    // ---------- canvas ----------
    function fitCanvas() {
        const cv = el('battler-render-canvas');
        if (!cv) return;
        const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
    }

    // ---------- clicks ----------
    function run(action) {
        if (typeof action === 'function') action();
        else if (typeof action === 'string') Router.go(action);
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
            applyConfig();
            tick();
            intervalId = setInterval(tick, 1000);
            bindActions();
            fitCanvas();
            const box = el('battler-render');
            if (box && typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(fitCanvas);
                resizeObserver.observe(box);
            } else window.addEventListener('resize', fitCanvas);
        },
        stop() {
            clearInterval(intervalId);
            intervalId = null;
            if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
            window.removeEventListener('resize', fitCanvas);
            for (const [e, h] of bound) e.removeEventListener('click', h);
            bound = [];
        }
    };
})());