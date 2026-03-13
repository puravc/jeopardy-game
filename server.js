require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
// API Routes
// =====================

// GET /api/config — Return API key status
app.get('/api/config', (req, res) => {
    res.json({ hasApiKey: !!getAI() });
});

// GET /api/games — List all games (summary only)
app.get('/api/games', async (req, res) => {
    try {
        const games = await gamesCol()
            .find({}, { projection: { id: 1, name: 1, status: 1, players: 1, categories: 1, createdAt: 1, updatedAt: 1 } })
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
    const newGame = {
        id: uuidv4(),
        name: name.trim(),
        status: 'configuring',
        players: [],
        categories: [],
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
            model: 'claude-haiku-4-5',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: `You are a Jeopardy game question writer. Return ONLY valid JSON arrays with no markdown, no extra text.

Generate exactly 10 Jeopardy-style questions for the category "${category.name}".
Difficulty Level: ${difficulty.toUpperCase()}
${hint ? `\nAdditional instructions from the host: ${hint}\n` : ''}
Point values (in order): 200, 400, 600, 800, 1000, 200, 400, 600, 800, 1000
The "question" is a clue/statement; the "answer" is what the contestant says.

Return ONLY a valid JSON array:
[{"value": 200, "question": "clue", "answer": "answer"}, ... 10 total]`
            }],
        });

        let jsonText = message.content[0].text.trim();
        if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();

        const questions = JSON.parse(jsonText).map(q => ({
            id: uuidv4(), value: q.value, question: q.question, answer: q.answer, answered: false, answeredBy: null,
        }));

        await gamesCol().updateOne(
            { id: req.params.id, 'categories.id': categoryId },
            { $set: { 'categories.$.questions': questions, updatedAt: new Date().toISOString() } }
        );

        res.json({ questions });
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

        // Award points and mark answered
        const updatedCategories = game.categories.map(c => ({
            ...c,
            questions: c.questions.map(qu => qu.id === questionId ? { ...qu, answered: true, answeredBy: playerId } : qu),
        }));
        const updatedPlayers = game.players.map(p =>
            p.id === playerId && !q.answered ? { ...p, score: p.score + q.value } : p
        );

        const allAnswered = updatedCategories.every(c => c.questions.every(qu => qu.answered));
        const newStatus = allAnswered ? 'completed' : game.status;

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { categories: updatedCategories, players: updatedPlayers, status: newStatus, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
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
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Catch-all → serve SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🎯 Jeopardy Game Server running at http://localhost:${PORT}`);
        const hasKey = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here';
        console.log(`🤖 Claude AI: ${hasKey ? '✅ Configured' : '❌ No API key — add ANTHROPIC_API_KEY to .env'}\n`);
    });
}).catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    process.exit(1);
});
