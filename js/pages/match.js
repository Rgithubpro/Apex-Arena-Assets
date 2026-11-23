Router.register('match', (() => {
    const SERVER_URL = 'wss://apex-arena-server-gxca.onrender.com';
    const ROOM_TYPE = 'test_room';
    const COLYSEUS_URL = 'https://cdn.jsdelivr.net/npm/colyseus.js@0.16.22/dist/colyseus.js';
    const ARENA_WIDTH = 800;
    const ARENA_HEIGHT = 600;

    let screen;
    let client;
    let room;
    let busy = false;
    let pageActive = false;
    let pageListeners;
    let connectionAttempt = 0;
    let inputTimer = null;
    let pingTimer = null;
    let animationFrame = null;
    let pingSentAt = 0;
    let sequence = 0;
    let inputX = 0;
    let inputY = 0;
    let joystickPointer = null;
    let keysDown = new Set();
    const meleeSwings = new Map();
    let clientLoadPromise = null;
    let elements = {};

    const playerName = () => window.Auth?.user?.username?.trim() || '';
    const setStatus = (message, state = '') => {
        elements.status.textContent = message;
        elements.status.dataset.state = state;
    };
    const setLobbyMessage = (message) => { elements.lobbyMessage.textContent = message; };
    const setBusy = (value) => {
        busy = value;
        for (const id of ['createRoom', 'quickJoin']) elements[id].disabled = value;
        elements.joinCode.disabled = value;
        elements.joinSubmit.disabled = value;
    };

    function loadColyseus() {
        if (window.Colyseus) return Promise.resolve(window.Colyseus);
        if (clientLoadPromise) return clientLoadPromise;

        clientLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = COLYSEUS_URL;
            script.async = true;
            script.onload = () => {
                if (window.Colyseus) resolve(window.Colyseus);
                else reject(new Error('The Colyseus client loaded without its browser API.'));
            };
            script.onerror = () => reject(new Error('Could not load the multiplayer client library.'));
            document.head.appendChild(script);
        });
        return clientLoadPromise;
    }

    async function getClient() {
        const Colyseus = await loadColyseus();
        client ??= new Colyseus.Client(SERVER_URL);
        return client;
    }

    function roomCode(roomId) {
        return String(roomId || '').trim();
    }

    async function enterMatch(join) {
        if (busy) return;
        if (!playerName()) {
            setLobbyMessage('Sign in first. Matches use your account username as your player name.');
            return;
        }

        setBusy(true);
        setStatus('Joining the arena…');
        setLobbyMessage('Connecting to the match server…');
        const attempt = ++connectionAttempt;
        try {
            const gameClient = await getClient();
            const joinedRoom = await join(gameClient, playerName());
            if (!pageActive || attempt !== connectionAttempt) {
                await joinedRoom.leave();
                return;
            }
            installRoom(joinedRoom);
        } catch (error) {
            if (pageActive && attempt === connectionAttempt) {
                setStatus('Could not join match', 'error');
                setLobbyMessage(error.message || 'The room could not be joined. Check the code and try again.');
            }
        } finally {
            if (pageActive && attempt === connectionAttempt) setBusy(false);
        }
    }

    function createRoom() {
        return enterMatch((gameClient, name) => gameClient.create(ROOM_TYPE, { name }));
    }

    function quickJoin() {
        return enterMatch((gameClient, name) => gameClient.joinOrCreate(ROOM_TYPE, { name }));
    }

    function joinRoomById(id) {
        const code = roomCode(id);
        if (!code) {
            setLobbyMessage('Enter a room code to join a friend.');
            return Promise.resolve();
        }
        return enterMatch((gameClient, name) => gameClient.joinById(code, { name }));
    }

    function drawArena() {
        if (!pageActive || !room?.state) {
            animationFrame = requestAnimationFrame(drawArena);
            return;
        }

        const canvas = elements.arena;
        const context = canvas.getContext('2d');
        const state = room.state;
        context.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
        context.fillStyle = '#111e2c';
        context.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

        context.strokeStyle = 'rgba(147, 191, 220, 0.08)';
        context.lineWidth = 1;
        for (let x = 0; x <= ARENA_WIDTH; x += 40) {
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, ARENA_HEIGHT);
            context.stroke();
        }
        for (let y = 0; y <= ARENA_HEIGHT; y += 40) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(ARENA_WIDTH, y);
            context.stroke();
        }

        state.obstacles?.forEach?.((obstacle) => {
            context.fillStyle = '#34485b';
            context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
            context.strokeStyle = '#59748c';
            context.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        });

        state.projectiles?.forEach?.((projectile) => {
            context.beginPath();
            context.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
            context.fillStyle = '#ffc857';
            context.shadowColor = '#ffc857';
            context.shadowBlur = 9;
            context.fill();
            context.shadowBlur = 0;
        });

        state.players?.forEach?.((player, sessionId) => drawPlayer(context, player, sessionId));
        const now = performance.now();
        for (const [sessionId, startedAt] of meleeSwings) {
            const player = state.players.get(sessionId);
            const elapsed = now - startedAt;
            if (!player || elapsed >= 220) {
                meleeSwings.delete(sessionId);
                continue;
            }
            const angle = Math.atan2(player.facingY, player.facingX);
            const alpha = 1 - elapsed / 220;
            context.beginPath();
            context.moveTo(player.x, player.y);
            context.arc(player.x, player.y, 52, angle - 0.9, angle + 0.9);
            context.closePath();
            context.fillStyle = `rgba(191, 129, 255, ${alpha * 0.28})`;
            context.fill();
            context.strokeStyle = `rgba(222, 190, 255, ${alpha})`;
            context.lineWidth = 3;
            context.stroke();
        }
        animationFrame = requestAnimationFrame(drawArena);
    }

    function drawPlayer(context, player, sessionId) {
        const isSelf = sessionId === room.sessionId;
        const radius = player.radius || 16;
        context.globalAlpha = player.alive ? (player.connected ? 1 : 0.5) : 0.28;
        context.beginPath();
        context.arc(player.x, player.y, radius, 0, Math.PI * 2);
        context.fillStyle = player.color || '#ffffff';
        context.fill();
        context.lineWidth = isSelf ? 3 : 2;
        context.strokeStyle = isSelf ? '#ffffff' : 'rgba(255,255,255,0.75)';
        context.stroke();
        context.globalAlpha = 1;

        if (player.alive) {
            context.beginPath();
            context.moveTo(player.x, player.y);
            context.lineTo(player.x + player.facingX * (radius + 12), player.y + player.facingY * (radius + 12));
            context.lineWidth = 3;
            context.strokeStyle = '#ffffff';
            context.stroke();

            const barWidth = 36;
            const healthRatio = Math.max(0, player.hp / player.maxHp);
            context.fillStyle = 'rgba(0,0,0,0.7)';
            context.fillRect(player.x - barWidth / 2, player.y - radius - 12, barWidth, 5);
            context.fillStyle = healthRatio > 0.5 ? '#5ee28b' : healthRatio > 0.2 ? '#ffc857' : '#ff6b73';
            context.fillRect(player.x - barWidth / 2, player.y - radius - 12, barWidth * healthRatio, 5);
        }

        context.font = '12px system-ui, sans-serif';
        context.textAlign = 'center';
        context.lineWidth = 3;
        context.strokeStyle = 'rgba(0,0,0,0.9)';
        const label = `${player.name || 'Player'}${isSelf ? ' (you)' : ''}`;
        context.strokeText(label, player.x, player.y + radius + 16);
        context.fillStyle = '#ffffff';
        context.fillText(label, player.x, player.y + radius + 16);
    }

    function updateHud() {
        if (!room?.state?.players) return;
        const state = room.state;
        const self = state.players.get(room.sessionId);
        elements.playerCount.textContent = `Players ${state.players.size}/8`;
        if (self) {
            elements.hp.textContent = `HP ${self.hp}/${self.maxHp}`;
            elements.score.textContent = `K ${self.kills} / D ${self.deaths}`;
            if (!self.alive) {
                const seconds = Math.max(0, Math.ceil((self.respawnAt - Date.now()) / 1000));
                elements.deathBanner.textContent = `You were knocked out — respawning in ${seconds}s`;
                elements.deathBanner.hidden = false;
            } else {
                elements.deathBanner.hidden = true;
            }
        }
    }

    function installRoom(joinedRoom) {
        room = joinedRoom;
        elements.activeRoomCode.textContent = room.roomId;
        elements.roomCode.value = room.roomId;
        elements.createdRoom.hidden = false;
        elements.lobby.hidden = true;
        elements.game.hidden = false;
        inputX = 0;
        inputY = 0;
        sequence = 0;

        setStatus('Connected to match', 'connected');
        room.onStateChange(() => updateHud());
        room.onMessage('playerDied', (message) => {
            const target = room?.state?.players?.get(message.targetId);
            if (message.targetId === room.sessionId) {
                elements.deathBanner.textContent = 'You were knocked out — respawning soon';
                elements.deathBanner.hidden = false;
            } else if (target) {
                setStatus(`${target.name} was knocked out`, 'connected');
            }
            updateHud();
        });
        room.onMessage('meleeSwing', (message) => {
            if (typeof message?.attackerId === 'string') {
                meleeSwings.set(message.attackerId, performance.now());
            }
        });
        room.onMessage('pong', () => {
            const elapsed = Math.round(performance.now() - pingSentAt);
            elements.ping.textContent = `Ping ${elapsed}ms`;
        });
        room.onError((code, message) => setStatus(`Match error ${code}: ${message}`, 'error'));
        room.onLeave((code) => {
            if (room !== joinedRoom) return;
            clearInterval(inputTimer);
            clearInterval(pingTimer);
            inputTimer = null;
            pingTimer = null;
            room = null;
            elements.lobby.hidden = false;
            elements.game.hidden = true;
            elements.createdRoom.hidden = true;
            setStatus(code === 1000 ? 'Left match' : 'Disconnected from match', code === 1000 ? '' : 'error');
            setLobbyMessage(code === 1000 ? 'You left the room. Create or join another match.' : 'The connection ended. You can try joining the room again.');
        });

        inputTimer = setInterval(() => {
            if (room !== joinedRoom) return;
            room.send('input', { x: inputX, y: inputY, seq: ++sequence });
        }, 50);
        pingTimer = setInterval(() => {
            if (room !== joinedRoom) return;
            pingSentAt = performance.now();
            room.send('ping');
        }, 1000);
        updateHud();
    }

    function leaveMatch() {
        if (!room) return;
        const currentRoom = room;
        room = null;
        clearInterval(inputTimer);
        clearInterval(pingTimer);
        inputTimer = null;
        pingTimer = null;
        inputX = 0;
        inputY = 0;
        currentRoom.leave();
        elements.lobby.hidden = false;
        elements.game.hidden = true;
        elements.createdRoom.hidden = true;
        setStatus('Left match');
        setLobbyMessage('You left the room. Create or join another match.');
    }

    function sendMelee() {
        if (room) room.send('melee');
    }

    function sendShot(targetX, targetY) {
        if (room) room.send('shoot', { x: targetX, y: targetY });
    }

    function sendShotFacing() {
        if (!room) return;
        const self = room.state.players.get(room.sessionId);
        if (self) sendShot(self.x + self.facingX * 100, self.y + self.facingY * 100);
    }

    function handleKeyDown(event) {
        if (!room || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        const key = event.key.toLowerCase();
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
        keysDown.add(key);
        if (key === ' ') sendMelee();
        updateInputFromKeys();
    }

    function handleKeyUp(event) {
        keysDown.delete(event.key.toLowerCase());
        updateInputFromKeys();
    }

    function updateInputFromKeys() {
        if (!room) return;
        inputX = Number(keysDown.has('d') || keysDown.has('arrowright')) - Number(keysDown.has('a') || keysDown.has('arrowleft'));
        inputY = Number(keysDown.has('s') || keysDown.has('arrowdown')) - Number(keysDown.has('w') || keysDown.has('arrowup'));
    }

    function shootAtCanvas(event) {
        if (!room) return;
        const bounds = elements.arena.getBoundingClientRect();
        sendShot(
            ((event.clientX - bounds.left) / bounds.width) * ARENA_WIDTH,
            ((event.clientY - bounds.top) / bounds.height) * ARENA_HEIGHT,
        );
    }

    function updateJoystick(event) {
        const bounds = elements.joystick.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        let dx = event.clientX - centerX;
        let dy = event.clientY - centerY;
        const maxRadius = bounds.width / 2;
        const distance = Math.hypot(dx, dy);
        if (distance > maxRadius) {
            dx = (dx / distance) * maxRadius;
            dy = (dy / distance) * maxRadius;
        }
        elements.joystickStick.style.left = `${50 + (dx / bounds.width) * 100}%`;
        elements.joystickStick.style.top = `${50 + (dy / bounds.height) * 100}%`;
        inputX = distance > 4 ? dx / maxRadius : 0;
        inputY = distance > 4 ? dy / maxRadius : 0;
    }

    function resetJoystick() {
        joystickPointer = null;
        inputX = 0;
        inputY = 0;
        elements.joystickStick.style.left = '50%';
        elements.joystickStick.style.top = '50%';
    }

    function bindEvents() {
        pageListeners = new AbortController();
        const { signal } = pageListeners;
        elements.backButton.addEventListener('click', () => Router.go('match-results'), { signal });
        elements.createRoom.addEventListener('click', createRoom, { signal });
        elements.quickJoin.addEventListener('click', quickJoin, { signal });
        elements.joinForm.addEventListener('submit', (event) => {
            event.preventDefault();
            joinRoomById(elements.joinCode.value);
        }, { signal });
        elements.copyCode.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(elements.roomCode.value);
                setLobbyMessage('Room code copied. Send it to your friends.');
            } catch {
                elements.roomCode.focus();
                elements.roomCode.select();
                setLobbyMessage('Copy was blocked by the browser. Select the room code and copy it.');
            }
        }, { signal });
        elements.leaveRoom.addEventListener('click', leaveMatch, { signal });
        elements.arena.addEventListener('click', shootAtCanvas, { signal });
        elements.melee.addEventListener('click', sendMelee, { signal });
        elements.shoot.addEventListener('click', sendShotFacing, { signal });
        elements.joystick.addEventListener('pointerdown', (event) => {
            if (!room) return;
            event.preventDefault();
            joystickPointer = event.pointerId;
            elements.joystick.setPointerCapture(event.pointerId);
            updateJoystick(event);
        }, { signal });
        elements.joystick.addEventListener('pointermove', (event) => {
            if (event.pointerId === joystickPointer) updateJoystick(event);
        }, { signal });
        elements.joystick.addEventListener('pointerup', (event) => {
            if (event.pointerId === joystickPointer) resetJoystick();
        }, { signal });
        elements.joystick.addEventListener('pointercancel', resetJoystick, { signal });
        window.addEventListener('keydown', handleKeyDown, { signal });
        window.addEventListener('keyup', handleKeyUp, { signal });
        window.addEventListener('blur', resetJoystick, { signal });
    }

    function resolveElements() {
        screen = document.querySelector('#match-screen');
        elements = {
            status: screen.querySelector('#match-connection-status'),
            backButton: screen.querySelector('.match-back-button'),
            lobby: screen.querySelector('#match-lobby'),
            game: screen.querySelector('#match-game'),
            lobbyMessage: screen.querySelector('#match-lobby-message'),
            playerName: screen.querySelector('#match-player-name'),
            createRoom: screen.querySelector('#match-create-room'),
            quickJoin: screen.querySelector('#match-quick-join'),
            joinCode: screen.querySelector('#match-join-code'),
            joinSubmit: screen.querySelector('#match-join-form button[type="submit"]'),
            joinForm: screen.querySelector('#match-join-form'),
            createdRoom: screen.querySelector('#match-created-room'),
            roomCode: screen.querySelector('#match-room-code'),
            copyCode: screen.querySelector('#match-copy-code'),
            activeRoomCode: screen.querySelector('#match-active-room-code'),
            leaveRoom: screen.querySelector('#match-leave-room'),
            arena: screen.querySelector('#match-arena'),
            hp: screen.querySelector('#match-hp'),
            score: screen.querySelector('#match-score'),
            playerCount: screen.querySelector('#match-player-count'),
            ping: screen.querySelector('#match-ping'),
            deathBanner: screen.querySelector('#match-death-banner'),
            joystick: screen.querySelector('#match-joystick'),
            joystickStick: screen.querySelector('#match-joystick-stick'),
            melee: screen.querySelector('#match-melee'),
            shoot: screen.querySelector('#match-shoot'),
        };
    }

    function start() {
        pageActive = true;
        resolveElements();
        bindEvents();
        elements.playerName.textContent = playerName() ? `Playing as ${playerName()}` : 'Sign in required';
        setStatus('Public room listing unavailable');
        setLobbyMessage(playerName()
            ? 'Use Quick Join to find or create a match, or enter your friend’s room code. The current server does not expose a public room list.'
            : 'Sign in first to play under your account username. The current server does not expose a public room list.');
        animationFrame = requestAnimationFrame(drawArena);
    }

    function stop() {
        pageActive = false;
        connectionAttempt += 1;
        cancelAnimationFrame(animationFrame);
        clearInterval(inputTimer);
        clearInterval(pingTimer);
        inputTimer = null;
        pingTimer = null;
        if (room) {
            const currentRoom = room;
            room = null;
            currentRoom.leave();
        }
        pageListeners?.abort();
        keysDown.clear();
        meleeSwings.clear();
        inputX = 0;
        inputY = 0;
    }

    return { start, stop };
})());
