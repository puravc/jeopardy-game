/* ============================================================
   JEOPARDY GAME — Frontend SPA Controller
   ============================================================ */
'use strict';

// ─── State ───────────────────────────────────────────────────
const State = {
    currentGameId: null,
    game: null,
    activeModal: null, // { categoryId, questionId }
};

// ─── API Service ──────────────────────────────────────────────
const API = {
    base: '/api',

    async request(method, path, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        const token = localStorage.getItem('admin_token');
        if (token) {
            opts.headers['Authorization'] = 'Bearer ' + token;
        }
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(this.base + path, opts);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    },

    get: (p) => API.request('GET', p),
    post: (p, b) => API.request('POST', p, b),
    put: (p, b) => API.request('PUT', p, b),
    del: (p) => API.request('DELETE', p),

    // games
    listGames: () => API.get('/games'),
    createGame: (name) => API.post('/games', { name }),
    getGame: (id) => API.get(`/games/${id}`),
    updateGame: (id, data) => API.put(`/games/${id}`, data),
    deleteGame: (id) => API.del(`/games/${id}`),

    // players
    addPlayer: (gid, name) => API.post(`/games/${gid}/players`, { name }),
    removePlayer: (gid, pid) => API.del(`/games/${gid}/players/${pid}`),

    // categories
    addCategory: (gid, name) => API.post(`/games/${gid}/categories`, { name }),
    removeCategory: (gid, cid) => API.del(`/games/${gid}/categories/${cid}`),
    updateQuestions: (gid, cid, questions) => API.put(`/games/${gid}/categories/${cid}/questions`, { questions }),

    // AI
    generateQuestions: (gid, categoryId, hint, difficulty) => API.post(`/games/${gid}/generate-questions`, { categoryId, hint, difficulty }),
    getConfig: () => API.get('/config'),

    // game control
    startGame: (id) => API.post(`/games/${id}/start`),
    pauseGame: (id) => API.post(`/games/${id}/pause`),
    resetGame: (id) => API.post(`/games/${id}/reset`),
    awardPoints: (id, questionId, playerId, categoryId) =>
        API.post(`/games/${id}/award`, { questionId, playerId, categoryId }),
    deductPoints: (id, questionId, playerId, categoryId) =>
        API.post(`/games/${id}/deduct`, { questionId, playerId, categoryId }),
    skipQuestion: (id, questionId, categoryId) =>
        API.post(`/games/${id}/skip`, { questionId, categoryId }),
};

// ─── Utilities ────────────────────────────────────────────────
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function showToast(msg, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    toast.innerHTML = `<span>${icons[type] || '•'}</span><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3100);
}

function showLoading(text = 'LOADING...') {
    $('#loading-text').textContent = text;
    $('#loading-overlay').classList.add('open');
}

function hideLoading() {
    $('#loading-overlay').classList.remove('open');
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function animateScoreFly(x, y, value) {
    const el = document.createElement('div');
    el.className = 'score-fly';
    el.textContent = `+${value}`;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
}

// ─── View Router ─────────────────────────────────────────────
const views = ['home', 'admin', 'game', 'complete'];

function showView(name) {
    views.forEach(v => {
        const el = $(`#view-${v}`);
        if (el) el.classList.toggle('active', v === name);
    });
    updateHeaderNav(name);
}

function updateHeaderNav(view) {
    const nav = $('#header-nav');
    nav.innerHTML = '';

    if (view === 'admin' || view === 'game' || view === 'complete') {
        const homeBtn = document.createElement('button');
        homeBtn.className = 'btn btn-ghost btn-sm';
        homeBtn.textContent = '🏠 Home';
        homeBtn.addEventListener('click', () => goHome());
        nav.appendChild(homeBtn);
    }

    if (view === 'admin') {
        const gameName = State.game?.name || 'Game';
        const label = document.createElement('span');
        label.style.cssText = 'color:var(--text-muted);font-size:.8rem;';
        label.textContent = gameName;
        nav.appendChild(label);
    }
}

// ─── HOME VIEW ────────────────────────────────────────────────
async function goHome() {
    State.currentGameId = null;
    State.game = null;
    showView('home');
    await loadHomeView();
}

async function loadHomeView() {
    if (!localStorage.getItem('admin_token')) {
        // Not signed in — hide the games section
        const grid = $('#games-grid');
        const count = $('#games-count');
        count.textContent = '';
        grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔐</div>
        <p>Sign in as admin to view and manage your games.</p>
      </div>`;
        return;
    }
    try {
        const games = await API.listGames();
        renderGamesList(games);
    } catch (e) {
        showToast('Failed to load games: ' + e.message, 'error');

    }
}

function renderGamesList(games) {
    const grid = $('#games-grid');
    const count = $('#games-count');
    count.textContent = games.length ? `${games.length} game${games.length !== 1 ? 's' : ''}` : '';

    if (!games.length) {
        const hasToken = !!localStorage.getItem('admin_token');
        grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🃏</div>
        <p>No games yet. ${hasToken ? 'Create your first game!' : 'Sign in as admin to create a game.'}</p>
        ${hasToken ? '<button class="btn btn-primary" onclick="createNewGame()">✨ New Game</button>' : ''}
      </div>`;
        return;
    }

    grid.innerHTML = games.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(g => `
    <div class="game-card slide-up" data-id="${g.id}">
      <div class="flex justify-between items-center mb-1">
        <div class="game-card-title">${escHtml(g.name)}</div>
        <span class="status-badge status-${g.status}">${statusLabel(g.status)}</span>
      </div>
      <div class="game-card-meta">
        <span>👥 ${g.playerCount} player${g.playerCount !== 1 ? 's' : ''}</span>
        <span>📚 ${g.categoryCount} topic${g.categoryCount !== 1 ? 's' : ''}</span>
        <span>📅 ${formatDate(g.updatedAt)}</span>
        ${g.status === 'completed' && g.players && g.players.length > 0 ?
            `<span style="color:var(--gold);font-weight:bold;" title="Winner">👑 ${escHtml([...g.players].sort((a, b) => b.score - a.score)[0].name)}</span>` : ''}
      </div>
      <div class="game-card-actions">
        ${g.status === 'active' || g.status === 'paused'
            ? `<button class="btn btn-success btn-sm" onclick="resumeGame('${g.id}')">▶ Resume</button>`
            : g.status === 'completed'
                ? `<button class="btn btn-primary btn-sm" onclick="openGame('${g.id}')">🏆 View Results</button>`
                : `<button class="btn btn-primary btn-sm" onclick="openGame('${g.id}')">⚙️ Configure</button>`
        }
        <button class="btn btn-ghost btn-sm" onclick="openGame('${g.id}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGame('${g.id}', event)">🗑</button>
      </div>
    </div>
  `).join('');
}

function statusLabel(s) {
    const labels = { configuring: '⚙️ Setting Up', active: '🎮 Live', paused: '⏸ Paused', completed: '🏆 Done' };
    return labels[s] || s;
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function createNewGame() {
    const name = prompt('Game name:');
    if (!name || !name.trim()) return;
    showLoading('CREATING GAME...');
    try {
        const game = await API.createGame(name.trim());
        State.currentGameId = game.id;
        State.game = game;
        await openAdminConsole(game.id);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteGame(id, e) {
    e.stopPropagation();
    if (!confirm('Delete this game? This cannot be undone.')) return;
    try {
        await API.deleteGame(id);
        showToast('Game deleted', 'info');
        await loadHomeView();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function openGame(id) {
    showLoading('LOADING GAME...');
    try {
        const game = await API.getGame(id);
        State.currentGameId = id;
        State.game = game;

        if (game.status === 'completed') {
            showView('complete');
            renderCompleteView(game);
        } else if (game.status === 'active' || game.status === 'paused') {
            // offer choice
            const action = game.status === 'active' ? 'resume' :
                confirm('Resume this paused game?\n\nClick OK to resume, Cancel to just configure.') ? 'resume' : 'configure';
            if (action === 'resume') {
                await resumeGame(id);
            } else {
                await openAdminConsole(id);
            }
        } else {
            await openAdminConsole(id);
        }
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        hideLoading();
    }
}

async function resumeGame(id) {
    showLoading('LOADING GAME...');
    try {
        const game = await API.getGame(id);
        State.currentGameId = id;
        State.game = game;
        if (game.status === 'paused') {
            await API.updateGame(id, { status: 'active' });
            State.game.status = 'active';
        }
        showView('game');
        renderBoard(State.game);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        hideLoading();
    }
}

// ─── ADMIN CONSOLE ────────────────────────────────────────────
async function openAdminConsole(id) {
    showLoading('LOADING...');
    try {
        const game = await API.getGame(id);
        State.currentGameId = id;
        State.game = game;
        showView('admin');
        renderAdminConsole(game);
        showAdminSection('game-info');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderAdminConsole(game) {
    // Game info
    $('#input-game-name').value = game.name;
    renderAdminStats(game);
    renderPlayerList(game);
    renderCategoryList(game);
    renderLaunchSection(game);
}

function renderAdminStats(game) {
    const totalQ = game.categories.reduce((s, c) => s + c.questions.length, 0);
    $('#stat-players').textContent = game.players.length;
    $('#stat-topics').textContent = game.categories.length;
    $('#stat-questions').textContent = totalQ;
    $('#stat-status').textContent = game.status.charAt(0).toUpperCase() + game.status.slice(1);
}

function renderPlayerList(game) {
    const list = $('#player-list');
    if (!game.players.length) {
        list.innerHTML = '<p class="text-muted text-sm">No players yet.</p>';
        return;
    }
    list.innerHTML = game.players.map(p => `
    <div class="player-item fade-in" data-player-id="${p.id}">
      <div class="player-info">
        <div class="player-avatar">${initials(p.name)}</div>
        <span class="player-name">${escHtml(p.name)}</span>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="removePlayer('${p.id}')">✕ Remove</button>
    </div>
  `).join('');
}

function renderCategoryList(game) {
    const list = $('#category-list');
    if (!game.categories.length) {
        list.innerHTML = '<p class="text-muted text-sm">No topics yet.</p>';
        return;
    }
    list.innerHTML = game.categories.map(cat => {
        const qCount = cat.questions.length;
        return `
    <div class="category-item fade-in" data-cat-id="${cat.id}">
      <div class="category-header">
        <div class="category-title-row">
          <div class="category-icon">📚</div>
          <div>
            <div class="category-name">${escHtml(cat.name)}</div>
            <div class="category-q-count">${qCount} question${qCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="category-actions">
          <button class="btn btn-primary btn-sm" onclick="generateQuestions('${cat.id}')">
            ✨ Generate Questions
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openManualEntry('${cat.id}')">
            ✏️ Manual
          </button>
          <button class="btn btn-danger btn-sm" onclick="removeCategory('${cat.id}')">✕</button>
        </div>
        <div class="category-hint-row">
          <select id="diff-${cat.id}" class="difficulty-select" title="Difficulty Level">
            <option value="easy">Easy</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
            <option value="impossible">Impossible</option>
          </select>
          <input
            type="text"
            id="hint-${cat.id}"
            class="hint-input"
            placeholder="💡 Hint: e.g. focus on 1990s, beginner level, multiple choice style..."
            maxlength="200"
          />
        </div>
      </div>
      ${qCount > 0 ? renderQuestionList(cat) : ''}
    </div>`;
    }).join('');
}

function renderQuestionList(cat) {
    return `
    <div class="question-list">
      ${cat.questions.map(q => `
        <div class="question-item">
          <span class="question-value">$${q.value}</span>
          <div class="question-text">${escHtml(q.question)}</div>
          <div class="answer-text"><span class="answer-label">A: </span>${escHtml(q.answer)}</div>
        </div>
      `).join('')}
    </div>`;
}

function renderLaunchSection(game) {
    const checks = [
        { ok: !!game.name, label: 'Game has a name' },
        { ok: game.players.length >= 2, label: 'At least 2 players added' },
        { ok: game.categories.length >= 1, label: 'At least 1 topic added' },
        { ok: game.categories.length > 0 && game.categories.every(c => c.questions.length >= 5), label: 'All topics have questions (5+)' },
    ];

    const list = $('#validation-list');
    list.innerHTML = checks.map(c => `
    <li class="${c.ok ? 'ok' : 'fail'}">
      <span>${c.ok ? '✅' : '❌'}</span> ${c.label}
    </li>
  `).join('');

    const allOk = checks.every(c => c.ok);
    $('#btn-start-game').disabled = !allOk;
}

function showAdminSection(name) {
    $$('.admin-section').forEach(s => s.classList.remove('active'));
    $$('.admin-nav-item').forEach(n => n.classList.remove('active'));
    $(`#admin-${name}`).classList.add('active');
    $(`#nav-${name}`)?.classList.add('active');
}

// Admin sidebar navigation
$$('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        showAdminSection(section);
        if (section === 'launch') renderLaunchSection(State.game);
    });
});

// Save game name
$('#btn-save-game-name').addEventListener('click', async () => {
    const name = $('#input-game-name').value.trim();
    if (!name) { showToast('Name required', 'warning'); return; }
    try {
        const updated = await API.updateGame(State.currentGameId, { name });
        State.game = updated;
        showToast('Game name saved!', 'success');
        renderAdminStats(updated);
        updateHeaderNav('admin');
    } catch (e) {
        showToast(e.message, 'error');
    }
});

// Add player
async function addPlayer() {
    const input = $('#input-player-name');
    const name = input.value.trim();
    if (!name) { showToast('Enter a player name', 'warning'); return; }
    try {
        await API.addPlayer(State.currentGameId, name);
        input.value = '';
        const game = await API.getGame(State.currentGameId);
        State.game = game;
        renderPlayerList(game);
        renderAdminStats(game);
        showToast(`${name} added!`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function removePlayer(playerId) {
    try {
        await API.removePlayer(State.currentGameId, playerId);
        const game = await API.getGame(State.currentGameId);
        State.game = game;
        renderPlayerList(game);
        renderAdminStats(game);
        showToast('Player removed', 'info');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

$('#btn-add-player').addEventListener('click', addPlayer);
$('#input-player-name').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });

// Add category
async function addCategory() {
    const input = $('#input-category-name');
    const name = input.value.trim();
    if (!name) { showToast('Enter a topic name', 'warning'); return; }
    try {
        await API.addCategory(State.currentGameId, name);
        input.value = '';
        const game = await API.getGame(State.currentGameId);
        State.game = game;
        renderCategoryList(game);
        renderAdminStats(game);
        showToast(`Topic "${name}" added!`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function removeCategory(catId) {
    if (!confirm('Remove this topic and all its questions?')) return;
    try {
        await API.removeCategory(State.currentGameId, catId);
        const game = await API.getGame(State.currentGameId);
        State.game = game;
        renderCategoryList(game);
        renderAdminStats(game);
        showToast('Topic removed', 'info');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

$('#btn-add-category').addEventListener('click', addCategory);
$('#input-category-name').addEventListener('keydown', e => { if (e.key === 'Enter') addCategory(); });

// Generate AI questions
async function generateQuestions(catId) {
    const cat = State.game.categories.find(c => c.id === catId);
    if (!cat) return;

    // Show inline generating state
    const catEl = $(`.category-item[data-cat-id="${catId}"]`);
    const actionsArea = catEl.querySelector('.category-actions');
    const genBtn = actionsArea.querySelector('button');
    genBtn.disabled = true;
    genBtn.innerHTML = `<span class="spinner" style="color:white;"></span> Generating...`;

    try {
        const hintInput = document.getElementById(`hint-${catId}`);
        const hint = hintInput ? hintInput.value.trim() : '';
        const diffSelect = document.getElementById(`diff-${catId}`);
        const difficulty = diffSelect ? diffSelect.value : 'medium';
        const { questions } = await API.generateQuestions(State.currentGameId, catId, hint, difficulty);
        const game = await API.getGame(State.currentGameId);
        State.game = game;
        renderCategoryList(game);
        renderAdminStats(game);
        showToast(`✨ Generated ${questions.length} questions for "${cat.name}"!`, 'success');
    } catch (e) {
        genBtn.disabled = false;
        genBtn.innerHTML = '✨ Generate Questions';
        showToast('Generation failed: ' + e.message, 'error');
    }
}

// Manual question entry
function openManualEntry(catId) {
    const cat = State.game.categories.find(c => c.id === catId);
    if (!cat) return;

    let currentQuestions = cat.questions.length > 0 ? [...cat.questions] :
        [200, 400, 600, 800, 1000].map(v => ({ value: v, question: '', answer: '' }));

    // Inject dialog into DOM
    const existing_dialog = document.getElementById('manual-entry-dialog');
    if (existing_dialog) existing_dialog.remove();

    const dialog = document.createElement('div');
    dialog.id = 'manual-entry-dialog';
    dialog.style.cssText = `
        position:fixed;inset:0;z-index:2000;background:rgba(0,0,10,0.92);
        backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:1.5rem;
    `;
    dialog.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--border-gold);border-radius:var(--radius-lg);
                    padding:2rem;max-width:850px;width:100%;max-height:90vh;display:flex;flex-direction:column;
                    box-shadow:var(--shadow-gold);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-shrink:0;">
                <div>
                    <h2 style="font-size:1.6rem;background:linear-gradient(135deg,var(--text-primary),var(--blue-bright));
                               -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                        ✏️ MANUAL QUESTIONS
                    </h2>
                    <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.25rem;">Topic: <strong style="color:var(--gold)">${escHtml(cat.name)}</strong></p>
                </div>
                <button id="manual-close" class="btn btn-ghost btn-sm">✕ Cancel</button>
            </div>
            
            <div id="manual-rows-container" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:0.6rem;margin-bottom:1.5rem;padding-right:0.5rem;">
                <!-- rows injected here -->
            </div>
            
            <div style="display:flex;gap:1rem;justify-content:space-between;flex-shrink:0;">
                <button id="manual-add-row" class="btn btn-ghost btn-sm">➕ Add Question</button>
                <button id="manual-save" class="btn btn-gold">💾 Save Questions</button>
            </div>
        </div>`;

    // Extra styles for rows
    const style = document.createElement('style');
    style.textContent = `
        .manual-row { display:grid;grid-template-columns:80px 1fr 36px;gap:0.5rem;align-items:start; }
        .manual-fields { display:flex;gap:0.4rem; }
        .manual-fields .form-input { flex:1; font-size:0.82rem; padding:0.5rem 0.75rem; }
        .manual-v { font-size:0.9rem; padding:0.5rem; text-align:center; font-family:'Bebas Neue',sans-serif; color:var(--gold); }
    `;
    dialog.appendChild(style);
    document.body.appendChild(dialog);

    const container = dialog.querySelector('#manual-rows-container');

    function renderRows() {
        let html = `
            <div style="display:grid;grid-template-columns:80px 1fr 36px;gap:0.5rem;padding:0 0 0.25rem;
                        font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);">
                <span>Points</span><span>Question → Answer (fill at least 5 for game)</span><span></span>
            </div>
        `;
        currentQuestions.forEach((q, i) => {
            html += `
            <div class="manual-row" data-index="${i}">
              <input type="number" class="form-input manual-v" placeholder="Pts" value="${q.value}" />
              <div class="manual-fields">
                <input class="form-input manual-q" placeholder="Question / Clue..." value="${escHtml(q.question || '')}" />
                <input class="form-input manual-a" placeholder="Answer..." value="${escHtml(q.answer || '')}" />
              </div>
              <button class="btn btn-danger btn-sm manual-remove-row" data-index="${i}">✕</button>
            </div>`;
        });
        container.innerHTML = html;

        // Attach remove row listeners
        container.querySelectorAll('.manual-remove-row').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                syncInputsToArray();
                currentQuestions.splice(idx, 1);
                renderRows();
            });
        });
    }

    function syncInputsToArray() {
        const rows = container.querySelectorAll('.manual-row');
        rows.forEach((row, i) => {
            if (currentQuestions[i]) {
                currentQuestions[i].value = parseInt(row.querySelector('.manual-v').value) || 0;
                currentQuestions[i].question = row.querySelector('.manual-q').value;
                currentQuestions[i].answer = row.querySelector('.manual-a').value;
            }
        });
    }

    renderRows();

    document.getElementById('manual-add-row').addEventListener('click', () => {
        syncInputsToArray();
        const lastVal = currentQuestions.length > 0 ? currentQuestions[currentQuestions.length - 1].value : 0;
        currentQuestions.push({ value: lastVal + 200, question: '', answer: '' });
        renderRows();
        // scroll to bottom
        setTimeout(() => container.scrollTop = container.scrollHeight, 50);
    });

    document.getElementById('manual-close').addEventListener('click', () => dialog.remove());

    document.getElementById('manual-save').addEventListener('click', async () => {
        syncInputsToArray();

        const questionsToSave = [];
        currentQuestions.forEach(q => {
            const qText = q.question.trim();
            const aText = q.answer.trim();
            const val = q.value;
            if (qText && aText && val > 0) {
                questionsToSave.push({ id: crypto.randomUUID(), value: val, question: qText, answer: aText, answered: false, answeredBy: null });
            }
        });

        if (questionsToSave.length < 5) {
            showToast('Fill in at least 5 complete question/answer pairs with points > 0', 'warning');
            return;
        }

        const saveBtn = document.getElementById('manual-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            await API.updateQuestions(State.currentGameId, catId, questionsToSave);
            const game = await API.getGame(State.currentGameId);
            State.game = game;
            renderCategoryList(game);
            renderAdminStats(game);
            dialog.remove();
            showToast(`✅ Saved ${questionsToSave.length} questions for "${cat.name}"!`, 'success');
        } catch (e) {
            showToast('Save failed: ' + e.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Questions';
        }
    });
}

// Start game
$('#btn-start-game').addEventListener('click', async () => {
    showLoading('STARTING GAME...');
    try {
        const game = await API.startGame(State.currentGameId);
        State.game = game;
        showView('game');
        renderBoard(game);
        showToast("🎉 Game started! Let's play!", 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

// Reset game
$('#btn-reset-game').addEventListener('click', async () => {
    if (!confirm('Reset all scores and answered questions? This will restart the game from scratch.')) return;
    showLoading('RESETTING...');
    try {
        const game = await API.resetGame(State.currentGameId);
        State.game = game;
        renderAdminConsole(game);
        showToast('Game reset!', 'info');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

// ─── GAME BOARD ───────────────────────────────────────────────
function renderBoard(game) {
    $('#game-board-title').textContent = game.name.toUpperCase();

    const grid = $('#board-grid');
    const categories = game.categories;
    const numCols = categories.length;

    // Get all unique point values sorted
    const allValues = [...new Set(
        categories.flatMap(c => c.questions.map(q => q.value))
    )].sort((a, b) => a - b);

    // Set CSS grid columns
    grid.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

    let html = '';

    // Header row — category names
    categories.forEach(cat => {
        html += `<div class="board-category-header">${escHtml(cat.name)}</div>`;
    });

    // Question rows grouped by value
    allValues.forEach(val => {
        categories.forEach(cat => {
            // Find the first unanswered question with this value, or the first answered one
            const q = cat.questions.find(q => q.value === val);
            if (q) {
                const answered = q.answered ? 'answered' : '';
                html += `
          <div class="board-tile ${answered}" 
               data-cat-id="${cat.id}" 
               data-q-id="${q.id}"
               ${!q.answered ? `onclick="openQuestionModal('${cat.id}','${q.id}')"` : ''}>
            <span class="tile-value">${q.answered ? '' : '$' + val}</span>
          </div>`;
            } else {
                html += `<div class="board-tile answered"><span class="tile-value"></span></div>`;
            }
        });
    });

    grid.innerHTML = html;

    renderScoreboard(game);
    updateProgress(game);
}

function renderScoreboard(game) {
    const sorted = [...game.players].sort((a, b) => b.score - a.score);
    const maxScore = Math.max(...sorted.map(p => p.score), 1);
    const board = $('#scoreboard');

    board.innerHTML = sorted.map((p, i) => `
    <div class="score-card ${i === 0 && p.score > 0 ? 'leading' : ''}" data-player-id="${p.id}">
      <div class="score-card-top">
        <span class="score-player-name">${i === 0 && p.score > 0 ? '👑 ' : ''}${escHtml(p.name)}</span>
        <span class="score-value">$${p.score.toLocaleString()}</span>
      </div>
      <div class="score-bar-bg">
        <div class="score-bar-fill" style="width:${(p.score / maxScore) * 100}%"></div>
      </div>
    </div>
  `).join('');
}

function updateProgress(game) {
    const total = game.categories.reduce((s, c) => s + c.questions.length, 0);
    const answered = game.categories.reduce((s, c) => s + c.questions.filter(q => q.answered).length, 0);
    const pct = total > 0 ? (answered / total) * 100 : 0;

    $('#progress-bar').style.width = pct + '%';
    $('#progress-text').textContent = `${answered} / ${total}`;
}

// ─── QUESTION MODAL ───────────────────────────────────────────
function openQuestionModal(catId, qId) {
    const cat = State.game.categories.find(c => c.id === catId);
    const q = cat?.questions.find(q => q.id === qId);
    if (!q || q.answered) return;

    State.activeModal = { catId, qId };

    $('#modal-cat-name').textContent = cat.name.toUpperCase();
    $('#modal-value').textContent = '$' + q.value;
    $('#modal-question').textContent = q.question;
    $('#modal-answer-text').textContent = q.answer;
    $('#modal-answer-reveal').classList.remove('visible');

    // Player buttons
    const grid = $('#player-award-grid');
    grid.innerHTML = State.game.players.map(p => {
        const hasGuessedWrong = (q.wrongAnswers || []).includes(p.id);
        return `
    <div class="player-award-card" data-player-id="${p.id}">
      <div class="award-avatar">${initials(p.name)}</div>
      <div class="award-name">${escHtml(p.name)}</div>
      <div class="award-score">$${p.score.toLocaleString()}</div>
      <div class="award-actions">
          <button class="btn btn-primary" onclick="awardPoints('${p.id}')" title="Correct">✅</button>
          <button class="btn btn-danger" onclick="deductPoints('${p.id}')" ${hasGuessedWrong ? 'disabled' : ''} title="Wrong">❌</button>
      </div>
    </div>
  `}).join('');

    $('#question-modal').classList.add('open');
}

function closeModal() {
    $('#question-modal').classList.remove('open');
    State.activeModal = null;
}

$('#modal-close-btn').addEventListener('click', closeModal);

$('#btn-reveal-answer').addEventListener('click', () => {
    $('#modal-answer-reveal').classList.add('visible');
});

async function awardPoints(playerId) {
    const { catId, qId } = State.activeModal;
    const cat = State.game.categories.find(c => c.id === catId);
    const q = cat?.questions.find(q => q.id === qId);
    if (!q) return;

    const player = State.game.players.find(p => p.id === playerId);

    // Animate score fly from the player card
    const card = $(`.player-award-card[data-player-id="${playerId}"]`);
    if (card) {
        const rect = card.getBoundingClientRect();
        animateScoreFly(rect.left + rect.width / 2, rect.top, q.value);
    }

    closeModal();

    try {
        const updatedGame = await API.awardPoints(State.currentGameId, qId, playerId, catId);
        State.game = updatedGame;

        renderBoard(updatedGame);
        showToast(`+$${q.value} awarded to ${player?.name || 'player'}!`, 'success');

        if (updatedGame.status === 'completed') {
            setTimeout(() => {
                showView('complete');
                renderCompleteView(updatedGame);
            }, 800);
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deductPoints(playerId) {
    const { catId, qId } = State.activeModal;
    const cat = State.game.categories.find(c => c.id === catId);
    const q = cat?.questions.find(q => q.id === qId);
    if (!q) return;

    const player = State.game.players.find(p => p.id === playerId);

    // Disable the button to prevent double-clicks instantly
    const card = $(`.player-award-card[data-player-id="${playerId}"]`);
    if (card) {
        const wrongBtn = card.querySelector('.btn-danger');
        if (wrongBtn) wrongBtn.disabled = true;
    }

    closeModal();

    try {
        const updatedGame = await API.deductPoints(State.currentGameId, qId, playerId, catId);
        State.game = updatedGame;

        renderBoard(updatedGame);
        showToast(`-$${q.value} deducted from ${player?.name || 'player'}.`, 'warning');

        if (updatedGame.status === 'completed') {
            setTimeout(() => {
                showView('complete');
                renderCompleteView(updatedGame);
            }, 800);
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

$('#btn-skip-question').addEventListener('click', async () => {
    const { catId, qId } = State.activeModal || {};
    if (!catId || !qId) return;
    closeModal();

    try {
        const updatedGame = await API.skipQuestion(State.currentGameId, qId, catId);
        State.game = updatedGame;
        renderBoard(updatedGame);
        showToast('Question skipped', 'info');

        if (updatedGame.status === 'completed') {
            setTimeout(() => {
                showView('complete');
                renderCompleteView(updatedGame);
            }, 800);
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
});

// Close modal on overlay click
$('#question-modal').addEventListener('click', (e) => {
    if (e.target === $('#question-modal')) closeModal();
});

// ─── GAME CONTROLS ────────────────────────────────────────────
$('#btn-pause-game').addEventListener('click', async () => {
    try {
        await API.pauseGame(State.currentGameId);
        showToast('Game paused and saved!', 'info');
        goHome();
    } catch (e) {
        showToast(e.message, 'error');
    }
});

$('#btn-back-admin').addEventListener('click', async () => {
    if (!confirm('Go back to admin console? The game state will be preserved.')) return;
    await openAdminConsole(State.currentGameId);
});

// ─── COMPLETE VIEW ────────────────────────────────────────────
function renderCompleteView(game) {
    const sorted = [...game.players].sort((a, b) => b.score - a.score);

    const winner = sorted[0];
    if (winner) {
        $('#complete-winner-text').textContent = `🎉 ${winner.name} wins with $${winner.score.toLocaleString()}!`;

        if (window.confetti) {
            confetti({
                particleCount: 150,
                spread: 100,
                origin: { y: 0.6 },
                colors: ['#ffd700', '#4f8ef7', '#10b981', '#f43f5e']
            });
        }
    }

    const rankEmojis = ['🥇', '🥈', '🥉'];
    const rankClasses = ['rank-1', 'rank-2', 'rank-3'];

    $('#final-scores').innerHTML = sorted.map((p, i) => `
    <div class="final-score-card ${i === 0 ? 'first' : ''} slide-up">
      <div class="final-rank ${rankClasses[i] || ''}">
        ${rankEmojis[i] || `#${i + 1}`}
      </div>
      <div class="final-player-name">${escHtml(p.name)}</div>
      <div class="final-score-value">$${p.score.toLocaleString()}</div>
    </div>
  `).join('');
}

$('#btn-play-again').addEventListener('click', async () => {
    if (!confirm('Reset this game and play again?')) return;
    showLoading('RESETTING...');
    try {
        const game = await API.resetGame(State.currentGameId);
        State.game = game;
        await openAdminConsole(State.currentGameId);
        showToast('Game reset! Ready to play again.', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

$('#btn-home-complete').addEventListener('click', goHome);

// ─── Initial Setup ────────────────────────────────────────────
$('#btn-new-game').addEventListener('click', createNewGame);
$('#logo-home-btn').addEventListener('click', (e) => { e.preventDefault(); goHome(); });

// ─── Google SSO Authentication ───────────────────────────────
function handleCredentialResponse(response) {
    if (response.credential) {
        localStorage.setItem('admin_token', response.credential);
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        
        $('#google-signin-container').style.display = 'none';
        $('#btn-new-game').style.display = 'inline-flex';
        
        $('#admin-user-info').style.display = 'flex';
        $('#admin-email-display').textContent = payload.email;
        
        showToast('Logged in as Admin: ' + payload.email, 'success');
        loadHomeView(); // Refresh to show New Game button in empty state
    }
}

$('#btn-admin-logout').addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    $('#admin-user-info').style.display = 'none';
    $('#google-signin-container').style.display = 'flex';
    $('#btn-new-game').style.display = 'none';
    showToast('Signed out', 'info');
    goHome();
});

window.handleCredentialResponse = handleCredentialResponse;

function restoreSession() {
    const token = localStorage.getItem('admin_token');
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload.exp * 1000 > Date.now()) {
                $('#google-signin-container').style.display = 'none';
                $('#btn-new-game').style.display = 'inline-flex';
                $('#admin-user-info').style.display = 'flex';
                $('#admin-email-display').textContent = payload.email;
            } else {
                localStorage.removeItem('admin_token');
            }
        } catch(e) {
            localStorage.removeItem('admin_token');
        }
    }
}

// Init: load home
(async function init() {
    try {
        const config = await API.getConfig();
        if (config.googleClientId && window.google) {
            google.accounts.id.initialize({
                client_id: config.googleClientId,
                callback: handleCredentialResponse
            });
            google.accounts.id.renderButton(
                $('#google-signin-btn'),
                { theme: "outline", size: "large", type: "standard" }
            );
        }
    } catch (e) {
        console.error('Failed to load Google Client config', e);
    }

    restoreSession();
    showView('home');
    await loadHomeView();
})();
