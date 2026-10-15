Router.register('friends', (() => {
    let buttons = [];
    const bindRoutes = () => {
        buttons = [...document.querySelectorAll('#friends-screen [data-route]')].map((button) => {
            const handler = () => Router.go(button.dataset.route);
            button.addEventListener('click', handler);
            return [button, handler];
        });
    };

    return {
        start: bindRoutes,
        stop() {
            for (const [button, handler] of buttons) button.removeEventListener('click', handler);
            buttons = [];
        },
    };
})());
