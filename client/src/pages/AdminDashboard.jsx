import React, { useState, useEffect } from 'react';
import { API } from '../utils/api';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboard() {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const [showNewModal, setShowNewModal] = useState(false);
    const [newGameName, setNewGameName] = useState('My Game');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadGames();
    }, []);

    const loadGames = async () => {
        try {
            const data = await API.listGames();
            setGames(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleNewGame = async () => {
        console.log('New Game button clicked');
        const name = prompt('Enter a name for the new game:', newGameName || 'My Game');
        if (!name) return;
        setNewGameName(name);
        // open on next tick to avoid the original click event bubbling to the overlay
        setTimeout(() => setShowNewModal(true), 0);
    };

    const createGameWithMode = async (playerMode) => {
        const name = (newGameName || '').trim();
        if (!name) return alert('Please enter a name for the game.');
        try {
            setCreating(true);
            const game = await API.createGame(name, playerMode);
            setShowNewModal(false);
            navigate(`/host/${game.id}`);
        } catch (e) {
            console.error(e);
            alert('Failed to create game. See console for details.');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this game?')) return;
        try {
            await API.deleteGame(id);
            setGames(games.filter(g => g.id !== id));
        } catch (e) {
            console.error(e);
        }
    };

    const handleClone = async (e, id, name) => {
        e.stopPropagation();
        const cloneName = prompt('Name for the cloned game:', name + ' (Copy)');
        if (!cloneName) return;
        try {
            await API.cloneGame(id, cloneName);
            loadGames();
        } catch (e) {
            console.error(e);
        }
    };

    if (loading) return <div className="app-wrapper" style={{padding: '2rem'}}>Loading...</div>;

    return (
        <div id="games-dashboard" style={{ padding: '2rem' }}>
            <div style={{ width: '100%', maxWidth: '1100px', margin: '0 auto', boxSizing: 'border-box' }}>
                <div className="flex justify-between items-center mb-2">
                    <h2 style={{ fontSize: '1.4rem', color: 'var(--text-secondary)' }}>SAVED GAMES</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span className="text-muted text-sm">{games.length} {games.length === 1 ? 'game' : 'games'}</span>
                        <button type="button" className="btn btn-gold" onClick={handleNewGame}>✨ New Game</button>
                    </div>
                </div>

                <div className="games-grid">
                    {games.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">🃏</div>
                            <p>No games yet. Create your first game to get started!</p>
                            <button className="btn btn-primary" onClick={handleNewGame}>✨ New Game</button>
                        </div>
                    ) : (
                        games.map(g => (
                            <div key={g.id} className="game-card" onClick={() => navigate(`/host/${g.id}`)}>
                                <div className="game-card-title">{g.name}</div>
                                <div className="game-card-meta">
                                    <span className={`status-badge status-${g.status}`}>{g.status.toUpperCase()}</span>
                                    <span>{g.playerCount} Players</span>
                                    <span>{g.categoryCount} Categories</span>
                                </div>
                                <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.8rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                    <button className="btn btn-ghost btn-sm" onClick={(e) => handleClone(e, g.id, g.name)}>Clone</button>
                                    <button className="btn btn-ghost btn-danger btn-sm" onClick={(e) => handleDelete(e, g.id)}>Delete</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {showNewModal && (
                <div className="modal-overlay open" onClick={() => setShowNewModal(false)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h3 className="modal-title">CREATE NEW GAME</h3>
                        <p className="modal-sub">How will players join this game?</p>

                        <div className="mode-options">
                            <button type="button" className="mode-option-btn mode-option-btn--self" onClick={() => createGameWithMode('self_register')} disabled={creating}>
                                <span className="mode-icon">📱</span>
                                <span className="mode-copy">
                                    <span className="mode-title">Self-Register via Game Code</span>
                                    <span className="mode-desc">Players join on their phones using a 6-digit code. Buzzer functionality enabled.</span>
                                </span>
                            </button>

                            <button type="button" className="mode-option-btn mode-option-btn--manual" onClick={() => createGameWithMode('manual')} disabled={creating}>
                                <span className="mode-icon">✍️</span>
                                <span className="mode-copy">
                                    <span className="mode-title">Manually Add Players</span>
                                    <span className="mode-desc">You add players from the admin console. No buzzer functionality.</span>
                                </span>
                            </button>
                        </div>

                        <div style={{ marginTop: '.75rem' }}>
                            <button className="btn btn-ghost btn-modal-cancel" onClick={() => setShowNewModal(false)}>✕ Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
