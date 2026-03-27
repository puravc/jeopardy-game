import React, { useState } from 'react';
import { API } from '../utils/api';

export default function HostSetup({ game, setGame, loadGame, sendSocketMessage }) {
    const [activeTab, setActiveTab] = useState('game-info');
    const [gameName, setGameName] = useState(game.name || '');
    const [playerName, setPlayerName] = useState('');
    const [categoryName, setCategoryName] = useState('');
    const [generatingCatId, setGeneratingCatId] = useState(null);
    const joinUrl = `${window.location.origin}/join`;

    const qCount = game.categories.reduce((acc, cat) => acc + (cat.questions?.length || 0), 0);

    const saveGameName = async () => {
        if (!gameName.trim()) return alert('Name required');
        try {
            await API.updateGame(game.id, { name: gameName });
            await loadGame();
            alert('Game name saved!');
        } catch (e) {
            alert(e.message);
        }
    };

    const addPlayer = async () => {
        if (!playerName.trim()) return;
        try {
            await API.addPlayer(game.id, playerName.trim());
            setPlayerName('');
            await loadGame();
        } catch (e) {
            alert(e.message);
        }
    };

    const removePlayer = async (pid) => {
        try {
            await API.removePlayer(game.id, pid);
            await loadGame();
        } catch (e) {
            alert(e.message);
        }
    };

    const addCategory = async () => {
        if (!categoryName.trim()) return;
        try {
            await API.addCategory(game.id, categoryName.trim());
            setCategoryName('');
            await loadGame();
        } catch (e) {
            alert(e.message);
        }
    };

    const removeCategory = async (cid) => {
        if (!window.confirm('Remove this topic and all questions?')) return;
        try {
            await API.removeCategory(game.id, cid);
            await loadGame();
        } catch (e) {
            alert(e.message);
        }
    };

    const generateQuestions = async (cid) => {
        setGeneratingCatId(cid);
        const hintInput = document.getElementById(`hint-${cid}`);
        const diffSelect = document.getElementById(`diff-${cid}`);
        
        try {
            const hint = hintInput ? hintInput.value : '';
            const difficulty = diffSelect ? diffSelect.value : 'medium';
            const updatedCategory = await API.generateQuestions(game.id, cid, hint, difficulty);
            // Immediately patch the category in local state — no extra round-trip needed
            if (updatedCategory && setGame) {
                setGame(prev => ({
                    ...prev,
                    categories: prev.categories.map(c => c.id === cid ? updatedCategory : c),
                }));
            } else {
                await loadGame();
            }
        } catch (e) {
            alert('Generation failed: ' + e.message);
        } finally {
            setGeneratingCatId(null);
        }
    };

    const handleLaunch = async () => {
        console.debug('Start Game clicked for', game.id);
        try {
            await API.startGame(game.id);
            // refresh local state
            await loadGame();
            // notify connected clients via websocket
            sendSocketMessage({ type: 'start' });
        } catch (e) {
            alert('Failed to start game: ' + e.message);
        }
    };

    const checks = [
        { ok: !!game.name, label: 'Game has a name' },
        { ok: game.players.length >= 2, label: 'At least 2 players added' },
        { ok: game.categories.length >= 1, label: 'At least 1 topic added' },
        { ok: game.categories.length > 0 && game.categories.every(c => c.questions && c.questions.length >= 5), label: 'All topics have questions (5+)' },
    ];
    const canLaunch = checks.every(c => c.ok);

    return (
        <div className="admin-layout">
            <aside className="admin-sidebar">
                <div className="admin-sidebar-section">
                    <h4>Configure</h4>
                    <button className={`admin-nav-item ${activeTab === 'game-info' ? 'active' : ''}`} onClick={() => setActiveTab('game-info')}>
                        <span className="nav-icon">⚙️</span> Game Info
                    </button>
                    <button className={`admin-nav-item ${activeTab === 'players' ? 'active' : ''}`} onClick={() => setActiveTab('players')}>
                        <span className="nav-icon">👥</span> Players
                    </button>
                    <button className={`admin-nav-item ${activeTab === 'topics' ? 'active' : ''}`} onClick={() => setActiveTab('topics')}>
                        <span className="nav-icon">📚</span> Topics & Questions
                    </button>
                </div>
                <div className="admin-sidebar-section" style={{ marginTop: 'auto' }}>
                    <h4>Actions</h4>
                    <button className={`admin-nav-item ${activeTab === 'launch' ? 'active' : ''}`} onClick={() => setActiveTab('launch')}>
                        <span className="nav-icon">🚀</span> Launch Game
                    </button>
                </div>
            </aside>

            <main className="admin-main">
                {activeTab === 'game-info' && (
                    <section className="admin-section active">
                        <div className="admin-section-header">
                            <h2 className="admin-section-title">GAME INFO</h2>
                        </div>
                        <div className="card" style={{ maxWidth: '520px' }}>
                            <div className="form-group">
                                <label className="form-label">Game Name</label>
                                <input type="text" className="form-input" value={gameName} onChange={e => setGameName(e.target.value)} />
                            </div>
                            <button className="btn btn-primary" onClick={saveGameName}>💾 Save Name</button>
                        </div>
                        <div className="divider"></div>
                        <div className="info-grid">
                            <div className="info-card"><div className="info-card-value">{game.players.length}</div><div className="info-card-label">Players</div></div>
                            <div className="info-card"><div className="info-card-value">{game.categories.length}</div><div className="info-card-label">Topics</div></div>
                            <div className="info-card"><div className="info-card-value">{qCount}</div><div className="info-card-label">Questions Ready</div></div>
                            <div className="info-card"><div className="info-card-value">{game.status.toUpperCase()}</div><div className="info-card-label">Status</div></div>
                        </div>
                    </section>
                )}

                {activeTab === 'players' && (
                    <section className="admin-section active">
                        <div className="admin-section-header"><h2 className="admin-section-title">PLAYERS</h2></div>
                        {game.playerMode === 'self_register' && (
                            <div className="self-register-banner">
                                <div className="self-register-icon">📱</div>
                                <div className="self-register-copy">
                                    <div className="self-register-title">Self-Register: Players join via code <span className="self-register-code">{game.joinCode}</span> at <span className="self-register-url">{joinUrl}</span>. They appear below as they join.</div>
                                </div>
                            </div>
                        )}
                        {game.players.length === 0 && (
                            <div className="player-empty-state">No players yet — waiting for players to join via the code above.</div>
                        )}
                        <div className="player-list">
                            {game.players.map(p => (
                                <div key={p.id} className="player-item">
                                    <div className="player-avatar">{p.name[0]}</div>
                                    <div className="player-name">{p.name}</div>
                                    <button className="btn btn-ghost btn-sm" style={{color:'var(--danger)'}} onClick={() => removePlayer(p.id)}>✕</button>
                                </div>
                            ))}
                        </div>
                        <div className="input-row" style={{ maxWidth: '400px', marginTop: '1rem' }}>
                            <input type="text" className="form-input" placeholder="Player name..." value={playerName} onChange={e => setPlayerName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPlayer()} />
                            <button className="btn btn-primary" onClick={addPlayer}>+ Add</button>
                        </div>
                    </section>
                )}

                {activeTab === 'topics' && (
                    <section className="admin-section active">
                        <div className="admin-section-header"><h2 className="admin-section-title">TOPICS & QUESTIONS</h2></div>
                        <div className="category-list">
                            {game.categories.map(cat => (
                                <div key={cat.id} className="category-item">
                                    <div className="category-header">
                                        <div className="category-title-row">
                                            <div className="category-icon">📚</div>
                                            <div>
                                                <div className="category-name">{cat.name}</div>
                                                <div className="category-q-count">{cat.questions?.length || 0} questions</div>
                                            </div>
                                        </div>
                                        <div className="category-actions">
                                            <button className="btn btn-primary btn-sm" onClick={() => generateQuestions(cat.id)} disabled={generatingCatId === cat.id}>
                                                {generatingCatId === cat.id ? 'Generating...' : '✨ Generate Questions'}
                                            </button>
                                            <button className="btn btn-danger btn-sm" onClick={() => removeCategory(cat.id)}>✕</button>
                                        </div>
                                        <div className="category-hint-row">
                                            <select id={`diff-${cat.id}`} className="difficulty-select" defaultValue="medium">
                                                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="impossible">Impossible</option>
                                            </select>
                                            <input type="text" id={`hint-${cat.id}`} className="hint-input" placeholder="💡 Hint: e.g. focus on 1990s" />
                                        </div>
                                    </div>
                                    {cat.questions?.length > 0 && (
                                        <div className="question-list">
                                            {cat.questions.map((q, i) => (
                                                <div key={i} className="question-item">
                                                    <span className="question-value">${q.value}</span>
                                                    <div className="question-text">{q.question}</div>
                                                    <div className="answer-text"><span className="answer-label">A: </span>{q.answer}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="input-row" style={{ maxWidth: '480px', marginTop: '1rem' }}>
                            <input type="text" className="form-input" placeholder="Topic name (e.g. Science)..." value={categoryName} onChange={e => setCategoryName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()} />
                            <button className="btn btn-primary" onClick={addCategory}>+ Add Topic</button>
                        </div>
                    </section>
                )}

                {activeTab === 'launch' && (
                    <section className="admin-section active">
                        <div className="admin-section-header"><h2 className="admin-section-title">LAUNCH GAME</h2></div>
                        <div className="start-game-panel">
                            <h3>PRE-FLIGHT CHECK</h3>
                            <ul className="validation-list">
                                {checks.map((c, i) => (
                                    <li key={i} className={c.ok ? 'ok' : 'fail'}>
                                        <span>{c.ok ? '✅' : '❌'}</span> {c.label}
                                    </li>
                                ))}
                            </ul>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                <button className="btn btn-gold btn-xl" disabled={!canLaunch} onClick={handleLaunch}>🚀 Start Game!</button>
                            </div>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
