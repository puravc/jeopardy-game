'use strict';
/* ── Buzzer Player Client ── */

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

let ws = null;
let myPlayerId = null;
let myName = null;
let myGameId = null;
let questionIsOpen = false;
let myBuzzPosition = null;

// ── DOM helpers ──
const $ = (id) => document.getElementById(id);
function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(`screen-${name}`).classList.add('active');
}

// ── Join ──
$('btn-join').addEventListener('click', doJoin);
$('input-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('input-name').focus(); });
$('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
// Auto-uppercase the code field
$('input-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

async function doJoin() {
    const code = $('input-code').value.trim().toUpperCase();
    const name = $('input-name').value.trim();
    const errEl = $('join-error');

    if (!code || code.length < 4) { showError('Enter a valid game code.'); return; }
    if (!name) { showError('Enter your name.'); return; }

    $('btn-join').textContent = 'Joining...';
    $('btn-join').disabled = true;

    try {
        const res = await fetch(`/api/join/${code}`);
        const game = await res.json();
        if (!res.ok) { showError(game.error || 'Game not found.'); reset(); return; }

        myName = name;
        myGameId = game.id;
        $('waiting-game-name').textContent = game.name;
        showScreen('waiting');
        connectWS(game.id, name);
    } catch (e) {
        showError('Connection error. Try again.');
        reset();
    }
}

function showError(msg) {
    const el = $('join-error');
    el.textContent = msg;
    el.style.display = 'block';
}
function reset() { $('btn-join').textContent = 'Join →'; $('btn-join').disabled = false; }

// ── WebSocket Connection ──
function connectWS(gameId, playerName) {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'player_join', gameId, playerName }));
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
    };

    ws.onclose = () => {
        if (myPlayerId) {
            $('buzz-status').textContent = '⚠ Disconnected';
        }
    };
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'error':
            // Boot player back to join screen with error message
            showScreen('join');
            showError(msg.message);
            reset();
            if (ws) { ws.close(); ws = null; }
            break;

        case 'player_joined':
            myPlayerId = msg.playerId;
            questionIsOpen = msg.questionOpen;
            
            // Show header with my name
            $('header-name').textContent = myName;
            $('player-header').style.display = 'flex';
            
            if (questionIsOpen) showBuzzerScreen(true);
            break;

        case 'player_list':
            renderPlayerList(msg.players);
            // Also update my score from the list if it's there
            const meJoined = msg.players.find(p => p.id === myPlayerId);
            if (meJoined) {
                $('header-score').textContent = `$${meJoined.score.toLocaleString()}`;
            }
            break;

        case 'question_open':
            questionIsOpen = true;
            myBuzzPosition = null;
            showBuzzerScreen(true);
            break;

        case 'question_closed':
            questionIsOpen = false;
            showBuzzerScreen(false);
            // Go back to waiting after short delay
            setTimeout(() => {
                showScreen('waiting');
                myBuzzPosition = null;
            }, 1500);
            break;

        case 'buzzer_update':
            const pos = msg.queue.findIndex(b => b.playerId === myPlayerId);
            if (pos !== -1) {
                myBuzzPosition = pos + 1;
                renderBuzzedState(myBuzzPosition);
            }
            break;

        case 'score_update':
            // Update all players in list
            renderPlayerList(msg.players);
            
            // Update my own score in header
            const me = msg.players.find(p => p.id === myPlayerId);
            if (me) {
                $('header-score').textContent = `$${me.score.toLocaleString()}`;
            }

            // Show animation if an event occurred
            if (msg.event) {
                const targetPlayer = msg.players.find(p => p.id === msg.event.playerId);
                if (targetPlayer) {
                    showAwardAnimation(targetPlayer.name, msg.event.amount, msg.event.type);
                }
            }
            break;
    }
}

function showAwardAnimation(name, amount, type) {
    const container = $('animation-container');
    const div = document.createElement('div');
    div.className = `award-notif ${type === 'deduct' ? 'deduct' : ''}`;
    
    const isMe = name === myName;
    const displayName = isMe ? 'YOU' : name;
    const sign = amount >= 0 ? '+' : '';
    
    div.innerHTML = `
        <div class="award-target">${displayName}</div>
        <div class="award-amount">${sign}$${Math.abs(amount).toLocaleString()}</div>
    `;
    
    container.appendChild(div);
    
    // Remove after animation finishes
    setTimeout(() => div.remove(), 2000);

    // If it was me, maybe a little extra flair?
    if (isMe && type === 'award') {
        if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 50]);
    }
}

// ── Buzzer Screen ──
function showBuzzerScreen(active) {
    showScreen('buzzer');
    const btn = $('btn-buzzer');
    const statusEl = $('buzz-status');
    const posEl = $('buzz-position');

    btn.classList.remove('buzzed-first', 'buzzed-late');
    posEl.style.display = 'none';
    btn.disabled = !active;

    if (!active) {
        statusEl.textContent = '⌛ Waiting...';
        $('buzzer-label') && ($('btn-buzzer').querySelector('.buzzer-label').textContent = 'BUZZ!');
    } else if (myBuzzPosition) {
        renderBuzzedState(myBuzzPosition);
    } else {
        statusEl.textContent = 'TAP TO BUZZ!';
        btn.querySelector('.buzzer-label').textContent = 'BUZZ!';
    }
}

function renderBuzzedState(pos) {
    const btn = $('btn-buzzer');
    const statusEl = $('buzz-status');
    const posEl = $('buzz-position');

    btn.disabled = true;
    btn.classList.remove('buzzed-first', 'buzzed-late');

    if (pos === 1) {
        btn.classList.add('buzzed-first');
        statusEl.textContent = '🥇 YOU\'RE FIRST!';
        btn.querySelector('.buzzer-label').textContent = '#1';
        // Vibrate on phones
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } else {
        btn.classList.add('buzzed-late');
        statusEl.textContent = `You buzzed in #${pos}`;
        btn.querySelector('.buzzer-label').textContent = `#${pos}`;
    }

    posEl.style.display = 'block';
    posEl.textContent = pos === 1 ? '✅ Answer now!' : `${pos - 1} player${pos > 2 ? 's' : ''} buzzed before you.`;
}

// ── Buzzer Button ──
$('btn-buzzer').addEventListener('click', () => {
    if (!ws || !myPlayerId || !questionIsOpen || myBuzzPosition) return;
    ws.send(JSON.stringify({
        type: 'buzz',
        gameId: myGameId,
        playerId: myPlayerId,
        playerName: myName,
    }));
});

// ── Player List ──
function renderPlayerList(players) {
    const el = $('player-list');
    if (!players.length) { return; }
    
    // Show scoreboard section
    $('section-scoreboard').style.display = 'block';

    // Sort players by score descending
    const sorted = [...players].sort((a, b) => b.score - a.score);
    
    el.innerHTML = sorted.map(p => `
        <div class="player-row${p.id === myPlayerId ? ' me' : ''}">
            <span class="p-name">${escHtml(p.name)}${p.id === myPlayerId ? ' (you)' : ''}</span>
            <span class="p-score">$${p.score.toLocaleString()}</span>
        </div>
    `).join('');
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
