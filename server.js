require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');
const XLSX = require('xlsx');
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
const SESSION_COOKIE_NAME = 'admin_token';
const CSRF_COOKIE_NAME = 'csrf_token';
const isProduction = process.env.NODE_ENV === 'production';

const sessionCookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 1000,
};

const csrfCookieOptions = {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 1000,
};

const defaultAllowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const allowedOrigins = configuredOrigins.length ? configuredOrigins : defaultAllowedOrigins;

function isSameOrigin(origin, req) {
    try {
        const originUrl = new URL(origin);
        const forwardedHost = req.get('x-forwarded-host');
        const host = (forwardedHost || req.get('host') || '').split(',')[0].trim();
        const forwardedProto = req.get('x-forwarded-proto');
        const protocol = ((forwardedProto || req.protocol || 'http').split(',')[0].trim()).replace(/:$/, '');
        return originUrl.host === host && originUrl.protocol === `${protocol}:`;
    } catch {
        return false;
    }
}

const corsOptions = { credentials: true };

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.API_RATE_LIMIT_MAX) || 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

const joinLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: Number(process.env.JOIN_RATE_LIMIT_MAX) || 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many join attempts, please try again shortly.' },
});

// Middleware
app.set('trust proxy', 1);
app.use((req, res, next) => {
    cors({
        ...corsOptions,
        origin(origin, callback) {
            // Allow non-browser requests and same-origin requests.
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) return callback(null, true);
            if (isSameOrigin(origin, req)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
    })(req, res, next);
});
app.use(helmet({
    contentSecurityPolicy: false,
    // Google Sign-In popup requires opener relationship to remain available.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// Simple request logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.use('/api', apiLimiter);
app.use('/api/join', joinLimiter);

function parseCookieHeader(cookieHeader = '') {
    const parsed = {};
    for (const pair of cookieHeader.split(';')) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = decodeURIComponent(trimmed.slice(0, idx));
        const value = decodeURIComponent(trimmed.slice(idx + 1));
        parsed[key] = value;
    }
    return parsed;
}

function createCsrfToken() {
    return crypto.randomBytes(24).toString('hex');
}

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
    await ensureIndexes();
    console.log('✅ Connected to MongoDB');
}

function gamesCol() {
    return db.collection('games');
}

function questionBankCol() {
    return db.collection('question_bank');
}

function normalizeCategoryName(name) {
    return (name || '').trim().toLowerCase();
}

function buildQuestionFingerprint(categoryName, question, answer, value) {
    const payload = [
        normalizeCategoryName(categoryName),
        (question || '').trim().toLowerCase(),
        (answer || '').trim().toLowerCase(),
        String(Number(value) || 0),
    ].join('||');
    return crypto.createHash('sha256').update(payload).digest('hex');
}

async function ensureIndexes() {
    await questionBankCol().createIndex({ id: 1 }, { unique: true });
    await questionBankCol().createIndex({ fingerprint: 1 }, { unique: true });
    await questionBankCol().createIndex({ categoryKey: 1, createdAt: -1 });
    await questionBankCol().createIndex({ createdAt: -1 });
}

async function upsertQuestionsToBank({ questions, categoryName, sourceGameId = null, sourceType = 'unknown', createdBy = null }) {
    if (!Array.isArray(questions) || questions.length === 0) return { inserted: 0, updated: 0 };

    const now = new Date().toISOString();
    const category = (categoryName || '').trim();
    const categoryKey = normalizeCategoryName(categoryName);
    let inserted = 0;
    let updated = 0;

    for (const q of questions) {
        const clue = (q?.question || '').trim();
        const answer = (q?.answer || '').trim();
        const value = Number(q?.value) || 0;
        if (!clue || !answer || value <= 0) continue;

        const fingerprint = buildQuestionFingerprint(category, clue, answer, value);
        const existing = await questionBankCol().findOne({ fingerprint }, { projection: { _id: 1 } });

        if (existing) {
            await questionBankCol().updateOne(
                { _id: existing._id },
                {
                    $set: {
                        categoryName: category,
                        categoryKey,
                        question: clue,
                        answer,
                        value,
                        sourceGameId,
                        sourceType,
                        createdBy,
                        updatedAt: now,
                    },
                }
            );
            updated += 1;
        } else {
            await questionBankCol().insertOne({
                id: uuidv4(),
                categoryName: category,
                categoryKey,
                question: clue,
                answer,
                value,
                fingerprint,
                sourceGameId,
                sourceType,
                createdBy,
                usageCount: 0,
                createdAt: now,
                updatedAt: now,
            });
            inserted += 1;
        }
    }

    return { inserted, updated };
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

function getAllowedAdminEmails() {
    return process.env.ADMIN_EMAILS
        ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
        : [];
}

function getOwnerEmails() {
    if (process.env.OWNER_EMAILS) {
        return process.env.OWNER_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    }
    if (process.env.SUPER_ADMIN_EMAILS) {
        return process.env.SUPER_ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    }
    const allowedAdmins = getAllowedAdminEmails();
    return allowedAdmins.length ? [allowedAdmins[0]] : [];
}

async function verifyAdminIdToken(idToken) {
    const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase();
    if (!email) {
        throw new Error('Invalid token payload');
    }

    const allowedEmails = getAllowedAdminEmails();
    if (allowedEmails.length > 0 && !allowedEmails.includes(email)) {
        const err = new Error('Forbidden');
        err.code = 'FORBIDDEN';
        throw err;
    }

    return { ...payload, email };
}

function requireCsrfForMutations(req, res, next) {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
    if (req.path === '/auth/session') return next();

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'Forbidden: Invalid CSRF token' });
    }
    return next();
}

app.use('/api', requireCsrfForMutations);

const requireAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] || null;
    const token = bearerToken || cookieToken;

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    try {
        req.user = await verifyAdminIdToken(token);
        next();
    } catch (err) {
        if (err.code === 'FORBIDDEN') {
            return res.status(403).json({ error: 'Forbidden: You are not authorized to be an admin.' });
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

const requireGameOwner = async (req, res, next) => {
    const gameId = req.params.id;
    if (!gameId) return res.status(400).json({ error: 'Game ID is required' });

    try {
        const ownedGame = await gamesCol().findOne(
            { id: gameId, createdBy: req.user.email.toLowerCase() },
            { projection: { _id: 0, id: 1, createdBy: 1 } }
        );
        if (!ownedGame) return res.status(404).json({ error: 'Game not found' });
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Failed to verify game ownership' });
    }
};

const requireOwner = async (req, res, next) => {
    const ownerEmails = getOwnerEmails();
    if (ownerEmails.length === 0) {
        return res.status(403).json({ error: 'Forbidden: Owner analytics is not configured. Set OWNER_EMAILS.' });
    }
    if (!ownerEmails.includes((req.user?.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Forbidden: Owner access required.' });
    }
    return next();
};

// =====================
// API Routes
// =====================

// POST /api/auth/session — Validate Google credential and create server-side session cookies
app.post('/api/auth/session', async (req, res) => {
    const token = req.body?.token;
    if (!token) return res.status(400).json({ error: 'token is required' });

    try {
        const payload = await verifyAdminIdToken(token);
        const csrfToken = createCsrfToken();
        res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions);
        res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions);
        return res.json({ email: payload.email });
    } catch (err) {
        if (err.code === 'FORBIDDEN') {
            return res.status(403).json({ error: 'Forbidden: You are not authorized to be an admin.' });
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
});

// GET /api/auth/session — Return current admin session info
app.get('/api/auth/session', requireAdmin, async (req, res) => {
    return res.json({ email: req.user.email });
});

// POST /api/auth/logout — Clear auth and CSRF cookies
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
    return res.json({ success: true });
});

// Apply auth to all /api/games routes
app.use('/api/games', requireAdmin);
app.use('/api/games/:id', requireGameOwner);
app.use('/api/questionbank', requireAdmin);

// Admin-only routes
// GET /api/config — Return API key status
app.get('/api/config', (req, res) => {
    res.json({ hasApiKey: !!getAI(), googleClientId: process.env.GOOGLE_CLIENT_ID });
});

// GET /api/owner/dashboard-v1 — Owner-only analytics snapshot for v1 dashboard
app.get('/api/owner/dashboard-v1', requireAdmin, requireOwner, async (req, res) => {
    try {
        const requestedDays = Number(req.query.days);
        const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(365, Math.floor(requestedDays))) : 30;
        const now = new Date();
        const windowStart = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
        const last7Start = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        const last30Start = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        const windowStartIso = windowStart.toISOString();
        const last7StartIso = last7Start.toISOString();
        const last30StartIso = last30Start.toISOString();

        const [
            gamesInWindow,
            gamesInLast7,
            gamesInLast30,
            questionBankGrowthInWindow,
            totalQuestionBank,
            topAdmins,
            allGamesInLast30,
        ] = await Promise.all([
            gamesCol()
                .find(
                    { createdAt: { $gte: windowStartIso } },
                    { projection: { _id: 0, id: 1, status: 1, createdBy: 1, playerMode: 1, players: 1, createdAt: 1 } }
                )
                .toArray(),
            gamesCol().countDocuments({ createdAt: { $gte: last7StartIso } }),
            gamesCol().countDocuments({ createdAt: { $gte: last30StartIso } }),
            questionBankCol().countDocuments({ createdAt: { $gte: windowStartIso } }),
            questionBankCol().countDocuments({}),
            gamesCol()
                .aggregate([
                    { $match: { createdAt: { $gte: windowStartIso } } },
                    { $group: { _id: '$createdBy', gamesCreated: { $sum: 1 } } },
                    { $project: { _id: 0, email: '$_id', gamesCreated: 1 } },
                    { $sort: { gamesCreated: -1, email: 1 } },
                    { $limit: 10 },
                ])
                .toArray(),
            gamesCol()
                .find({ createdAt: { $gte: last30StartIso } }, { projection: { _id: 0, createdBy: 1, players: 1 } })
                .toArray(),
        ]);

        const monthlyActiveAdmins = new Set(allGamesInLast30.map(g => (g.createdBy || '').toLowerCase()).filter(Boolean)).size;

        const monthlyActivePlayerKeys = new Set();
        allGamesInLast30.forEach((game) => {
            (game.players || []).forEach((player) => {
                const key = (player?.name || '').trim().toLowerCase();
                if (key) monthlyActivePlayerKeys.add(key);
            });
        });

        const gamesCreatedInWindow = gamesInWindow.length;
        const totalPlayersInWindow = gamesInWindow.reduce((sum, game) => sum + ((game.players || []).length), 0);
        const completedGamesInWindow = gamesInWindow.filter(game => game.status === 'completed').length;
        const selfRegisterGamesInWindow = gamesInWindow.filter(game => game.playerMode === 'self_register');
        const redeemedSelfRegisterGames = selfRegisterGamesInWindow.filter(game => (game.players || []).length > 0).length;

        const statusDistribution = {
            configuring: gamesInWindow.filter(g => g.status === 'configuring').length,
            active: gamesInWindow.filter(g => g.status === 'active').length,
            paused: gamesInWindow.filter(g => g.status === 'paused').length,
            completed: completedGamesInWindow,
        };

        const trendBuckets = new Map();
        for (let i = days - 1; i >= 0; i -= 1) {
            const dayDate = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
            const dayLabel = dayDate.toISOString().slice(0, 10);
            trendBuckets.set(dayLabel, 0);
        }
        gamesInWindow.forEach((game) => {
            const dayLabel = (game.createdAt || '').slice(0, 10);
            if (trendBuckets.has(dayLabel)) {
                trendBuckets.set(dayLabel, (trendBuckets.get(dayLabel) || 0) + 1);
            }
        });

        return res.json({
            filters: { days, windowStart: windowStartIso, now: now.toISOString() },
            kpis: {
                monthlyActiveAdmins,
                gamesCreatedLast7: gamesInLast7,
                gamesCreatedLast30: gamesInLast30,
                gamesCreatedInWindow,
                monthlyActivePlayers: monthlyActivePlayerKeys.size,
                avgPlayersPerGame: gamesCreatedInWindow ? Number((totalPlayersInWindow / gamesCreatedInWindow).toFixed(2)) : 0,
                gameCompletionRate: gamesCreatedInWindow ? Number(((completedGamesInWindow / gamesCreatedInWindow) * 100).toFixed(1)) : 0,
                joinCodeRedemptionRate: selfRegisterGamesInWindow.length
                    ? Number(((redeemedSelfRegisterGames / selfRegisterGamesInWindow.length) * 100).toFixed(1))
                    : 0,
                questionBankGrowthInWindow,
                totalQuestionBank,
            },
            charts: {
                dailyGamesCreated: Array.from(trendBuckets.entries()).map(([date, count]) => ({ date, count })),
                gameStatusDistribution: statusDistribution,
            },
            tables: {
                topAdmins,
            },
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
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

// GET /api/questionbank — List question bank entries with optional filters
app.get('/api/questionbank', async (req, res) => {
    try {
        const category = (req.query.category || '').trim();
        const search = (req.query.search || '').trim();
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
        const skip = Math.max(0, Number(req.query.skip) || 0);

        const filter = { createdBy: req.user.email };
        if (category) {
            filter.categoryKey = normalizeCategoryName(category);
        }
        if (search) {
            const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(escapedSearch, 'i');
            filter.$or = [{ question: rx }, { answer: rx }, { categoryName: rx }];
        }

        const [questions, total, categories] = await Promise.all([
            questionBankCol()
                .find(filter, { projection: { _id: 0, fingerprint: 0 } })
                .sort({ categoryName: 1, value: 1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            questionBankCol().countDocuments(filter),
            questionBankCol()
                .aggregate([
                    { $match: { createdBy: req.user.email } },
                    { $group: { _id: '$categoryName', count: { $sum: 1 } } },
                    { $project: { _id: 0, name: '$_id', count: 1 } },
                    { $sort: { name: 1 } },
                ])
                .toArray(),
        ]);

        res.json({ questions, total, limit, skip, categories });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/questionbank/export — Export all question bank entries to Excel
app.get('/api/questionbank/export', async (req, res) => {
    try {
        const questions = await questionBankCol()
            .find({ createdBy: req.user.email }, { projection: { _id: 0, fingerprint: 0, categoryKey: 0 } })
            .sort({ categoryName: 1, value: 1, createdAt: -1 })
            .toArray();

        const rows = questions.map(q => ({
            ID: q.id || '',
            Category: q.categoryName || '',
            Value: Number(q.value) || 0,
            Question: q.question || '',
            Answer: q.answer || '',
            UsageCount: Number(q.usageCount) || 0,
            SourceType: q.sourceType || '',
            SourceGameId: q.sourceGameId || '',
            CreatedBy: q.createdBy || '',
            CreatedAt: q.createdAt || '',
            UpdatedAt: q.updatedAt || '',
        }));

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Question Bank');

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `question-bank-${stamp}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/questionbank — Add one question manually to the bank
app.post('/api/questionbank', async (req, res) => {
    try {
        const categoryName = (req.body.categoryName || '').trim();
        const question = (req.body.question || '').trim();
        const answer = (req.body.answer || '').trim();
        const value = Number(req.body.value) || 0;

        if (!categoryName || !question || !answer || value <= 0) {
            return res.status(400).json({ error: 'categoryName, question, answer and positive value are required' });
        }

        const result = await upsertQuestionsToBank({
            questions: [{ question, answer, value }],
            categoryName,
            sourceType: 'manual',
            createdBy: req.user.email,
        });

        const fingerprint = buildQuestionFingerprint(categoryName, question, answer, value);
        const saved = await questionBankCol().findOne({ fingerprint }, { projection: { _id: 0, fingerprint: 0 } });
        return res.status(201).json({ saved, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/questionbank/:questionId — Remove a question from the bank
app.delete('/api/questionbank/:questionId', async (req, res) => {
    try {
        const result = await questionBankCol().deleteOne({ id: req.params.questionId, createdBy: req.user.email });
        if (!result.deletedCount) return res.status(404).json({ error: 'Question not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/questionbank/backfill — Backfill question bank from all historical games
app.post('/api/questionbank/backfill', async (req, res) => {
    try {
        const games = await gamesCol()
            .find({ createdBy: req.user.email }, { projection: { _id: 0, id: 1, createdBy: 1, categories: 1 } })
            .toArray();
        let inserted = 0;
        let updated = 0;

        for (const game of games) {
            for (const category of game.categories || []) {
                const stats = await upsertQuestionsToBank({
                    questions: category.questions || [],
                    categoryName: category.name,
                    sourceGameId: game.id,
                    sourceType: 'backfill',
                    createdBy: game.createdBy || null,
                });
                inserted += stats.inserted;
                updated += stats.updated;
            }
        }

        res.json({ success: true, inserted, updated, scannedGames: games.length });
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
            { projection: { _id: 0, id: 1, name: 1, status: 1, playerMode: 1, players: 1, categories: 1, stats: 1 } }
        );
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const sanitized = {
            id: game.id,
            name: game.name,
            status: game.status,
            playerMode: game.playerMode,
            players: (game.players || []).map(player => ({
                id: player.id,
                name: player.name,
                score: player.score,
            })),
            categories: (game.categories || []).map(category => ({
                id: category.id,
                name: category.name,
                questions: (category.questions || []).map(question => ({
                    id: question.id,
                    value: question.value,
                    answered: !!question.answered,
                    answeredBy: question.answered ? question.answeredBy || null : null,
                    question: question.answered ? question.question : null,
                })),
            })),
            stats: game.stats || {},
        };

        res.json(sanitized);
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

// PUT /api/games/:id/categories/:catId — Rename category
app.put('/api/games/:id/categories/:catId', async (req, res) => {
    const { name } = req.body;
    const trimmedName = (name || '').trim();
    if (!trimmedName) return res.status(400).json({ error: 'Category name is required' });

    try {
        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id, 'categories.id': req.params.catId },
            { $set: { 'categories.$.name': trimmedName, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0, categories: 1 } }
        );
        if (!result) return res.status(404).json({ error: 'Game or category not found' });

        const updatedCategory = result.categories.find(c => c.id === req.params.catId);
        if (!updatedCategory) return res.status(404).json({ error: 'Category not found' });
        res.json(updatedCategory);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/games/:id/categories/:catId/questions — Update questions
app.put('/api/games/:id/categories/:catId/questions', async (req, res) => {
    const { questions } = req.body;
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0, id: 1, createdBy: 1, categories: 1 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        const category = game.categories.find(c => c.id === req.params.catId);
        if (!category) return res.status(404).json({ error: 'Category not found' });

        const result = await gamesCol().findOneAndUpdate(
            { id: req.params.id, 'categories.id': req.params.catId },
            { $set: { 'categories.$.questions': questions, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
        if (!result) return res.status(404).json({ error: 'Game or category not found' });

        await upsertQuestionsToBank({
            questions,
            categoryName: category.name,
            sourceGameId: game.id,
            sourceType: 'manual',
            createdBy: game.createdBy || req.user.email,
        });

        const cat = result.categories.find(c => c.id === req.params.catId);
        res.json(cat);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/categories/:catId/import-questions — Import questions from question bank
app.post('/api/games/:id/categories/:catId/import-questions', async (req, res) => {
    const questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
    if (!questionIds.length) return res.status(400).json({ error: 'questionIds is required' });

    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        const category = game.categories.find(c => c.id === req.params.catId);
        if (!category) return res.status(404).json({ error: 'Category not found' });

        const bankQuestions = await questionBankCol()
            .find({ id: { $in: questionIds }, createdBy: req.user.email }, { projection: { _id: 0, id: 1, question: 1, answer: 1, value: 1 } })
            .toArray();

        if (!bankQuestions.length) return res.status(404).json({ error: 'No matching bank questions found' });

        const existing = Array.isArray(category.questions) ? category.questions : [];
        const remainingSlots = Math.max(0, 5 - existing.length);
        if (remainingSlots <= 0) {
            return res.status(400).json({ error: 'This category already has 5 questions. Remove one before importing.' });
        }

        const selected = bankQuestions.slice(0, remainingSlots).map(q => ({
            id: uuidv4(),
            value: q.value,
            question: q.question,
            answer: q.answer,
            answered: false,
            answeredBy: null,
            wrongAnswers: [],
            sourceQuestionBankId: q.id,
        }));

        const nextQuestions = [...existing, ...selected];
        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id, 'categories.id': req.params.catId },
            { $set: { 'categories.$.questions': nextQuestions, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        await questionBankCol().updateMany(
            { id: { $in: selected.map(q => q.sourceQuestionBankId) }, createdBy: req.user.email },
            { $inc: { usageCount: 1 }, $set: { updatedAt: new Date().toISOString() } }
        );

        const updatedCategory = updated.categories.find(c => c.id === req.params.catId);
        res.json({
            category: updatedCategory,
            importedCount: selected.length,
            skippedCount: Math.max(0, questionIds.length - selected.length),
            remainingSlots: Math.max(0, 5 - (updatedCategory.questions?.length || 0)),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/games/:id/categories/:catId/import-best-matches — One-click import by best category matches
app.post('/api/games/:id/categories/:catId/import-best-matches', async (req, res) => {
    const requestedLimit = Number(req.body.limit) || 5;

    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        const category = game.categories.find(c => c.id === req.params.catId);
        if (!category) return res.status(404).json({ error: 'Category not found' });

        const existing = Array.isArray(category.questions) ? category.questions : [];
        const remainingSlots = Math.max(0, 5 - existing.length);
        if (remainingSlots <= 0) {
            return res.status(400).json({ error: 'This category already has 5 questions. Remove one before importing.' });
        }

        const limit = Math.min(remainingSlots, Math.max(1, requestedLimit));
        const categoryKey = normalizeCategoryName(category.name);
        const existingFingerprints = new Set(
            existing.map(q => buildQuestionFingerprint(category.name, q.question, q.answer, q.value))
        );

        let candidates = await questionBankCol()
            .find({ categoryKey, createdBy: req.user.email }, { projection: { _id: 0, id: 1, question: 1, answer: 1, value: 1, usageCount: 1, updatedAt: 1 } })
            .sort({ usageCount: -1, updatedAt: -1, value: 1 })
            .limit(50)
            .toArray();

        // Fallback: if no exact category match exists, use loose name matching.
        if (!candidates.length) {
            const escaped = category.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            candidates = await questionBankCol()
                .find({ categoryName: { $regex: escaped, $options: 'i' }, createdBy: req.user.email }, { projection: { _id: 0, id: 1, question: 1, answer: 1, value: 1, usageCount: 1, updatedAt: 1 } })
                .sort({ usageCount: -1, updatedAt: -1, value: 1 })
                .limit(50)
                .toArray();
        }

        const picked = [];
        for (const candidate of candidates) {
            if (picked.length >= limit) break;
            const fp = buildQuestionFingerprint(category.name, candidate.question, candidate.answer, candidate.value);
            if (existingFingerprints.has(fp)) continue;
            existingFingerprints.add(fp);
            picked.push(candidate);
        }

        if (!picked.length) {
            return res.status(404).json({ error: `No suitable bank matches found for "${category.name}".` });
        }

        const imported = picked.map(q => ({
            id: uuidv4(),
            value: q.value,
            question: q.question,
            answer: q.answer,
            answered: false,
            answeredBy: null,
            wrongAnswers: [],
            sourceQuestionBankId: q.id,
        }));

        const nextQuestions = [...existing, ...imported];
        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id, 'categories.id': req.params.catId },
            { $set: { 'categories.$.questions': nextQuestions, updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        await questionBankCol().updateMany(
            { id: { $in: imported.map(q => q.sourceQuestionBankId) }, createdBy: req.user.email },
            { $inc: { usageCount: 1 }, $set: { updatedAt: new Date().toISOString() } }
        );

        const updatedCategory = updated.categories.find(c => c.id === req.params.catId);
        return res.json({
            category: updatedCategory,
            importedCount: imported.length,
            remainingSlots: Math.max(0, 5 - (updatedCategory.questions?.length || 0)),
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
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
            model: 'claude-opus-4-6',
            max_tokens: 700,
            messages: [{
                role: 'user',
                content: `You are a Jeopardy game question writer. Return ONLY valid JSON arrays with no markdown, no extra text.

Generate exactly 5 Jeopardy-style questions for the category "${category.name}".
Difficulty Level: ${difficulty.toUpperCase()}
${hint ? `\nAdditional instructions from the host: ${hint}\n` : ''}
Point values (in order): 200, 400, 600, 800, 1000
The "question" is a clue/statement; the "answer" is what the contestant says.
generate questions based on difficulty level.
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

        await upsertQuestionsToBank({
            questions,
            categoryName: category.name,
            sourceGameId: game.id,
            sourceType: 'ai_generated',
            createdBy: game.createdBy || req.user.email,
        });

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

// POST /api/games/:id/end — End game early and show leaderboard
app.post('/api/games/:id/end', async (req, res) => {
    try {
        const game = await gamesCol().findOne({ id: req.params.id }, { projection: { _id: 0 } });
        if (!game) return res.status(404).json({ error: 'Game not found' });

        if (game.status === 'completed') {
            return res.json(game);
        }

        const updated = await gamesCol().findOneAndUpdate(
            { id: req.params.id },
            { $set: { status: 'completed', updatedAt: new Date().toISOString() } },
            { returnDocument: 'after', projection: { _id: 0 } }
        );

        const room = rooms.get(req.params.id);
        if (room) {
            room.questionOpen = false;
            room.buzzerQueue = [];
            broadcast(room, { type: 'question_closed' });
            broadcast(room, { type: 'buzzer_update', queue: [] });
            broadcast(room, { type: 'game_status_update', status: 'completed' });
            broadcast(room, { type: 'game_update', game: updated });
        }

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
// rooms: gameId -> { hostWs, players: Map<playerId, {ws, name}>, buzzerQueue: [], questionOpen: false, disconnectTimers: Map<playerId, timeoutId> }
const rooms = new Map();

function getOrCreateRoom(gameId) {
    if (!rooms.has(gameId)) {
        rooms.set(gameId, { hostWs: null, players: new Map(), buzzerQueue: [], questionOpen: false, disconnectTimers: new Map() });
    }
    return rooms.get(gameId);
}

const PLAYER_DISCONNECT_GRACE_MS = 30000; // 30 seconds to reconnect before eviction

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

// Heartbeat: detect and terminate dead WebSocket connections.
// Mobile carriers, NATs, Wi-Fi routers, and reverse proxies (e.g. Render)
// silently drop idle TCP connections after 30-60s. Ping every 25s to keep
// connections alive and terminate any that fail to respond with a pong.
const WS_HEARTBEAT_INTERVAL_MS = 25000;

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead WebSocket (no pong received)');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, WS_HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

wss.on('connection', (ws, req) => {
    // Mark connection alive; pong responses keep it alive across heartbeat cycles.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const socketCookies = parseCookieHeader(req.headers.cookie || '');
    const sessionToken = socketCookies[SESSION_COOKIE_NAME] || null;
    let assignedGameId = null;
    let assignedPlayerId = null;
    let assignedPlayerName = null;
    let isHost = false;
    let buzzCount = 0;
    let buzzWindowStartedAt = Date.now();

    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const { type, gameId, playerName } = msg;

        if (type === 'host_join') {
            const token = sessionToken;
            if (!token) {
                ws.send(JSON.stringify({ type: 'error', message: 'Host authentication is required.' }));
                return;
            }

            try {
                const payload = await verifyAdminIdToken(token);
                const hostEmail = payload.email;
                if (!hostEmail) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid host token payload.' }));
                    return;
                }

                const game = await gamesCol().findOne({ id: gameId }, { projection: { _id: 0, id: 1, createdBy: 1 } });
                if (!game || game.createdBy?.toLowerCase() !== hostEmail) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Host is not authorized for this game.' }));
                    return;
                }

                assignedGameId = gameId;
                isHost = true;

                const room = getOrCreateRoom(gameId);
                room.hostWs = ws;
                ws.send(JSON.stringify({ type: 'host_joined', gameId }));
                await broadcastPlayerList(gameId);
            } catch (e) {
                ws.send(JSON.stringify({ type: 'error', message: 'Host authentication failed.' }));
            }
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
                assignedPlayerName = existingPlayer.name;
                console.log(`Player re-join: ${playerName.trim()} (${assignedPlayerId})`);
            } else {
                assignedPlayerId = uuidv4();
                assignedPlayerName = playerName.trim();
                const newPlayer = { id: assignedPlayerId, name: playerName.trim(), score: 0 };
                // Persist player to MongoDB
                await db.collection('games').updateOne(
                    { id: gameId },
                    { $push: { players: newPlayer }, $set: { updatedAt: new Date().toISOString() } }
                );
                console.log(`New player joined: ${playerName.trim()} (${assignedPlayerId})`);
            }

            const room = getOrCreateRoom(gameId);

            // Cancel any pending disconnect-eviction timer for this player (reconnect within grace period)
            if (room.disconnectTimers.has(assignedPlayerId)) {
                clearTimeout(room.disconnectTimers.get(assignedPlayerId));
                room.disconnectTimers.delete(assignedPlayerId);
                console.log(`Cancelled disconnect timer for reconnecting player: ${assignedPlayerName} (${assignedPlayerId})`);
            }

            room.players.set(assignedPlayerId, { ws, name: assignedPlayerName || playerName.trim(), id: assignedPlayerId });
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
            if (!isHost || !assignedGameId || (gameId && gameId !== assignedGameId)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Only the authenticated host can open questions.' }));
                return;
            }

            const room = rooms.get(assignedGameId);
            if (!room) return;
            room.buzzerQueue = [];
            room.questionOpen = true;
            room.timeoutAt = Date.now() + 15000;
            broadcast(room, { type: 'question_open', timeoutAt: room.timeoutAt });
        }

        else if (type === 'close_question') {
            if (!isHost || !assignedGameId || (gameId && gameId !== assignedGameId)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Only the authenticated host can close questions.' }));
                return;
            }

            const room = rooms.get(assignedGameId);
            if (!room) return;
            room.questionOpen = false;
            broadcast(room, { type: 'question_closed' });
        }

        else if (type === 'buzz') {
            if (!assignedGameId || !assignedPlayerId || isHost) {
                ws.send(JSON.stringify({ type: 'error', message: 'Only joined players can buzz.' }));
                return;
            }

            const now = Date.now();
            if (now - buzzWindowStartedAt >= 60000) {
                buzzWindowStartedAt = now;
                buzzCount = 0;
            }
            if (buzzCount >= 30) {
                ws.send(JSON.stringify({ type: 'error', message: 'Buzzer rate limit exceeded. Please wait.' }));
                return;
            }
            buzzCount += 1;

            const room = rooms.get(assignedGameId);
            if (!room || !room.questionOpen) return;

            // Always use socket-bound identity; ignore any client-supplied playerId/playerName.
            if (room.buzzerQueue.some(b => b.playerId === assignedPlayerId)) return;

            const resolvedName = assignedPlayerName || room.players.get(assignedPlayerId)?.name || 'Unknown player';
            const buzzEntry = { playerId: assignedPlayerId, name: resolvedName, time: Date.now() };
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
            // Check game status to determine eviction behavior
            let gameStatus = 'configuring';
            try {
                const game = await db.collection('games').findOne({ id: assignedGameId }, { projection: { status: 1 } });
                gameStatus = game?.status || 'configuring';
            } catch (e) { /* default to configuring = immediate eviction */ }

            if (gameStatus === 'configuring') {
                // Pre-game lobby: evict immediately and remove from DB
                room.players.delete(assignedPlayerId);
                try {
                    await db.collection('games').updateOne(
                        { id: assignedGameId },
                        { $pull: { players: { id: assignedPlayerId } } }
                    );
                    const updated = await db.collection('games').findOne({ id: assignedGameId }, { projection: { players: 1 } });
                    if (room.hostWs && room.hostWs.readyState === 1) {
                        room.hostWs.send(JSON.stringify({ type: 'game_players_update', players: updated?.players || [] }));
                    }
                } catch(e) { /* non-fatal */ }
                await broadcastPlayerList(assignedGameId);
            } else {
                // Active/paused/completed game: grace period before eviction.
                // The player's socket is dead, but we keep them in the room so
                // they don't miss broadcasts if they reconnect quickly.
                console.log(`Player disconnected during ${gameStatus} game: ${assignedPlayerName} (${assignedPlayerId}). Grace period: ${PLAYER_DISCONNECT_GRACE_MS / 1000}s`);

                const timerId = setTimeout(async () => {
                    room.disconnectTimers.delete(assignedPlayerId);
                    // Only evict if they haven't reconnected (their socket would have been replaced)
                    const currentEntry = room.players.get(assignedPlayerId);
                    if (currentEntry && currentEntry.ws === ws) {
                        // Same dead socket — player never reconnected
                        room.players.delete(assignedPlayerId);
                        console.log(`Evicted player after grace period: ${assignedPlayerName} (${assignedPlayerId})`);
                        await broadcastPlayerList(assignedGameId);
                    }
                }, PLAYER_DISCONNECT_GRACE_MS);

                room.disconnectTimers.set(assignedPlayerId, timerId);
            }
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
