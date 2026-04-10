export const API = {
    base: import.meta.env.PROD ? '/api' : 'http://localhost:3000/api',

    getCsrfToken() {
        if (typeof document === 'undefined') return null;
        const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    },

    async request(method, path, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        };
        const csrfToken = this.getCsrfToken();
        if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
            opts.headers['X-CSRF-Token'] = csrfToken;
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

    createSession: (token) => API.post('/auth/session', { token }),
    getSession: () => API.get('/auth/session'),
    logoutSession: () => API.post('/auth/logout'),
    getOwnerDashboardV1: (days = 30) => API.get(`/owner/dashboard-v1?days=${encodeURIComponent(days)}`),

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
    renameCategory: (gid, cid, name) => API.put(`/games/${gid}/categories/${cid}`, { name }),
    removeCategory: (gid, cid) => API.del(`/games/${gid}/categories/${cid}`),
    updateQuestions: (gid, cid, questions) => API.put(`/games/${gid}/categories/${cid}/questions`, { questions }),
    importQuestionsToCategory: (gid, cid, questionIds) => API.post(`/games/${gid}/categories/${cid}/import-questions`, { questionIds }),
    importBestMatchesToCategory: (gid, cid, limit = 5) => API.post(`/games/${gid}/categories/${cid}/import-best-matches`, { limit }),

    // AI
    generateQuestions: (gid, categoryId, hint, difficulty) => API.post(`/games/${gid}/generate-questions`, { categoryId, hint, difficulty }),
    getConfig: () => API.get('/config'),

    // Question bank
    listQuestionBank: ({ category = '', search = '', limit = 100, skip = 0 } = {}) => {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        if (search) params.set('search', search);
        params.set('limit', String(limit));
        params.set('skip', String(skip));
        return API.get(`/questionbank?${params.toString()}`);
    },
    createQuestionBankQuestion: (categoryName, question, answer, value) => API.post('/questionbank', { categoryName, question, answer, value }),
    deleteQuestionBankQuestion: (questionId) => API.del(`/questionbank/${questionId}`),
    backfillQuestionBank: () => API.post('/questionbank/backfill'),
    downloadQuestionBankExcel: async () => {
        const res = await fetch(`${API.base}/questionbank/export`, { method: 'GET', credentials: 'include' });

        if (!res.ok) {
            let data = null;
            try { data = await res.json(); } catch (e) { data = null; }
            throw new Error(data?.error || 'Failed to export question bank');
        }

        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') || '';
        const filenameMatch = disposition.match(/filename="?([^\"]+)"?/i);
        const filename = filenameMatch?.[1] || 'question-bank.xlsx';

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    },

    // Gameplay
    startGame: (id) => API.post(`/games/${id}/start`),
    pauseGame: (id) => API.post(`/games/${id}/pause`),
    resetGame: (id) => API.post(`/games/${id}/reset`),
    endGame: (id) => API.post(`/games/${id}/end`),
    awardPoints: (id, questionId, playerId, categoryId) => API.post(`/games/${id}/award`, { questionId, playerId, categoryId }),
    deductPoints: (id, questionId, playerId, categoryId) => API.post(`/games/${id}/deduct`, { questionId, playerId, categoryId }),
    skipQuestion: (id, questionId, categoryId) => API.post(`/games/${id}/skip`, { questionId, categoryId }),
    resetQuestion: (id, questionId, categoryId) => API.post(`/games/${id}/reset-question`, { questionId, categoryId }),

    // Final Jeopardy
    finalJeopardySetup: (id, question, answer, wagers) => API.post(`/games/${id}/final-jeopardy`, { question, answer, wagers }),
    finalJeopardyResolve: (id, correct, wrong) => API.post(`/games/${id}/final-jeopardy/resolve`, { correct, wrong }),
};
