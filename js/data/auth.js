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
================================================================= */

// ---- Set this to your auth server's address on Render ----
const PROD_AUTH_URL = 'https://apex-arena-auth-server.onrender.com';
const DEV_AUTH_URL = 'http://localhost:5002';

// Enable when actually having a dev server locally...
//const AUTH_BASE_URL = ['localhost', '127.0.0.1'].includes(location.hostname) ? DEV_AUTH_URL : PROD_AUTH_URL;
const AUTH_BASE_URL = PROD_AUTH_URL;

const DB_NAME = 'apex-arena-auth';
const STORE_NAME = 'kv';
const WAKE_RETRY_MS = 2500;
const WAKE_MAX_RETRIES = 30; // Render's free tier can need up to ~a minute to wake up
const PURPOSE_KEY = 'apex-auth-purpose'; // remembers "login" vs "reauth" across the provider redirect

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AuthError extends Error {
    constructor(code, status, message, retryAfter) {
        super(message || code);
        this.code = code;
        this.status = status;
        this.retryAfter = retryAfter;
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
        try { return await idb('readonly', (s) => s.get(key)); } catch { persistent = false; return memoryStore.get(key); }
    },
    async set(key, value) {
        if (persistent) {
            try { await idb('readwrite', (s) => s.put(value, key)); return; } catch { persistent = false; }
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

let clockSkewSeconds = 0; // corrected from the server's Date header

async function makeProof(method, path, accessToken) {
    const { privateKey, publicJwk } = await getDeviceKey();
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk };
    const payload = {
        jti: crypto.randomUUID(),
        htm: method,
        htu: AUTH_BASE_URL + path,
        iat: Math.floor(Date.now() / 1000) + clockSkewSeconds,
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
    clockSkewSeconds = Math.abs(diff) > 20 ? diff : 0;
}

async function request(method, path, { body, auth = false, proof = true, query } = {}) {
    const url = AUTH_BASE_URL + path + (query ? `?${new URLSearchParams(query)}` : '');

    for (let attempt = 0; ; attempt++) {
        const headers = {};
        let token = null;
        if (auth) {
            token = await getAccessToken();
            headers.Authorization = `DPoP ${token}`;
        }
        if (proof) headers.DPoP = await makeProof(method, path, token);
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
        if (!res.ok) {
            throw new AuthError(
                data?.error || 'request_failed',
                res.status,
                data?.message || 'Something went wrong. Please try again.',
                Number(res.headers.get('Retry-After')) || undefined,
            );
        }
        return data;
    }
}

/* ---------------- session ---------------- */
let session = null; // { accessToken, expiresAt, user }  (memory only)
let refreshing = null;

async function setSession(tokens) {
    session = {
        accessToken: tokens.access_token,
        expiresAt: Date.now() + Math.max(30, tokens.expires_in - 60) * 1000,
        user: tokens.user,
    };
    await store.set('refresh', tokens.refresh_token);
    navigator.storage?.persist?.().catch(() => {}); // asks the browser not to evict our storage
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
            if (err.status === 401 || err.status === 403) {
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

/* ---------------- public API ---------------- */
export const Auth = {
    AuthError,

    get user() { return session?.user ?? null; },
    get isLoggedIn() { return !!session; },
    get storagePersistent() { return persistent; },

    /** Wakes the (possibly sleeping) Render server while other things load. */
    warmUp() {
        fetch(`${AUTH_BASE_URL}/ping`, { cache: 'no-store' }).catch(() => {});
    },

    /**
     * Call once at startup. Finishes a provider login if we just came back from
     * Google/Microsoft/Discord, otherwise restores a saved session.
     * Returns { route: 'home' | 'welcome' | 'username' | 'terms', user?, error? }
     */
    async init() {
        const hash = new URLSearchParams(location.hash.slice(1));
        if (hash.has('auth_code') || hash.has('auth_error')) {
            const code = hash.get('auth_code');
            const error = hash.get('auth_error');
            history.replaceState(null, '', location.pathname + location.search); // keep the code out of the address bar
            const purpose = sessionStorage.getItem(PURPOSE_KEY);
            sessionStorage.removeItem(PURPOSE_KEY);

            if (error || !code) return { route: 'welcome', error: error || 'provider_error' };
            try {
                if (purpose === 'reauth') {
                    await getAccessToken();
                    await request('POST', '/auth/oauth/exchange', { auth: true, body: { code } });
                    return { ...routeFor(session.user), reauth: true };
                }
                const tokens = await request('POST', '/auth/oauth/exchange', { body: { code } });
                await setSession(tokens);
                return { ...routeFor(tokens.user), isNew: !!tokens.is_new };
            } catch (err) {
                return { route: 'welcome', error: err.code };
            }
        }

        if (await store.get('refresh')) {
            try {
                await getAccessToken();
                return routeFor(session.user);
            } catch (err) {
                return { route: 'welcome', error: err.code };
            }
        }
        return { route: 'welcome' };
    },

    routeFor,

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
    /** E-mail accounts pass { password }; Google/Microsoft/Discord accounts call startOAuth(provider, 'reauth') first. */
    async deleteAccount({ password } = {}) {
        await request('DELETE', '/me', { auth: true, body: { password } });
        await store.del('refresh');
        session = null;
    },

    /** Single-use ticket (valid ~30 s) to hand to the game server when joining a match. */
    async getJoinTicket() {
        return request('POST', '/game/ticket', { auth: true, body: {} });
    },

    /** Keeps the device key, so a guest can come back as the same guest. */
    async logout() {
        const refreshToken = await store.get('refresh');
        session = null;
        await store.del('refresh');
        if (refreshToken) request('POST', '/auth/logout', { body: { refresh_token: refreshToken }, proof: false }).catch(() => {});
    },
};

window.Auth = Auth;
Auth.warmUp();
