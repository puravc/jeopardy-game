import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../utils/api';

export default function HostSetup({ game, setGame, loadGame, sendSocketMessage, onPreviewGame }) {
    const QUESTION_VALUES = [200, 400, 600, 800, 1000];
    const [activeTab, setActiveTab] = useState('game-info');
    const [gameName, setGameName] = useState(game.name || '');
    const [playerName, setPlayerName] = useState('');
    const [categoryName, setCategoryName] = useState('');
    const [generatingCatId, setGeneratingCatId] = useState(null);
    const [importingBestCatId, setImportingBestCatId] = useState(null);
    const [editingCategoryId, setEditingCategoryId] = useState(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [renamingCategoryId, setRenamingCategoryId] = useState(null);
    const [manualCategoryId, setManualCategoryId] = useState(null);
    const [manualQuestions, setManualQuestions] = useState([]);
    const [manualSaving, setManualSaving] = useState(false);
    const [manualError, setManualError] = useState('');
    const navigate = useNavigate();
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

    const startRenameCategory = (cid, currentName) => {
        setEditingCategoryId(cid);
        setEditingCategoryName(currentName);
    };

    const cancelRenameCategory = () => {
        if (renamingCategoryId) return;
        setEditingCategoryId(null);
        setEditingCategoryName('');
    };

    const saveRenameCategory = async (cid, currentName) => {
        const trimmedName = editingCategoryName.trim();
        if (!trimmedName) return alert('Topic name cannot be empty');
        if (trimmedName === currentName) {
            cancelRenameCategory();
            return;
        }

        try {
            setRenamingCategoryId(cid);
            const updatedCategory = await API.renameCategory(game.id, cid, trimmedName);
            if (updatedCategory && setGame) {
                setGame(prev => ({
                    ...prev,
                    categories: prev.categories.map(c => c.id === cid ? updatedCategory : c),
                }));
            } else {
                await loadGame();
            }
            setEditingCategoryId(null);
            setEditingCategoryName('');
        } catch (e) {
            alert(e.message);
        } finally {
            setRenamingCategoryId(null);
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

    const importBestMatches = async (cid) => {
        setImportingBestCatId(cid);
        try {
            const payload = await API.importBestMatchesToCategory(game.id, cid, 5);
            if (payload?.category && setGame) {
                setGame(prev => ({
                    ...prev,
                    categories: prev.categories.map(c => c.id === cid ? payload.category : c),
                }));
            } else {
                await loadGame();
            }
            alert(`Imported ${payload?.importedCount || 0} best-match question(s).`);
        } catch (e) {
            alert('Import failed: ' + e.message);
        } finally {
            setImportingBestCatId(null);
        }
    };

    const buildInitialManualQuestions = (category) => {
        return QUESTION_VALUES.map((defaultValue, index) => {
            const source = category.questions?.[index] || null;
            return {
                id: source?.id || crypto.randomUUID(),
                value: source?.value ?? defaultValue,
                question: source?.question || '',
                answer: source?.answer || '',
                answered: false,
                answeredBy: null,
            };
        });
    };

    const openManualEditor = (category) => {
        setManualCategoryId(category.id);
        setManualQuestions(buildInitialManualQuestions(category));
        setManualError('');
    };

    const closeManualEditor = () => {
        if (manualSaving) return;
        setManualCategoryId(null);
        setManualQuestions([]);
        setManualError('');
    };

    const updateManualQuestion = (index, field, value) => {
        setManualQuestions(prev => prev.map((q, i) => {
            if (i !== index) return q;
            if (field === 'value') {
                return { ...q, value: Number(value) || 0 };
            }
            return { ...q, [field]: value };
        }));
    };

    const saveManualQuestions = async () => {
        const normalized = manualQuestions.map((q, idx) => ({
            ...q,
            value: Number(q.value) || QUESTION_VALUES[idx],
            question: (q.question || '').trim(),
            answer: (q.answer || '').trim(),
            answered: false,
            answeredBy: null,
        }));

        const incomplete = normalized.some(q => !q.question || !q.answer || q.value <= 0);
        if (incomplete) {
            setManualError('Complete all 5 rows with a positive value, clue, and answer.');
            return;
        }

        setManualSaving(true);
        setManualError('');
        try {
            const updatedCategory = await API.updateQuestions(game.id, manualCategoryId, normalized);
            if (updatedCategory && setGame) {
                setGame(prev => ({
                    ...prev,
                    categories: prev.categories.map(c => c.id === manualCategoryId ? updatedCategory : c),
                }));
            } else {
                await loadGame();
            }
            closeManualEditor();
        } catch (e) {
            setManualError(e.message || 'Failed to save questions');
        } finally {
            setManualSaving(false);
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
    const previewChecks = [
        { ok: game.categories.length >= 1, label: 'At least 1 topic added' },
        { ok: game.categories.some(c => (c.questions?.length || 0) > 0), label: 'At least 1 question ready' },
    ];
    const canLaunch = checks.every(c => c.ok);
    const canPreview = previewChecks.every(c => c.ok);
    const manualCategory = game.categories.find(c => c.id === manualCategoryId);

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
                        <div className="admin-section-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 className="admin-section-title">TOPICS & QUESTIONS</h2>
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => navigate(`/question-bank?gameId=${game.id}`)}
                            >
                                📦 Open Question Bank
                            </button>
                        </div>
                        <div className="category-list">
                            {game.categories.map(cat => (
                                <div key={cat.id} className="category-item">
                                    <div className="category-header">
                                        <div className="category-title-row">
                                            <div className="category-icon">📚</div>
                                            <div>
                                                {editingCategoryId === cat.id ? (
                                                    <div className="category-rename-row">
                                                        <input
                                                            type="text"
                                                            className="form-input category-rename-input"
                                                            value={editingCategoryName}
                                                            onChange={e => setEditingCategoryName(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') saveRenameCategory(cat.id, cat.name);
                                                                if (e.key === 'Escape') cancelRenameCategory();
                                                            }}
                                                            disabled={renamingCategoryId === cat.id}
                                                            aria-label="Topic name"
                                                            autoFocus
                                                        />
                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => saveRenameCategory(cat.id, cat.name)}
                                                            disabled={renamingCategoryId === cat.id}
                                                        >
                                                            {renamingCategoryId === cat.id ? 'Saving...' : 'Save'}
                                                        </button>
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={cancelRenameCategory}
                                                            disabled={renamingCategoryId === cat.id}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="category-name">{cat.name}</div>
                                                )}
                                                <div className="category-q-count">{cat.questions?.length || 0} questions</div>
                                            </div>
                                        </div>
                                        <div className="category-actions">
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => startRenameCategory(cat.id, cat.name)}
                                                disabled={editingCategoryId === cat.id}
                                            >
                                                ✏️ Rename
                                            </button>
                                            <button className="btn btn-primary btn-sm" onClick={() => generateQuestions(cat.id)} disabled={generatingCatId === cat.id}>
                                                {generatingCatId === cat.id ? 'Generating...' : '✨ Generate Questions'}
                                            </button>
                                            <button className="btn btn-ghost btn-sm" onClick={() => importBestMatches(cat.id)} disabled={importingBestCatId === cat.id || (cat.questions?.length || 0) >= 5}>
                                                {importingBestCatId === cat.id ? 'Importing...' : '⚡ Import 5 Best Matches'}
                                            </button>
                                            <button className="btn btn-ghost btn-sm" onClick={() => openManualEditor(cat)}>
                                                ✍️ Manual Entry
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
                            <h3 style={{ marginTop: '1rem' }}>PREVIEW CHECK</h3>
                            <ul className="validation-list">
                                {previewChecks.map((c, i) => (
                                    <li key={i} className={c.ok ? 'ok' : 'fail'}>
                                        <span>{c.ok ? '✅' : '❌'}</span> {c.label}
                                    </li>
                                ))}
                            </ul>
                            <p style={{ textAlign: 'center', marginTop: '0.6rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                Preview mode lets you test the board flow without starting the game or adding players.
                            </p>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                <button
                                    className="btn btn-ghost btn-xl"
                                    disabled={!canPreview}
                                    onClick={() => onPreviewGame && onPreviewGame()}
                                >
                                    👀 Preview Game
                                </button>
                                <button className="btn btn-gold btn-xl" disabled={!canLaunch} onClick={handleLaunch}>🚀 Start Game!</button>
                            </div>
                        </div>
                    </section>
                )}
            </main>

            {manualCategoryId && (
                <div className="modal-overlay open" onClick={closeManualEditor}>
                    <div className="modal-card manual-editor-card" onClick={e => e.stopPropagation()}>
                        <h3 className="modal-title">MANUAL QUESTIONS</h3>
                        <p className="modal-sub">{manualCategory?.name || 'Category'} • Enter 5 clues and answers.</p>

                        <div className="manual-list">
                            {manualQuestions.map((q, index) => (
                                <div className="manual-row" key={q.id}>
                                    <input
                                        type="number"
                                        min="1"
                                        className="form-input"
                                        value={q.value}
                                        onChange={e => updateManualQuestion(index, 'value', e.target.value)}
                                        aria-label={`Question ${index + 1} value`}
                                    />
                                    <div className="manual-fields">
                                        <textarea
                                            className="form-textarea"
                                            value={q.question}
                                            onChange={e => updateManualQuestion(index, 'question', e.target.value)}
                                            placeholder={`Clue ${index + 1}`}
                                            rows={2}
                                        />
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={q.answer}
                                            onChange={e => updateManualQuestion(index, 'answer', e.target.value)}
                                            placeholder="Answer"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {manualError && <div className="manual-error">{manualError}</div>}

                        <div className="modal-actions">
                            <button className="btn btn-primary" onClick={saveManualQuestions} disabled={manualSaving}>
                                {manualSaving ? 'Saving...' : '💾 Save Questions'}
                            </button>
                            <button className="btn btn-ghost btn-modal-cancel" onClick={closeManualEditor} disabled={manualSaving}>
                                ✕ Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
