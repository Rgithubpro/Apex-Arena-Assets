Router.register('shop', (() => {
    let backButton = null;
    const goHome = () => Router.go('home');

    return {
        start() {
            backButton = document.getElementById('shop-screen-back-button');
            backButton?.addEventListener('click', goHome);
        },
        stop() {
            backButton?.removeEventListener('click', goHome);
            backButton = null;
        },
    };
})());
