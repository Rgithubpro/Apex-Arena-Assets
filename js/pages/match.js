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
    let aimPosition = null;
    let keysDown = new Set();
    const meleeSwings = new Map();
    const selfPositionUpdatedAt = { x: 0, y: 0, time: 0 };
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

    function resizeArenaCanvas() {
        if (!elements.arena) return;
        const bounds = elements.arena.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
        const pixelWidth = Math.round(bounds.width * pixelRatio);
        const pixelHeight = Math.round(bounds.height * pixelRatio);
        if (elements.arena.width !== pixelWidth || elements.arena.height !== pixelHeight) {
            elements.arena.width = pixelWidth;
            elements.arena.height = pixelHeight;
        }
    }

    function predictedSelfPosition(player) {
        const elapsed = Math.min(0.06, Math.max(0, (performance.now() - selfPositionUpdatedAt.time) / 1000));
        const magnitude = Math.hypot(inputX, inputY);
        if (!magnitude || !elapsed) return { x: player.x, y: player.y };
        const directionX = inputX / magnitude;
        const directionY = inputY / magnitude;
        const radius = player.radius || 16;
        const speed = player.speed || 160;
        let x = Math.max(radius, Math.min(ARENA_WIDTH - radius, player.x + directionX * speed * elapsed));
        let y = Math.max(radius, Math.min(ARENA_HEIGHT - radius, player.y + directionY * speed * elapsed));

        room.state.obstacles?.forEach?.((obstacle) => {
            const closestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
            const closestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
            const dx = x - closestX;
            const dy = y - closestY;
            const distance = Math.hypot(dx, dy);
            if (distance >= radius) return;
            if (!distance) {
                y -= radius;
                return;
            }
            const overlap = radius - distance;
            x += (dx / distance) * overlap;
            y += (dy / distance) * overlap;
        });
        return { x, y };
    }

    function syncSelfPrediction(player) {
        if (player.x === selfPositionUpdatedAt.x && player.y === selfPositionUpdatedAt.y) return;
        selfPositionUpdatedAt.x = player.x;
        selfPositionUpdatedAt.y = player.y;
        selfPositionUpdatedAt.time = performance.now();
    }

    function drawArena() {
        if (!pageActive || !room?.state) {
            animationFrame = requestAnimationFrame(drawArena);
            return;
        }

        const canvas = elements.arena;
        const context = canvas.getContext('2d');
        const state = room.state;
        resizeArenaCanvas();
        context.setTransform(canvas.width / ARENA_WIDTH, 0, 0, canvas.height / ARENA_HEIGHT, 0, 0);
        context.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
        const background = context.createLinearGradient(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
        background.addColorStop(0, '#142438');
        background.addColorStop(0.52, '#101e30');
        background.addColorStop(1, '#0b1928');
        context.fillStyle = background;
        context.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

        context.strokeStyle = 'rgba(132, 185, 218, 0.035)';
        context.lineWidth = 0.5;
        for (let x = 20; x < ARENA_WIDTH; x += 20) {
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, ARENA_HEIGHT);
            context.stroke();
        }
        for (let y = 20; y < ARENA_HEIGHT; y += 20) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(ARENA_WIDTH, y);
            context.stroke();
        }
        context.strokeStyle = 'rgba(132, 185, 218, 0.075)';
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
            const { x, y, width, height } = obstacle;
            context.save();
            context.shadowColor = 'rgba(0, 0, 0, 0.45)';
            context.shadowBlur = 12;
            context.shadowOffsetY = 5;
            const surface = context.createLinearGradient(x, y, x, y + height);
            surface.addColorStop(0, '#49637a');
            surface.addColorStop(0.12, '#344c63');
            surface.addColorStop(1, '#24384c');
            context.fillStyle = surface;
            context.beginPath();
            context.roundRect(x, y, width, height, 5);
            context.fill();
            context.shadowColor = 'transparent';
            context.shadowBlur = 0;
            context.shadowOffsetY = 0;
            context.strokeStyle = 'rgba(159, 205, 235, 0.42)';
            context.lineWidth = 1.5;
            context.stroke();
            context.strokeStyle = 'rgba(194, 225, 246, 0.16)';
            context.beginPath();
            context.moveTo(x + 7, y + 3);
            context.lineTo(x + width - 7, y + 3);
            context.stroke();
            context.restore();
        });

        state.projectiles?.forEach?.((projectile) => {
            const trailLength = 14;
            const trail = context.createLinearGradient(
                projectile.x - projectile.vx * 0.035,
                projectile.y - projectile.vy * 0.035,
                projectile.x,
                projectile.y,
            );
            trail.addColorStop(0, 'rgba(255, 170, 72, 0)');
            trail.addColorStop(1, 'rgba(255, 204, 104, 0.72)');
            context.beginPath();
            context.moveTo(projectile.x - projectile.vx * 0.035, projectile.y - projectile.vy * 0.035);
            context.lineTo(projectile.x, projectile.y);
            context.strokeStyle = trail;
            context.lineWidth = trailLength;
            context.lineCap = 'round';
            context.stroke();
            context.beginPath();
            context.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
            const shot = context.createRadialGradient(projectile.x - 2, projectile.y - 2, 1, projectile.x, projectile.y, projectile.radius + 3);
            shot.addColorStop(0, '#fff4bd');
            shot.addColorStop(0.45, '#ffd068');
            shot.addColorStop(1, '#ff873b');
            context.fillStyle = shot;
            context.shadowColor = '#ffae4b';
            context.shadowBlur = 14;
            context.fill();
            context.shadowBlur = 0;
        });

        state.players?.forEach?.((player, sessionId) => drawPlayer(context, player, sessionId));
        if (aimPosition) {
            context.save();
            context.strokeStyle = 'rgba(207, 245, 255, 0.9)';
            context.lineWidth = 1.5;
            context.shadowColor = '#55dcff';
            context.shadowBlur = 8;
            context.beginPath();
            context.arc(aimPosition.x, aimPosition.y, 9, 0, Math.PI * 2);
            context.moveTo(aimPosition.x - 14, aimPosition.y);
            context.lineTo(aimPosition.x + 14, aimPosition.y);
            context.moveTo(aimPosition.x, aimPosition.y - 14);
            context.lineTo(aimPosition.x, aimPosition.y + 14);
            context.stroke();
            context.restore();
        }
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
        const position = isSelf && player.alive ? predictedSelfPosition(player) : player;
        const x = position.x;
        const y = position.y;
        const body = context.createRadialGradient(x - radius * 0.38, y - radius * 0.45, 1, x, y, radius * 1.3);
        body.addColorStop(0, '#ffffff');
        body.addColorStop(0.12, player.color || '#ffffff');
        body.addColorStop(1, player.color || '#ffffff');
        context.globalAlpha = player.alive ? (player.connected ? 1 : 0.5) : 0.28;
        context.beginPath();
        context.arc(x, y, radius + 4, 0, Math.PI * 2);
        context.fillStyle = isSelf ? 'rgba(87, 219, 255, 0.15)' : 'rgba(255, 255, 255, 0.07)';
        context.fill();
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = body;
        context.fill();
        context.lineWidth = isSelf ? 2.5 : 1.5;
        context.strokeStyle = isSelf ? '#c8f8ff' : 'rgba(255,255,255,0.82)';
        context.stroke();
        context.globalAlpha = 1;

        if (player.alive) {
            const facingLength = radius + 16;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x + player.facingX * facingLength, y + player.facingY * facingLength);
            context.lineWidth = 4;
            context.lineCap = 'round';
            context.strokeStyle = 'rgba(0, 0, 0, 0.55)';
            context.stroke();
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x + player.facingX * facingLength, y + player.facingY * facingLength);
            context.lineWidth = 2.3;
            context.strokeStyle = '#ffffff';
            context.stroke();

            const barWidth = 42;
            const barY = y - radius - 14;
            const healthRatio = Math.max(0, player.hp / player.maxHp);
            context.fillStyle = 'rgba(3, 10, 17, 0.92)';
            context.beginPath();
            context.roundRect(x - barWidth / 2, barY, barWidth, 6, 3);
            context.fill();
            const healthColor = healthRatio > 0.5 ? '#68f0a2' : healthRatio > 0.2 ? '#ffd05e' : '#ff687b';
            context.fillStyle = healthColor;
            context.shadowColor = healthColor;
            context.shadowBlur = 6;
            context.beginPath();
            context.roundRect(x - barWidth / 2 + 1, barY + 1, Math.max(0, (barWidth - 2) * healthRatio), 4, 2);
            context.fill();
            context.shadowBlur = 0;
        }

        context.font = '600 12px system-ui, sans-serif';
        context.textAlign = 'center';
        const label = `${player.name || 'Player'}${isSelf ? ' (you)' : ''}`;
        const labelY = y + radius + 22;
        const labelWidth = context.measureText(label).width + 14;
        context.fillStyle = 'rgba(4, 12, 21, 0.78)';
        context.beginPath();
        context.roundRect(x - labelWidth / 2, labelY - 13, labelWidth, 19, 8);
        context.fill();
        context.lineWidth = 3;
        context.strokeStyle = 'rgba(0,0,0,0.8)';
        context.strokeText(label, x, labelY);
        context.fillStyle = isSelf ? '#e5fbff' : '#e5edf5';
        context.fillText(label, x, labelY);
    }

    function updateHud() {
        if (!room?.state?.players) return;
        const state = room.state;
        const self = state.players.get(room.sessionId);
        elements.playerCount.textContent = `Players ${state.players.size}/8`;
        if (self) {
            syncSelfPrediction(self);
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
        aimPosition = null;
        selfPositionUpdatedAt.x = Number.NaN;
        selfPositionUpdatedAt.y = Number.NaN;
        selfPositionUpdatedAt.time = performance.now();

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
        const target = canvasPosition(event);
        aimPosition = target;
        sendShot(target.x, target.y);
    }

    function canvasPosition(event) {
        const bounds = elements.arena.getBoundingClientRect();
        return {
            x: ((event.clientX - bounds.left) / bounds.width) * ARENA_WIDTH,
            y: ((event.clientY - bounds.top) / bounds.height) * ARENA_HEIGHT,
        };
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
        elements.arena.addEventListener('pointermove', (event) => {
            if (event.pointerType === 'mouse') aimPosition = canvasPosition(event);
        }, { signal });
        elements.arena.addEventListener('pointerleave', () => { aimPosition = null; }, { signal });
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
