export const API = {
    base: import.meta.env.PROD ? '/api' : 'http://localhost:3000/api',

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
        console.debug('API request', method, this.base + path, body);
        const res = await fetch(this.base + path, opts);
        let data;
        try { data = await res.json(); } catch (e) { data = null; }
        console.debug('API response', res.status, data);
        if (!res.ok) throw new Error(data?.error || 'Request failed');
        return data;
    },

    get: (p) => API.request('GET', p),
    post: (p, b) => API.request('POST', p, b),
    put: (p, b) => API.request('PUT', p, b),
    del: (p) => API.request('DELETE', p),

    listGames: () => API.get('/games'),
    createGame: (name, playerMode) => API.post('/games', { name, playerMode }),
    getGame: (id) => API.get(`/games/${id}`),
    getPublicGame: (id) => API.get(`/public/games/${id}`),
    getJoinGame: (code, playerName) => API.get(`/join/${code}${playerName ? `?playerName=${encodeURIComponent(playerName)}` : ''}`),
    updateGame: (id, data) => API.put(`/games/${id}`, data),
    deleteGame: (id) => API.del(`/games/${id}`),
    cloneGame: (id, name) => API.post(`/games/${id}/clone`, { name }),
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

    // Gameplay
    startGame: (id) => API.post(`/games/${id}/start`),
    pauseGame: (id) => API.post(`/games/${id}/pause`),
    resetGame: (id) => API.post(`/games/${id}/reset`),
    awardPoints: (id, questionId, playerId, categoryId) => API.post(`/games/${id}/award`, { questionId, playerId, categoryId }),
    deductPoints: (id, questionId, playerId, categoryId) => API.post(`/games/${id}/deduct`, { questionId, playerId, categoryId }),
    skipQuestion: (id, questionId, categoryId) => API.post(`/games/${id}/skip`, { questionId, categoryId }),
    resetQuestion: (id, questionId, categoryId) => API.post(`/games/${id}/reset-question`, { questionId, categoryId }),

    // Final Jeopardy
    finalJeopardySetup: (id, question, answer, wagers) => API.post(`/games/${id}/final-jeopardy`, { question, answer, wagers }),
    finalJeopardyResolve: (id, correct, wrong) => API.post(`/games/${id}/final-jeopardy/resolve`, { correct, wrong }),
};
