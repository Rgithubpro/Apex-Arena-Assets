Router.register('settings', (() => {
    const DELETE_LABEL = 'Delete guest account';
    const DELETE_CONFIRM_LABEL = 'Tap again to delete forever';

    let backButton = null;
    let logoutButton = null;
    let deleteButton = null;
    let note = null;
    let armTimer = null;
    let armed = false;
    let busy = false;

    const goHome = () => Router.go('home');

    function disarm() {
        clearTimeout(armTimer);
        armed = false;
        if (deleteButton) deleteButton.textContent = DELETE_LABEL;
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

    async function onDelete() {
        if (busy) return;
        // First tap only arms the button, so a stray tap can't delete anything.
        if (!armed) {
            armed = true;
            deleteButton.textContent = DELETE_CONFIRM_LABEL;
            armTimer = setTimeout(disarm, 4000);
            return;
        }
        disarm();
        busy = true;
        note.textContent = '';
        try {
            await window.Auth.deleteAccount();
            location.reload();
        } catch (err) {
            note.textContent = err?.message || 'Could not delete the account. Please try again.';
            busy = false;
        }
    }

    return {
        start() {
            backButton = document.getElementById('settings-screen-back-button');
            logoutButton = document.getElementById('settings-screen-logout-button');
            deleteButton = document.getElementById('settings-screen-delete-button');
            note = document.getElementById('settings-screen-account-note');
            const nameEl = document.getElementById('settings-screen-account-name');

            backButton?.addEventListener('click', goHome);
            logoutButton?.addEventListener('click', onLogout);
            deleteButton?.addEventListener('click', onDelete);

            // Guests can only delete their account; everyone else can log out.
            const user = window.Auth?.user;
            if (nameEl) nameEl.textContent = user ? `${user.username}${user.is_guest ? ' (guest)' : ''}` : '';
            if (logoutButton) logoutButton.hidden = !user || user.is_guest;
            if (deleteButton) deleteButton.hidden = !user || !user.is_guest;
            if (note) note.textContent = '';
            busy = false;
            disarm();
        },
        stop() {
            backButton?.removeEventListener('click', goHome);
            logoutButton?.removeEventListener('click', onLogout);
            deleteButton?.removeEventListener('click', onDelete);
            disarm();
            backButton = logoutButton = deleteButton = note = null;
        },
    };
})());