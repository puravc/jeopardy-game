require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');
const Anthropic = require('@anthropic-ai/sdk');
const { OAuth2Client } = require('google-auth-library');
const { WebSocketServer } = require('ws');

// Generate a short, human-readable join code
function generateJoinCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// Simple request logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// =====================
// MongoDB Setup
// =====================
let db;

async function connectDB() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set in .env');
    const client = new MongoClient(uri);
    await client.connect();
    db = client.db('jeopardy');
    console.log('✅ Connected to MongoDB');
}

function gamesCol() {
    return db.collection('games');
}

// =====================
// Claude (Anthropic) AI Setup
// =====================
function getAI() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || key === 'your_anthropic_api_key_here') return null;
    return new Anthropic({ apiKey: key });
}

// =====================
// Google OAuth Setup
// =====================
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const requireAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        req.user = payload;
        
        // Check allowed emails if ADMIN_EMAILS is set
        const allowedEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()) : [];
        if (allowedEmails.length > 0 && !allowedEmails.includes(payload.email.toLowerCase())) {
            return res.status(403).json({ error: 'Forbidden: You are not authorized to be an admin.' });
        }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// =====================
// API Routes
// =====================

// Apply auth to all /api/games routes
app.use('/api/games', requireAdmin);

// Admin-only routes
// GET /api/config — Return API key status
app.get('/api/config', (req, res) => {
    res.json({ hasApiKey: !!getAI(), googleClientId: process.env.GOOGLE_CLIENT_ID });
});

// GET /api/games — List all games (summary only, filtered by owner)
app.get('/api/games', async (req, res) => {
    try {
        const games = await gamesCol()
            .find({ createdBy: req.user.email }, { projection: { id: 1, name: 1, status: 1, players: 1, categories: 1, createdAt: 1, updatedAt: 1 } })
            .sort({ updatedAt: -1 })
            .toArray();
        const summary = games.map(g => ({
            id: g.id,
            name: g.name,
            status: g.status,
            playerCount: g.players.length,
            categoryCount: g.categories.length,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
        }));
        res.json(summary);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games — Create new game
app.post('/api/games', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Game name is required' });
    const playerMode = req.body.playerMode === 'manual' ? 'manual' : 'self_register';
    const newGame = {
        id: uuidv4(),
        name: name.trim(),
        status: 'configuring',
        playerMode,
        joinCode: playerMode === 'self_register' ? generateJoinCode() : null,
        players: [],
        categories: [],
        createdBy: req.user.email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    try {
        await gamesCol().insertOne(newGame);
        res.status(201).json(newGame);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/games/:id — Get specific game
app.get('/api/games/:id', async (req, res) => {
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        res.json(game);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/public/games/:id — Public game snapshot for players
app.get('/api/public/games/:id', async (req, res) => {
    try {
        const game = await gamesCol().findOne(
            { id: req.params.id },
            { projection: { _id: 0, id: 1, name: 1, status: 1, playerMode: 1, players: 1, joinCode: 1, categories: 1, stats: 1, finalJeopardy: 1 } }
        );
        if (!game) return res.status(404).json({ error: 'Game not found' });
        res.json(game);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/games/:id — Update game fields
app.put('/api/games/:id', async (req, res) => {
    const allowed = ['name', 'players', 'categories', 'status'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updatedAt = new Date().toISOString();
    try {
        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: updates },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
        if (!result) return res.status(404).json({ error: 'Game not found' });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/games/:id — Delete game
app.delete('/api/games/:id', async (req, res) => {
    try {
        const result = await gamesCol().deleteOne({ id: req.params.id });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Game not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/players — Add player
app.post('/api/games/:id/players', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Player name is required' });
    const player = { id: uuidv4(), name: name.trim(), score: 0 };
    try {
        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $push: { players: player }, $set: { updatedAt: new Date().toISOString() } },
            { returnDocument: 'after' }
        );
        if (!result) return res.status(404).json({ error: 'Game not found' });
        res.status(201).json(player);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/games/:id/players/:playerId — Remove player
app.delete('/api/games/:id/players/:playerId', async (req, res) => {
    try {
        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $pull: { players: { id: req.params.playerId } }, $set: { updatedAt: new Date().toISOString() } },
            { returnDocument: 'after' }
        );
        if (!result) return res.status(404).json({ error: 'Game not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/categories — Add category
app.post('/api/games/:id/categories', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });
    const category = { id: uuidv4(), name: name.trim(), questions: [], generating: false };
    try {
        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $push: { categories: category }, $set: { updatedAt: new Date().toISOString() } },
            { returnDocument: 'after' }
        );
        if (!result) return res.status(404).json({ error: 'Game not found' });
        res.status(201).json(category);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/games/:id/categories/:catId — Remove category
app.delete('/api/games/:id/categories/:catId', async (req, res) => {
    try {
        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $pull: { categories: { id: req.params.catId } }, $set: { updatedAt: new Date().toISOString() } },
            { returnDocument: 'after' }
        );
        if (!result) return res.status(404).json({ error: 'Game not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/games/:id/categories/:catId/questions — Update questions
app.put('/api/games/:id/categories/:catId/questions', async (req, res) => {
    const { questions } = req.body;
    try {
        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id, 'categories.id': req.params.catId },
            { $set: { 'categories.$.questions': questions, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
        if (!result) return res.status(404).json({ error: 'Game or category not found' });
        const cat = result.categories.find(c => c.id === req.params.catId);
        res.json(cat);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/generate-questions — AI generate questions for a category
app.post('/api/games/:id/generate-questions', async (req, res) => {
    const { categoryId, hint, difficulty = 'medium' } = req.body;
    const openai = getAI();
    if (!openai) return res.status(400).json({ error: 'No Anthropic API key configured. Add ANTHROPIC_API_KEY to .env.' });

    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        const category = game.categories.find(c => c.id === categoryId);
        if (!category) return res.status(404).json({ error: 'Category not found' });

        const message = await openai.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 700,
            messages: [{
                role: 'user',
                content: `You are a Jeopardy game question writer. Return ONLY valid JSON arrays with no markdown, no extra text.

Generate exactly 5 Jeopardy-style questions for the category "${category.name}".
Difficulty Level: ${difficulty.toUpperCase()}
${hint ? `\nAdditional instructions from the host: ${hint}\n` : ''}
Point values (in order): 200, 400, 600, 800, 1000
The "question" is a clue/statement; the "answer" is what the contestant says.

Return ONLY a valid JSON array:
[{"value": 200, "question": "clue", "answer": "answer"}, ... 5 total]`
            }],
        });

        let jsonText = message.content[0].text.trim();
        if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();

        let parsed = JSON.parse(jsonText).map(q => ({
            id: uuidv4(), value: q.value, question: q.question, answer: q.answer, answered: false, answeredBy: null,
        }));

        // Ensure we only store up to 5 questions even if AI returns more
        const questions = parsed.slice(0, 5);

        await gamesCol().updateOne(
            { id: req.params.id, 'categories.id': categoryId },
            { $set: { 'categories.$.questions': questions, updatedAt: new Date().toISOString() } }
        );

        // Return the updated category back to the client
        const updatedGame = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        const updatedCategory = updatedGame.categories.find(c => c.id === categoryId);
        return res.json(updatedCategory);

    } catch (err) {
        console.error('Claude error:', err.message);
        res.status(500).json({ error: 'Failed to generate questions: ' + err.message });
    }
});

// POST /api/games/:id/start — Start the game
app.post('/api/games/:id/start', async (req, res) => {
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        if (game.players.length < 1) return res.status(400).json({ error: 'Add at least one player before starting' });
        if (game.categories.length < 1) return res.status(400).json({ error: 'Add at least one category before starting' });
        const missing = game.categories.filter(c => c.questions.length === 0);
        if (missing.length > 0) return res.status(400).json({ error: `Categories missing questions: ${missing.map(c => c.name).join(', ')}` });

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { status: 'active', updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
        const room = rooms.get(req.params.id);
        if (room) {
            broadcast(room, { type: 'game_status_update', status: updated.status });
            broadcast(room, { type: 'game_update', game: updated });
        }
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/pause — Pause the game
app.post('/api/games/:id/pause', async (req, res) => {
    try {
        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { status: 'paused', updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
        if (!updated) return res.status(404).json({ error: 'Game not found' });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/reset — Reset game
app.post('/api/games/:id/reset', async (req, res) => {
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const resetPlayers = game.players.map(p => ({ ...p, score: 0 }));
        const resetCategories = game.categories.map(cat => ({
            ...cat,
            questions: cat.questions.map(q => ({ ...q, answered: false, answeredBy: null })),
        }));

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { status: 'configuring', players: resetPlayers, categories: resetCategories, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        const room = rooms.get(req.params.id);
        if (room) {
            broadcast(room, { type: 'score_update', players: resetPlayers });
            broadcast(room, { type: 'game_status_update', status: 'configuring' });
            broadcast(room, { type: 'game_update', game: updated });
        }

        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/award — Award points
app.post('/api/games/:id/award', async (req, res) => {
    const { questionId, playerId, categoryId } = req.body;
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const cat = game.categories.find(c => c.id === categoryId);
        if (!cat) return res.status(404).json({ error: 'Category not found' });
        const q = cat.questions.find(q => q.id === questionId);
        if (!q) return res.status(404).json({ error: 'Question not found' });

        // Award points and mark answered. We allow overrides (re-awarding) if the host needs to fix a mistake.
        const updatedCategories = game.categories.map(c => ({
            ...c,
            questions: c.questions.map(qu => qu.id === questionId ? { ...qu, answered: true, answeredBy: playerId } : qu),
        }));
        
        // Always award points if the host clicks 'Right'. 
        // Note: If they award it twice to the same person, they get double points. That's a host choice.
        const updatedPlayers = game.players.map(p =>
            p.id === playerId ? { ...p, score: p.score + q.value } : p
        );

        const allAnswered = updatedCategories.every(c => c.questions.every(qu => qu.answered));
        const newStatus = allAnswered ? 'completed' : game.status;
        
        // Update stats
        const stats = game.stats || {};
        if (!stats[playerId]) stats[playerId] = { answered: 0, attempted: 0, totalEarned: 0 };
        stats[playerId].attempted += 1;
        stats[playerId].answered += 1;
        stats[playerId].totalEarned += q.value;

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { categories: updatedCategories, players: updatedPlayers, status: newStatus, stats: stats, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        const room = rooms.get(req.params.id);
        if (room) {
            broadcast(room, {
                type: 'score_update',
                players: updatedPlayers,
                event: { type: 'award', playerId, amount: q.value }
            });
            broadcast(room, { type: 'game_update', game: updated });
            if (newStatus === 'completed') {
                broadcast(room, { type: 'game_status_update', status: 'completed' });
            }
        }

        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// POST /api/games/:id/deduct — Deduct points for wrong answer
app.post('/api/games/:id/deduct', async (req, res) => {
    const { questionId, playerId, categoryId } = req.body;
    console.log(`POST /api/games/${req.params.id}/deduct`, { questionId, playerId, categoryId });
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const cat = game.categories.find(c => c.id === categoryId);
        if (!cat) return res.status(404).json({ error: 'Category not found' });
        const q = cat.questions.find(q => q.id === questionId);
        if (!q) return res.status(404).json({ error: 'Question not found' });

        // We allow the host to deduct even if already guessed wrong (override).
        // if (q.answered) return res.status(400).json({ error: 'Question already answered correctly' });

        // Deduct points. IMPORTANT: in Jeopardy, a wrong answer does NOT close the question.
        const updatedCategories = game.categories.map(c => ({
            ...c,
            questions: c.questions.map(qu => qu.id === questionId ? { 
                ...qu, 
                answered: false, 
                wrongAnswers: qu.wrongAnswers?.includes(playerId) ? qu.wrongAnswers : [...(qu.wrongAnswers || []), playerId] 
            } : qu),
        }));

        const newStatus = game.status;

        const updatedPlayers = game.players.map(p =>
            p.id === playerId ? { ...p, score: p.score - q.value } : p
        );
        
        // Update stats 
        const stats = game.stats || {};
        if (!stats[playerId]) stats[playerId] = { answered: 0, attempted: 0, totalEarned: 0 };
        stats[playerId].attempted += 1;
        stats[playerId].totalEarned -= q.value;

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { categories: updatedCategories, players: updatedPlayers, status: newStatus, stats: stats, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        const room = rooms.get(req.params.id);
        if (room) {
            // Remove the player who just guessed wrong from the buzzer queue
            room.buzzerQueue = room.buzzerQueue.filter(b => b.playerId !== playerId);
            
            broadcast(room, {
                type: 'score_update',
                players: updatedPlayers,
                event: { type: 'deduct', playerId, amount: -q.value }
            });
            broadcast(room, { type: 'game_update', game: updated });
            
            // Sync the updated buzzer queue
            broadcast(room, { type: 'buzzer_update', queue: room.buzzerQueue });
        }

        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// POST /api/games/:id/skip — Skip a question
app.post('/api/games/:id/skip', async (req, res) => {
    const { questionId, categoryId } = req.body;
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const updatedCategories = game.categories.map(c => ({
            ...c,
            questions: c.questions.map(q => q.id === questionId ? { ...q, answered: true, answeredBy: null } : q),
        }));
        const allAnswered = updatedCategories.every(c => c.questions.every(q => q.answered));
        const newStatus = allAnswered ? 'completed' : game.status;

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { categories: updatedCategories, status: newStatus, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        const room = rooms.get(req.params.id);
        if (room) {
            broadcast(room, {
                type: 'score_update',
                players: game.players // Scores don't change on skip, but keeps state in sync
            });
            broadcast(room, { type: 'game_update', game: updated });
            if (newStatus === 'completed') {
                broadcast(room, { type: 'game_status_update', status: 'completed' });
            }
        }

        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/reset-question — Reset wrong guesses for a question
app.post('/api/games/:id/reset-question', async (req, res) => {
    const { questionId, categoryId } = req.body;
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const updatedCategories = game.categories.map(c => ({
            ...c,
            questions: c.questions.map(q => q.id === questionId ? { ...q, wrongAnswers: [] } : q),
        }));

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { categories: updatedCategories, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/clone — Clone a game
app.post('/api/games/:id/clone', async (req, res) => {
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        
        const newName = req.body.name || `${game.name} (Copy)`;
        const newId = uuidv4();
        
        // Deep copy categories, resetting answered state
        const clonedCategories = game.categories.map(c => ({
            ...c,
            id: uuidv4(),
            questions: c.questions.map(q => ({
                ...q,
                id: uuidv4(),
                answered: false,
                answeredBy: null,
                wrongAnswers: []
            }))
        }));

        const newGame = {
            id: newId,
            name: newName,
            status: 'configuring',
            playerMode: game.playerMode,
            joinCode: game.playerMode === 'self_register' ? generateJoinCode() : null,
            players: [],
            categories: clonedCategories,
            createdBy: req.user.email,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            stats: {}
        };

        await gamesCol().insertOne(newGame);
        res.status(201).json(newGame);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/final-jeopardy — Setup final jeopardy
app.post('/api/games/:id/final-jeopardy', async (req, res) => {
    const { question, answer, wagers } = req.body;
    if (!question || !answer || !wagers) return res.status(400).json({ error: 'Missing req details' });
    try {
        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { 
                $set: { 
                    finalJeopardy: { active: true, question, answer, wagers },
                    updatedAt: new Date().toISOString()
                }
            },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/final-jeopardy/resolve — Resolve final jeopardy
app.post('/api/games/:id/final-jeopardy/resolve', async (req, res) => {
    const { correct, wrong } = req.body; // Arrays of player IDs
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game || !game.finalJeopardy) return res.status(404).json({ error: 'Game/FJ not found' });

        const wagers = game.finalJeopardy.wagers;
        const updatedPlayers = game.players.map(p => {
            const wager = wagers[p.id] || 0;
            if (correct.includes(p.id)) return { ...p, score: p.score + wager };
            if (wrong.includes(p.id)) return { ...p, score: Math.max(0, p.score - wager) };
            return p;
        });
        
        // Calculate point diff for stats
        const stats = game.stats || {};
        updatedPlayers.forEach(p => {
            if (!stats[p.id]) stats[p.id] = { answered: 0, attempted: 0, totalEarned: 0 };
            const oldScore = game.players.find(oldP => oldP.id === p.id)?.score || 0;
            const diff = p.score - oldScore;
            
            // Mark attempt
            if (correct.includes(p.id) || wrong.includes(p.id)) {
                stats[p.id].attempted += 1;
            }
            if (correct.includes(p.id)) {
                stats[p.id].answered += 1;
                stats[p.id].totalEarned += diff;
            } else if (wrong.includes(p.id) && diff < 0) {
                stats[p.id].totalEarned += diff; // it's negative, so subtracting
            }
        });

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { 
                $set: { 
                    players: updatedPlayers,
                    status: 'completed',
                    'finalJeopardy.active': false,
                    'finalJeopardy.complete': true,
                    stats: stats,
                    updatedAt: new Date().toISOString()
                }
            },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        const room = rooms.get(req.params.id);
        if (room) {
            broadcast(room, {
                type: 'score_update',
                players: updatedPlayers
            });
            broadcast(room, { type: 'game_update', game: updated });
            broadcast(room, { type: 'game_status_update', status: 'completed' });
        }

        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/join/:code — public player lookup by join code
app.get('/api/join/:code', async (req, res) => {
    try {
        const game = await db.collection('games').findOne(
            { joinCode: req.params.code.toUpperCase() },
            { projection: { _id: 0, id: 1, name: 1, joinCode: 1, players: 1, status: 1 } }
        );
        if (!game) return res.status(404).json({ error: 'Game not found. Check your code.' });

        // Allow existing players to re-lookup the game after it starts
        const existingPlayerName = req.query.playerName;
        if (game.status !== 'configuring') {
            if (existingPlayerName) {
                const isExisting = game.players?.some(p => p.name.toLowerCase() === existingPlayerName.trim().toLowerCase());
                if (isExisting) {
                    return res.json(game);
                }
            }
            return res.status(403).json({ error: 'This game has already started. No new players can join.' });
        }
        res.json(game);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// =====================
// WebSocket Buzzer Server
// =====================
// rooms: gameId -> { hostWs, players: Map<playerId, {ws, name}>, buzzerQueue: [], questionOpen: false }
const rooms = new Map();

function getOrCreateRoom(gameId) {
    if (!rooms.has(gameId)) {
        rooms.set(gameId, { hostWs: null, players: new Map(), buzzerQueue: [], questionOpen: false });
    }
    return rooms.get(gameId);
}

function broadcast(room, data) {
    const msg = JSON.stringify(data);
    if (room.hostWs && room.hostWs.readyState === 1) room.hostWs.send(msg);
    room.players.forEach(p => { if (p.ws.readyState === 1) p.ws.send(msg); });
}

async function broadcastPlayerList(gameId) {
    const room = rooms.get(gameId);
    if (!room) return;
    const game = await db.collection('games').findOne({ id: gameId }, { projection: { players: 1 } });
    const players = game?.players || [];
    broadcast(room, { type: 'player_list', players });
}

// Start server
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
    let assignedGameId = null;
    let assignedPlayerId = null;
    let isHost = false;

    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const { type, gameId, playerName, playerId } = msg;

        if (type === 'host_join') {
            assignedGameId = gameId;
            isHost = true;
            const room = getOrCreateRoom(gameId);
            room.hostWs = ws;
            ws.send(JSON.stringify({ type: 'host_joined', gameId }));
            await broadcastPlayerList(gameId);
        }

        else if (type === 'player_join') {
            if (!playerName || !playerName.trim()) {
                ws.send(JSON.stringify({ type: 'error', message: 'Player name is required.' }));
                return;
            }

            // Look up game and enforce join-lock after game starts
            const game = await db.collection('games').findOne({ id: gameId }, { projection: { status: 1, playerMode: 1, players: 1 } });
            if (!game) {
                ws.send(JSON.stringify({ type: 'error', message: 'Game not found.' }));
                return;
            }

            // Allow existing players to reconnect regardless of game status
            const existingRosterPlayer = game.players?.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase());
            if (game.status !== 'configuring' && !existingRosterPlayer) {
                ws.send(JSON.stringify({ type: 'error', message: 'This game has already started. You can no longer join.' }));
                return;
            }

            assignedGameId = gameId;

            // Check if player with this name already exists (re-join)
            const existingPlayer = game.players?.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase());
            
            if (existingPlayer) {
                assignedPlayerId = existingPlayer.id;
                console.log(`Player re-join: ${playerName.trim()} (${assignedPlayerId})`);
            } else {
                assignedPlayerId = uuidv4();
                const newPlayer = { id: assignedPlayerId, name: playerName.trim(), score: 0 };
                // Persist player to MongoDB
                await db.collection('games').updateOne(
                    { id: gameId },
                    { $push: { players: newPlayer }, $set: { updatedAt: new Date().toISOString() } }
                );
                console.log(`New player joined: ${playerName.trim()} (${assignedPlayerId})`);
            }

            const room = getOrCreateRoom(gameId);
            room.players.set(assignedPlayerId, { ws, name: playerName.trim(), id: assignedPlayerId });
            ws.send(JSON.stringify({ type: 'player_joined', playerId: assignedPlayerId, gameId,
                questionOpen: room.questionOpen,
                timeoutAt: room.timeoutAt || null }));

            // Refresh full player list from DB and broadcast
            const updatedGame = await db.collection('games').findOne({ id: gameId }, { projection: { players: 1 } });
            const allPlayers = updatedGame?.players || [];
            // Broadcast both WS player list and a 'game_players_update' for the host UI
            await broadcastPlayerList(gameId);
            if (room.hostWs && room.hostWs.readyState === 1) {
                room.hostWs.send(JSON.stringify({ type: 'game_players_update', players: allPlayers }));
            }
        }


        else if (type === 'open_question') {
            const room = rooms.get(gameId);
            if (!room) return;
            room.buzzerQueue = [];
            room.questionOpen = true;
            room.timeoutAt = Date.now() + 15000;
            broadcast(room, { type: 'question_open', timeoutAt: room.timeoutAt });
        }

        else if (type === 'close_question') {
            const room = rooms.get(gameId);
            if (!room) return;
            room.questionOpen = false;
            broadcast(room, { type: 'question_closed' });
        }

        else if (type === 'buzz') {
            const room = rooms.get(gameId);
            if (!room || !room.questionOpen) return;
            const buzzerIdentifier = playerId || playerName?.trim().toLowerCase();
            if (!buzzerIdentifier) return;

            // prevent double-buzz from the same player, even if a join id is not ready yet
            if (room.buzzerQueue.some(b => (b.playerId || b.name?.trim().toLowerCase()) === buzzerIdentifier)) return;
            const resolvedName = playerName || room.players.get(playerId)?.name || 'Unknown player';
            const buzzEntry = { playerId, name: resolvedName, time: Date.now() };
            room.buzzerQueue.push(buzzEntry);
            broadcast(room, { type: 'buzz', buzz: buzzEntry, queue: room.buzzerQueue });
            broadcast(room, { type: 'buzzer_update', queue: room.buzzerQueue });
        }
    });

    ws.on('close', async () => {
        if (!assignedGameId) return;
        const room = rooms.get(assignedGameId);
        if (!room) return;
        if (isHost) {
            room.hostWs = null;
        } else if (assignedPlayerId) {
            room.players.delete(assignedPlayerId);
            // Remove from DB if game is still configuring (pre-start)
            try {
                const game = await db.collection('games').findOne({ id: assignedGameId }, { projection: { status: 1 } });
                if (game && game.status === 'configuring') {
                    await db.collection('games').updateOne(
                        { id: assignedGameId },
                        { $pull: { players: { id: assignedPlayerId } } }
                    );
                    const updated = await db.collection('games').findOne({ id: assignedGameId }, { projection: { players: 1 } });
                    if (room.hostWs && room.hostWs.readyState === 1) {
                        room.hostWs.send(JSON.stringify({ type: 'game_players_update', players: updated?.players || [] }));
                    }
                }
            } catch(e) { /* non-fatal */ }
            await broadcastPlayerList(assignedGameId);
        }
    });
});

// Serve React index.html for all other routes (Client-side routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

connectDB().then(() => {
    httpServer.listen(PORT, () => {
        console.log(`\n🎯 Jeopardy Game Server running at http://localhost:${PORT}`);
        const hasKey = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here';
        console.log(`🤖 Claude AI: ${hasKey ? '✅ Configured' : '❌ No API key — add ANTHROPIC_API_KEY to .env'}`)
        console.log(`🔔 WebSocket Buzzer: ✅ Ready\n`);
    });
}).catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    process.exit(1);
});
