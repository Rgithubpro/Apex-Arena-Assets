Router.register('profile', (() => {
    let backButton = null;
    let handleBack = null;

    return {
        start() {
            backButton = document.getElementById('profile-screen-back-button');
            if (!backButton) return;

            handleBack = () => Router.go('home');
            backButton.addEventListener('click', handleBack);
        },
        stop() {
            if (backButton && handleBack) {
                backButton.removeEventListener('click', handleBack);
            }
            backButton = null;
            handleBack = null;
        },
    };
})());
