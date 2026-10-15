Router.register('club', (() => {
    let backButton = null;
    const goHome = () => Router.go('home');

    return {
        start() {
            backButton = document.getElementById('club-screen-back-button');
            backButton?.addEventListener('click', goHome);
        },
        stop() {
            backButton?.removeEventListener('click', goHome);
            backButton = null;
        },
    };
})());
