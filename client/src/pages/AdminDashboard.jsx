import React, { useState, useEffect } from 'react';
import { API } from '../utils/api';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboard() {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [ownerLoading, setOwnerLoading] = useState(false);
    const [ownerAnalytics, setOwnerAnalytics] = useState(null);
    const [ownerAnalyticsError, setOwnerAnalyticsError] = useState('');
    const [ownerWindowDays, setOwnerWindowDays] = useState(30);
    const navigate = useNavigate();
    const [showNewModal, setShowNewModal] = useState(false);
    const [newGameName, setNewGameName] = useState('My Game');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadGames();
    }, []);

    useEffect(() => {
        loadOwnerAnalytics(ownerWindowDays);
    }, [ownerWindowDays]);

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

    const loadOwnerAnalytics = async (days) => {
        try {
            setOwnerLoading(true);
            setOwnerAnalyticsError('');
            const data = await API.getOwnerDashboardV1(days);
            setOwnerAnalytics(data);
        } catch (e) {
            // If this user is not owner-scoped, keep dashboard usable and simply hide owner analytics.
            setOwnerAnalytics(null);
            setOwnerAnalyticsError(e.message || 'Owner analytics unavailable');
        } finally {
            setOwnerLoading(false);
        }
    };

    const statusDistribution = ownerAnalytics?.charts?.gameStatusDistribution || {
        configuring: 0,
        active: 0,
        paused: 0,
        completed: 0,
    };
    const dailyTrend = ownerAnalytics?.charts?.dailyGamesCreated || [];
    const topAdmins = ownerAnalytics?.tables?.topAdmins || [];
    const maxDaily = Math.max(1, ...dailyTrend.map((point) => point.count || 0));

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
                {ownerLoading && <div className="text-muted" style={{ marginBottom: '1rem' }}>Loading owner analytics...</div>}

                {!ownerLoading && ownerAnalytics && (
                    <section style={{ marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-secondary)' }}>OWNER DASHBOARD V1</h2>
                            <select
                                value={ownerWindowDays}
                                onChange={(e) => setOwnerWindowDays(Number(e.target.value))}
                                className="input"
                                style={{ maxWidth: '140px' }}
                            >
                                <option value={7}>Last 7 days</option>
                                <option value={30}>Last 30 days</option>
                                <option value={90}>Last 90 days</option>
                            </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Monthly Active Admins</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{ownerAnalytics.kpis.monthlyActiveAdmins}</div>
                            </div>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Games Created (7d / 30d)</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{ownerAnalytics.kpis.gamesCreatedLast7} / {ownerAnalytics.kpis.gamesCreatedLast30}</div>
                            </div>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Monthly Active Players</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{ownerAnalytics.kpis.monthlyActivePlayers}</div>
                            </div>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Avg Players per Game</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{ownerAnalytics.kpis.avgPlayersPerGame}</div>
                            </div>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Game Completion Rate</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{ownerAnalytics.kpis.gameCompletionRate}%</div>
                            </div>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Join-Code Redemption</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{ownerAnalytics.kpis.joinCodeRedemptionRate}%</div>
                            </div>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Question Bank Growth</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>+{ownerAnalytics.kpis.questionBankGrowthInWindow}</div>
                            </div>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm">Total Question Bank</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{ownerAnalytics.kpis.totalQuestionBank}</div>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.8rem' }}>
                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>Daily Games Created ({ownerWindowDays}d)</div>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', minHeight: '120px' }}>
                                    {dailyTrend.map((point) => (
                                        <div key={point.date} title={`${point.date}: ${point.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            <div
                                                style={{
                                                    width: '100%',
                                                    minHeight: point.count > 0 ? '3px' : '1px',
                                                    height: `${Math.max(3, Math.round((point.count / maxDaily) * 100))}px`,
                                                    background: 'var(--gold)',
                                                    borderRadius: '4px 4px 0 0',
                                                    opacity: 0.85,
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="card" style={{ padding: '0.75rem' }}>
                                <div className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>Game Status Distribution</div>
                                <div style={{ display: 'grid', gap: '0.4rem' }}>
                                    <div>Configuring: {statusDistribution.configuring}</div>
                                    <div>Active: {statusDistribution.active}</div>
                                    <div>Paused: {statusDistribution.paused}</div>
                                    <div>Completed: {statusDistribution.completed}</div>
                                </div>
                            </div>
                        </div>

                        <div className="card" style={{ padding: '0.75rem', marginTop: '0.8rem' }}>
                            <div className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>Top Admins by Games Created</div>
                            {topAdmins.length === 0 ? (
                                <div className="text-muted">No activity in selected window.</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={{ textAlign: 'left', paddingBottom: '0.3rem' }}>Admin</th>
                                            <th style={{ textAlign: 'right', paddingBottom: '0.3rem' }}>Games</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topAdmins.map((row) => (
                                            <tr key={row.email}>
                                                <td style={{ padding: '0.2rem 0' }}>{row.email}</td>
                                                <td style={{ textAlign: 'right', padding: '0.2rem 0' }}>{row.gamesCreated}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>
                )}

                {!ownerLoading && ownerAnalyticsError && !ownerAnalytics && (
                    <div className="text-muted" style={{ marginBottom: '1rem' }}>
                        Owner analytics not shown: {ownerAnalyticsError}
                    </div>
                )}

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
