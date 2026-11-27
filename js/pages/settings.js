Router.register('settings', (() => {
    const PROVIDER_NAMES = { google: 'Google', microsoft: 'Microsoft', discord: 'Discord' };

    let backButton = null;
    let logoutButton = null;
    let adminButton = null;
    let deleteButton = null;
    let passwordInput = null;
    let note = null;
    let deleteLabel = 'Delete account';
    let armTimer = null;
    let armed = false;
    let busy = false;

    const goHome = () => Router.go('home');
    const goAdmin = () => Router.go('admin');

    function disarm() {
        clearTimeout(armTimer);
        armed = false;
        if (deleteButton) deleteButton.textContent = deleteLabel;
        if (passwordInput) {
            passwordInput.hidden = true;
            passwordInput.value = '';
        }
    }

    async function onLogout() {
        if (busy) return;
        busy = true;
        note.textContent = '';
        try {
            await window.Auth.logout();
            location.reload(); // starts clean: loading -> welcome
        } catch (err) {
            note.textContent = err?.message || 'Could not log out. Please try again.';
            busy = false;
        }
    }

    // Deleting removes the account and everything stored for it on the server.
    //   guest            -> tap twice
    //   e-mail account   -> tap, type the password, tap again
    //   Google/Microsoft/Discord -> tap twice, then log in with that provider again to confirm
    async function onDelete() {
        const user = window.Auth?.user;
        if (busy || !user) return;

        if (!armed) {
            armed = true;
            note.textContent = '';
            if (user.method === 'email') {
                passwordInput.hidden = false;
                passwordInput.focus();
                deleteButton.textContent = 'Tap again to delete forever';
                armTimer = setTimeout(disarm, 60000); // time to type the password
            } else if (user.method === 'guest') {
                deleteButton.textContent = 'Tap again to delete forever';
                armTimer = setTimeout(disarm, 4000);
            } else {
                deleteButton.textContent = `Tap again, then log in with ${PROVIDER_NAMES[user.method] || user.method}`;
                armTimer = setTimeout(disarm, 4000);
            }
            return;
        }

        if (user.method === 'email' && !passwordInput.value) {
            note.textContent = 'Enter your password first.';
            return;
        }

        busy = true;
        note.textContent = '';
        try {
            if (user.method === 'email' || user.method === 'guest') {
                await window.Auth.deleteAccount({ password: passwordInput.value });
                location.reload();
            } else {
                await window.Auth.requestDeleteViaProvider(); // leaves the page; deletion finishes when we come back
            }
        } catch (err) {
            note.textContent = err?.message || 'Could not delete the account. Please try again.';
            busy = false;
        }
    }

    return {
        start() {
            backButton = document.getElementById('settings-screen-back-button');
            logoutButton = document.getElementById('settings-screen-logout-button');
            adminButton = document.getElementById('settings-screen-admin-button');
            deleteButton = document.getElementById('settings-screen-delete-button');
            passwordInput = document.getElementById('settings-screen-delete-password');
            note = document.getElementById('settings-screen-account-note');
            const nameEl = document.getElementById('settings-screen-account-name');

            backButton?.addEventListener('click', goHome);
            logoutButton?.addEventListener('click', onLogout);
            deleteButton?.addEventListener('click', onDelete);
            adminButton?.addEventListener('click', goAdmin);

            // Everyone can log out (a guest account stays on this device) and everyone can delete their account.
            const user = window.Auth?.user;
            deleteLabel = user?.is_guest ? 'Delete guest account' : 'Delete account';
            if (nameEl) nameEl.textContent = user ? `${user.username}${user.is_guest ? ' (guest)' : ''}` : '';
            if (logoutButton) {
                logoutButton.hidden = !user;
                logoutButton.textContent = user?.is_guest ? 'Log out (keeps this guest account)' : 'Log out';
            }
            if (adminButton) adminButton.hidden = !user || !user.role || user.role === 'player'; // staff only
            if (deleteButton) deleteButton.hidden = !user;
            if (note) note.textContent = '';
            busy = false;
            disarm();
        },
        stop() {
            backButton?.removeEventListener('click', goHome);
            logoutButton?.removeEventListener('click', onLogout);
            deleteButton?.removeEventListener('click', onDelete);
            adminButton?.removeEventListener('click', goAdmin);
            disarm();
            backButton = logoutButton = adminButton = deleteButton = passwordInput = note = null;
        },
    };
})());