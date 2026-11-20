/* ================================================================
   AUTH CLIENT — js/data/auth.js
   Talks to the Apex Arena auth server (Render).

   How tokens are kept safe in the browser:
   - A key pair is created once with WebCrypto and marked NON-EXTRACTABLE:
     scripts can ask the browser to sign with it, but nobody can read or
     copy the private key. It lives in IndexedDB.
   - Every request carries a small signed proof (DPoP) made with that key.
     A stolen token is useless on any other device.
   - The access token is kept in memory only. The refresh token sits in
     IndexedDB and is replaced on every use (rotation).
   - Guest accounts ARE this key: one browser key = one guest account.

   Bans / deletions: while the game is open it pings the server about once a
   minute (free for the database). If the account got banned or deleted on
   another device, this device logs out and shows the message.
================================================================= */

// ---- Set this to your auth server's address on Render ----
const PROD_AUTH_URL = 'https://apex-arena-auth-server.onrender.com';
const DEV_AUTH_URL = 'http://localhost:3001';

const AUTH_BASE_URL = PROD_AUTH_URL; //['localhost', '127.0.0.1'].includes(location.hostname) ? DEV_AUTH_URL : PROD_AUTH_URL;

const DB_NAME = 'apex-arena-auth';
const STORE_NAME = 'kv';
const WAKE_RETRY_MS = 2500;
const WAKE_MAX_RETRIES = 30; // Render's free tier can need up to ~a minute to wake up
const WATCH_INTERVAL_MS = 60_000;

// The server only accepts a proof stamped within about a minute of ITS clock.
//   false = strict: a wrong device clock is refused, with a clear message (what you asked for)
//   true  = the page quietly corrects for the difference instead
const AUTO_FIX_CLOCK = false;
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

// Local development only: js/data/dev-key.js (gitignored, never deployed; see dev-key.example.js) exports
// DEV_KEY. It is sent as X-Dev-Key and the auth server (if it has the same DEV_BYPASS_KEY) then skips the
// clock check for this machine. The deployed site never even looks for the file.
let devKeyPromise = null;
function getDevKey() {
    if (!IS_LOCAL) return Promise.resolve(null);
    devKeyPromise ??= import(new URL('./dev-key.js', import.meta.url).href).then((m) => m.DEV_KEY || null).catch(() => null);
    return devKeyPromise;
}
const PURPOSE_KEY = 'apex-auth-purpose'; // remembers "login" vs "reauth" across the provider redirect
const AFTER_REAUTH_KEY = 'apex-auth-after-reauth'; // what to do once the provider re-login succeeded ("delete")
const BANNED_KEY = 'apex-auth-banned'; // ban message handed to the next page load
const LAST_LOGIN_KEY = 'apex-last-login'; // which login button to badge as "Last used"

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AuthError extends Error {
    constructor(code, status, message, retryAfter) {
        super(message || code);
        this.code = code;
        this.status = status;
        this.retryAfter = retryAfter;
        this.publicReason = null; // set for account_banned: the reason the player may see
    }
}

/* ---------------- storage: IndexedDB, with an in-memory fallback ---------------- */
const memoryStore = new Map();
let persistent = true;

function openDb() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idb(mode, fn) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, mode);
            const req = fn(tx.objectStore(STORE_NAME));
            tx.oncomplete = () => resolve(req?.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

const store = {
    async get(key) {
        if (!persistent) return memoryStore.get(key);
        try { return await idb('readonly', (s) => s.get(key)); } catch (err) { console.warn('[auth] browser storage failed (read), using memory only:', err?.name, err?.message); persistent = false; return memoryStore.get(key); }
    },
    async set(key, value) {
        if (persistent) {
            try { await idb('readwrite', (s) => s.put(value, key)); return; } catch (err) { console.warn('[auth] browser storage failed (write), using memory only:', err?.name, err?.message); persistent = false; }
        }
        memoryStore.set(key, value);
    },
    async del(key) {
        memoryStore.delete(key);
        if (persistent) { try { await idb('readwrite', (s) => s.delete(key)); } catch { /* ignore */ } }
    },
};

const withLock = (name, fn) => (navigator.locks ? navigator.locks.request(name, fn) : fn());

/* ---------------- base64url + device key + DPoP proofs ---------------- */
function b64u(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64uText = (text) => b64u(enc.encode(text));
const sha256b64u = async (text) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));

let deviceKeyPromise = null;
function getDeviceKey() {
    deviceKeyPromise ??= withLock('apex-auth-key', async () => {
        const existing = await store.get('deviceKey');
        if (existing?.privateKey && existing?.publicJwk) return existing;

        // extractable:false -> the private key can never be read out of the browser.
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
        const record = { privateKey: pair.privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
        await store.set('deviceKey', record);
        return record;
    });
    return deviceKeyPromise;
}

let serverClockDiff = 0; // seconds the server's clock is ahead of this device's (negative: the device is ahead)
const clockCorrection = () => (AUTO_FIX_CLOCK && Math.abs(serverClockDiff) > 20 ? serverClockDiff : 0);

let clockSync = null;
/** Asks the server what time it is (once). Proofs are only accepted within about a minute of the server's clock. */
function ensureClock() {
    clockSync ??= fetch(`${AUTH_BASE_URL}/ping`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
        .then(noteServerClock)
        .catch(() => {}); // not reachable yet: the retry on invalid_dpop below covers it
    return clockSync;
}

async function makeProof(method, path, accessToken) {
    if (AUTO_FIX_CLOCK) await ensureClock();
    const { privateKey, publicJwk } = await getDeviceKey();
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk };
    const payload = {
        jti: crypto.randomUUID(),
        htm: method,
        htu: AUTH_BASE_URL + path,
        iat: Math.floor(Date.now() / 1000) + clockCorrection(),
    };
    if (accessToken) payload.ath = await sha256b64u(accessToken);

    const input = `${b64uText(JSON.stringify(header))}.${b64uText(JSON.stringify(payload))}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(input));
    return `${input}.${b64u(signature)}`;
}

/* ---------------- HTTP ---------------- */
function noteServerClock(res) {
    const date = res.headers.get('Date');
    if (!date) return;
    const diff = Math.round((Date.parse(date) - Date.now()) / 1000);
    serverClockDiff = diff;
}

async function request(method, path, { body, auth = false, proof = true, query } = {}) {
    const url = AUTH_BASE_URL + path + (query ? `?${new URLSearchParams(query)}` : '');
    let retriedProof = false;

    for (let attempt = 0; ; attempt++) {
        const headers = {};
        let token = null;
        if (auth) {
            token = await getAccessToken();
            headers.Authorization = `DPoP ${token}`;
        }
        if (proof) headers.DPoP = await makeProof(method, path, token);
        const devKey = await getDevKey();
        if (devKey) headers['X-Dev-Key'] = devKey;
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        let res = null;
        let text = '';
        try {
            res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
            text = await res.text();
        } catch {
            res = null;
        }

        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }

        // No answer, or a non-JSON 502/503/504: Render is still waking the server up. Wait and retry.
        const waking = !res || ([502, 503, 504].includes(res.status) && !data);
        if (waking) {
            if (attempt >= WAKE_MAX_RETRIES) throw new AuthError('server_unreachable', 0, 'Can\u2019t reach the server. Check your connection and try again.');
            window.dispatchEvent(new CustomEvent('auth:waking'));
            await sleep(WAKE_RETRY_MS);
            continue;
        }

        noteServerClock(res);
        if (!res.ok && AUTO_FIX_CLOCK && data?.error === 'invalid_dpop' && proof && !retriedProof) {
            retriedProof = true; // the clock was just corrected from this answer: sign again
            continue;
        }
        if (!res.ok) {
            const err = new AuthError(
                data?.error || 'request_failed',
                res.status,
                data?.message || 'Something went wrong. Please try again.',
                Number(res.headers.get('Retry-After')) || undefined,
            );
            err.publicReason = data?.public_reason ?? null;
            console.warn(`[auth] ${method} ${path} -> ${res.status} ${err.code}`);
            lastError = { code: err.code, status: err.status, message: err.message, path, clockDiff: serverClockDiff };
            // A banned player who is logged in on this device: sign out and show the message.
            if (data?.error === 'account_banned' && (auth || path === '/auth/refresh')) await onBanned(err.publicReason);
            throw err;
        }
        return data;
    }
}

/* ---------------- session ---------------- */
let session = null; // { accessToken, expiresAt, user }  (memory only)
let lastError = null; // the last failed request, for the notification popup
let refreshing = null;
let suppressBanReload = false; // true while init() runs: it reports the ban itself instead of reloading

async function setSession(tokens) {
    session = {
        accessToken: tokens.access_token,
        expiresAt: Date.now() + Math.max(30, tokens.expires_in - 60) * 1000,
        user: tokens.user,
    };
    await store.set('refresh', tokens.refresh_token);
    try { localStorage.setItem(LAST_LOGIN_KEY, tokens.user.method); } catch { /* storage blocked: no badge */ }
    navigator.storage?.persist?.().catch(() => {}); // asks the browser not to evict our storage
    startWatch();
}

async function refreshSession() {
    return withLock('apex-auth-refresh', async () => {
        // Another call may have refreshed while we waited for the lock.
        if (session && Date.now() < session.expiresAt) return session;

        const refreshToken = await store.get('refresh');
        if (!refreshToken) {
            session = null;
            throw new AuthError('not_logged_in', 401, 'Please log in');
        }
        try {
            await setSession(await request('POST', '/auth/refresh', { body: { refresh_token: refreshToken } }));
            return session;
        } catch (err) {
            // Only a definite "this login is no longer valid" removes the saved login. Anything else
            // (a bad proof, rate limit, hiccup) keeps it, so the next page load can try again.
            if (err.code === 'invalid_grant' || err.code === 'account_banned') {
                await store.del('refresh');
                session = null;
            }
            throw err;
        }
    });
}

async function getAccessToken() {
    if (session && Date.now() < session.expiresAt) return session.accessToken;
    refreshing ??= refreshSession().finally(() => { refreshing = null; });
    return (await refreshing).accessToken;
}

function routeFor(user) {
    if (!user.username) return { route: 'username', user };
    if (!user.tos_accepted) return { route: 'terms', user };
    return { route: 'home', user };
}

/* ---------------- ban / deletion watch ---------------- */
let watchTimer = null;

function stopWatch() {
    clearInterval(watchTimer);
    watchTimer = null;
}

/** Banned: forget the login, remember the message for the next load, and restart the app. */
async function onBanned(publicReason) {
    stopWatch();
    session = null;
    await store.del('refresh');
    if (suppressBanReload) return;
    sessionStorage.setItem(BANNED_KEY, JSON.stringify({ reason: publicReason ?? null }));
    location.reload();
}

/** The account was deleted elsewhere, or the session was ended: back to the start. */
async function onSessionEnded() {
    stopWatch();
    session = null;
    await store.del('refresh');
    location.reload();
}

function startWatch() {
    if (watchTimer) return;
    const tick = async () => {
        if (!session || document.hidden) return;
        try {
            await request('GET', '/me/status', { auth: true });
        } catch (err) {
            // account_banned is already handled inside request(); network errors are ignored (try again next minute)
            if (['account_deleted', 'not_logged_in', 'invalid_grant'].includes(err.code)) await onSessionEnded();
        }
    };
    watchTimer = setInterval(tick, WATCH_INTERVAL_MS);
    watchTimer?.unref?.();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

/* ---------------- startup ---------------- */
async function initInner() {
    // A ban message waiting from the previous page load.
    const pendingBan = sessionStorage.getItem(BANNED_KEY);
    if (pendingBan) {
        sessionStorage.removeItem(BANNED_KEY);
        let reason = null;
        try { reason = JSON.parse(pendingBan).reason ?? null; } catch { /* ignore */ }
        return { route: 'banned', reason };
    }

    // Coming back from Google / Microsoft / Discord?
    const hash = new URLSearchParams(location.hash.slice(1));
    let reauthFailed = null;
    if (hash.has('auth_code') || hash.has('auth_error')) {
        const code = hash.get('auth_code');
        const error = hash.get('auth_error');
        history.replaceState(null, '', location.pathname + location.search); // keep the code out of the address bar
        const purpose = sessionStorage.getItem(PURPOSE_KEY);
        const afterReauth = sessionStorage.getItem(AFTER_REAUTH_KEY);
        sessionStorage.removeItem(PURPOSE_KEY);
        sessionStorage.removeItem(AFTER_REAUTH_KEY);

        if (purpose !== 'reauth') {
            if (error || !code) return { route: 'welcome', error: error || 'provider_error' };
            try {
                const tokens = await request('POST', '/auth/oauth/exchange', { body: { code } });
                await setSession(tokens);
                return { ...routeFor(tokens.user), isNew: !!tokens.is_new };
            } catch (err) {
                if (err.code === 'account_banned') return { route: 'banned', reason: err.publicReason };
                return { route: 'welcome', error: err.code };
            }
        }

        // Re-verification (e.g. before deleting the account). Cancelled or failed -> carry on as before.
        if (error || !code) {
            reauthFailed = error || 'provider_error';
        } else {
            try {
                await getAccessToken();
                await request('POST', '/auth/oauth/exchange', { auth: true, body: { code } });
                if (afterReauth === 'delete') {
                    await Auth.deleteAccount();
                    return { route: 'welcome', deleted: true };
                }
            } catch (err) {
                if (err.code === 'account_banned') return { route: 'banned', reason: err.publicReason };
                reauthFailed = err.code;
            }
        }
    }

    // A saved login?
    if (await store.get('refresh')) {
        try {
            await getAccessToken();
            return { ...routeFor(session.user), ...(reauthFailed ? { reauthFailed } : {}) };
        } catch (err) {
            if (err.code === 'account_banned') return { route: 'banned', reason: err.publicReason };
            return { route: 'welcome', error: err.code };
        }
    }
    return { route: 'welcome' };
}

/* ---------------- public API ---------------- */
export const Auth = {
    AuthError,

    get user() { return session?.user ?? null; },
    get isLoggedIn() { return !!session; },
    get storagePersistent() { return persistent; },

    /** Wakes the (possibly sleeping) Render server while other things load. */
    warmUp() {
        ensureClock(); // wakes the server and syncs the clock
    },

    /**
     * Call once at startup. Finishes a provider login if we just came back from
     * Google/Microsoft/Discord, otherwise restores a saved session.
     * Returns { route: 'home' | 'welcome' | 'username' | 'terms' | 'banned', user?, error?, reason?, deleted? }
     */
    async init() {
        suppressBanReload = true;
        try {
            const result = await initInner();
            if (result.error) {
                result.errorDetail = lastError;
                console.warn('[auth] could not restore the login:', result.error);
            }
            return result;
        } finally {
            suppressBanReload = false;
        }
    },

    routeFor,

    /** For troubleshooting: run `await Auth.debug()` in the browser console. */
    async debug() {
        return {
            authServer: AUTH_BASE_URL,
            storagePersistent: persistent,
            hasDeviceKey: !!(await store.get('deviceKey')),
            hasRefreshToken: !!(await store.get('refresh')),
            loggedIn: !!session,
        };
    },

    /** Plain-language { title, text } for a failed login restore (shown in the notification popup). */
    describeProblem({ error, errorDetail } = {}) {
        let text;
        if (error === 'invalid_dpop') {
            const diff = errorDetail?.clockDiff ?? 0;
            const size = Math.abs(diff) >= 90 ? `${Math.round(Math.abs(diff) / 60)} minutes` : `${Math.abs(diff)} seconds`;
            text = Math.abs(diff) > 20
                ? `The clock of this device is about ${size} ${diff < 0 ? 'ahead of' : 'behind'} the server, so the login was refused. Set the time to automatic and reload.`
                : 'The server refused the proof that goes with the login.';
        } else if (error === 'invalid_grant') {
            text = 'Your saved login has ended or expired. Please log in again.';
        } else if (error === 'invalid_code') {
            text = 'The login link has expired. Please try again.';
        } else if (error === 'provider_error') {
            text = 'The login provider reported a problem. Please try again.';
        } else if (error === 'server_unreachable') {
            text = 'The server cannot be reached. Check your connection and try again.';
        } else {
            text = `Could not log you in.${errorDetail?.message ? ` Server says: ${errorDetail.message}` : ''}`;
        }
        return { title: 'Login failed', text: `${text} (${error})` };
    },

    /** 'google', 'email', 'guest', ... or null: the method used on this device last time. */
    lastLoginMethod() {
        try {
            const method = localStorage.getItem(LAST_LOGIN_KEY);
            return /^[a-z]{3,20}$/.test(method || '') ? method : null;
        } catch {
            return null;
        }
    },

    /** Instant, free random preview shown on the guest screen ("Guest123456"). */
    previewGuestName() {
        const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
        return `Guest${String(n).padStart(6, '0')}`;
    },

    async checkUsername(username) {
        return request('GET', '/auth/check', { query: { username }, proof: false });
    },
    async checkEmail(email) {
        return request('GET', '/auth/check', { query: { email }, proof: false });
    },
    async providers() {
        return (await request('GET', '/auth/providers', { proof: false })).providers;
    },

    async signupEmail({ username, email, password }) {
        const tokens = await request('POST', '/auth/signup', { body: { username, email, password } });
        await setSession(tokens);
        return tokens.user;
    },
    async loginEmail({ email, password }) {
        const tokens = await request('POST', '/auth/login', { body: { email, password } });
        await setSession(tokens);
        return tokens.user;
    },

    /** Guest = this browser's key. Needs storage that survives a reload. */
    async guest(usernameHint) {
        await getDeviceKey();
        if (!persistent) throw new AuthError('storage_unavailable', 0, 'Guest accounts need browser storage, which is turned off here.');
        const tokens = await request('POST', '/auth/guest', { body: { username_hint: usernameHint } });
        await setSession(tokens);
        return tokens.user;
    },

    /** Leaves the page: the provider sends the player back with #auth_code=... */
    async startOAuth(provider, purpose = 'login') {
        sessionStorage.setItem(PURPOSE_KEY, purpose);
        try {
            const { url } = await request('POST', `/auth/oauth/${provider}/prepare`, {
                auth: purpose === 'reauth',
                body: { return_to: location.origin + location.pathname, purpose },
            });
            location.assign(url);
        } catch (err) {
            sessionStorage.removeItem(PURPOSE_KEY);
            throw err;
        }
    },

    async setUsername(username) {
        const res = await request('POST', '/me/username', { auth: true, body: { username } });
        session.user = res.user;
        session.accessToken = res.access_token;
        session.expiresAt = Date.now() + Math.max(30, res.expires_in - 60) * 1000;
        return res.user;
    },
    async acceptTerms() {
        const res = await request('POST', '/me/terms', { auth: true, body: {} });
        session.user = res.user;
        return res.user;
    },

    async changePassword(currentPassword, newPassword) {
        await request('POST', '/me/password', { auth: true, body: { current_password: currentPassword, new_password: newPassword } });
    },
    async logoutEverywhere() {
        await request('POST', '/me/logout-all', { auth: true, body: {} });
        await this.logout();
    },

    /**
     * Deletes the account and everything stored for it on the server.
     * E-mail accounts pass { password }; guests need nothing; Google/Microsoft/Discord
     * accounts use requestDeleteViaProvider() instead (they must log in with the provider again).
     */
    async deleteAccount({ password } = {}) {
        await request('DELETE', '/me', { auth: true, body: { password } });
        stopWatch();
        await store.del('refresh');
        session = null;
    },

    /** Provider accounts: sends the player to Google/Microsoft/Discord to confirm; init() finishes the deletion on return. */
    async requestDeleteViaProvider() {
        const user = session?.user;
        if (!user || user.is_guest || user.method === 'email') {
            throw new AuthError('not_provider_account', 400, 'This account does not use a Google, Microsoft or Discord login.');
        }
        sessionStorage.setItem(AFTER_REAUTH_KEY, 'delete');
        try {
            await Auth.startOAuth(user.method, 'reauth');
        } catch (err) {
            sessionStorage.removeItem(AFTER_REAUTH_KEY);
            throw err;
        }
    },

    /** Heartbeat call (also made automatically once a minute while the game is open). */
    async checkStatus() {
        return request('GET', '/me/status', { auth: true });
    },

    /** Single-use ticket (valid ~30 s) to hand to the game server when joining a match. */
    async getJoinTicket() {
        return request('POST', '/game/ticket', { auth: true, body: {} });
    },

    /** Keeps the device key, so a guest can come back as the same guest. */
    async logout() {
        const refreshToken = await store.get('refresh');
        stopWatch();
        session = null;
        await store.del('refresh');
        if (refreshToken) request('POST', '/auth/logout', { body: { refresh_token: refreshToken }, proof: false }).catch(() => {});
    },
};

window.Auth = Auth;
Auth.warmUp();