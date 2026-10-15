Router.register('news', (() => {
    let backButton = null;
    const goHome = () => Router.go('home');

    return {
        start() {
            backButton = document.getElementById('news-screen-back-button');
            backButton?.addEventListener('click', goHome);
        },
        stop() {
            backButton?.removeEventListener('click', goHome);
            backButton = null;
        },
    };
})());
