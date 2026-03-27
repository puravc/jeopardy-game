import React, { useState, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useGameState } from '../hooks/useGameState';

export default function PlayerBuzzerView() {
    const { gameId } = useParams();
    const location = useLocation();
    const { game, loading, error, socketConnected, sendSocketMessage, connectWebSocket, questionTimer, buzzerQueue } = useGameState(gameId, false);
    const queryPlayerName = new URLSearchParams(location.search).get('name') || '';
    const initialPlayerName = queryPlayerName || location.state?.playerName || localStorage.getItem(`jeopardy_player_name_${gameId}`) || '';
    const fallbackGame = location.state?.game || null;
    const [playerName, setPlayerName] = useState(initialPlayerName);
    const [isJoined, setIsJoined] = useState(!!initialPlayerName);
    const [joining, setJoining] = useState(!!initialPlayerName);
    const [hasBuzzed, setHasBuzzed] = useState(false);
    const [scoreDelta, setScoreDelta] = useState(null);
    const [prevScore, setPrevScore] = useState(null);
    const questionIsOpen = !!questionTimer;

    // Find our current player as early as possible so follow-up effects keep a stable hook order.
    const activeGame = game || fallbackGame;
    const me = activeGame?.players?.find(p => p.name.toLowerCase() === playerName.toLowerCase());

    const meScore = me?.score ?? null;

    useEffect(() => {
        if (meScore === null) return;
        if (prevScore === null) {
            setPrevScore(meScore);
            return;
        }
        if (meScore !== prevScore) {
            const delta = meScore - prevScore;
            setScoreDelta(delta);
            setPrevScore(meScore);
            const timer = setTimeout(() => setScoreDelta(null), 1800);
            return () => clearTimeout(timer);
        }
    }, [meScore, prevScore]);

    useEffect(() => {
        if (queryPlayerName && queryPlayerName !== playerName) {
            setPlayerName(queryPlayerName);
            setIsJoined(true);
            setJoining(true);
            localStorage.setItem(`jeopardy_player_name_${gameId}`, queryPlayerName);
        }

        // If already have name, connect automatically
        if (isJoined && playerName && !socketConnected) {
            connectWebSocket(playerName);
        }
    }, [gameId, isJoined, playerName, socketConnected, connectWebSocket, queryPlayerName]);

    useEffect(() => {
        if (socketConnected) setJoining(false);
    }, [socketConnected]);

    useEffect(() => {
        setHasBuzzed(false);
    }, [questionTimer]);

    useEffect(() => {
        if (!initialPlayerName) return;
        const timeout = setTimeout(() => setJoining(false), 1500);
        return () => clearTimeout(timeout);
    }, [initialPlayerName]);

    const handleJoin = (e) => {
        e.preventDefault();
        if (!playerName.trim()) return;
        localStorage.setItem(`jeopardy_player_name_${gameId}`, playerName);
        setIsJoined(true);
        setJoining(true);
        connectWebSocket(playerName);
    };

    const handleBuzz = () => {
        if (hasBuzzed) return;
        setHasBuzzed(true);
        sendSocketMessage({ type: 'buzz', playerName });
    };

    if (loading) return <div className="app-wrapper" style={{padding: '2rem'}}>Loading buzzer...</div>;
    if (error) return <div className="app-wrapper" style={{padding: '2rem'}}>Error: {error}</div>;

    if (!isJoined) {
        return (
            <div className="view active">
                <div style={{ maxWidth: '400px', margin: '100px auto', padding: '2rem', background: 'var(--bg-glass)', borderRadius: '24px', border: '1px solid var(--border)', textAlign: 'center' }}>
                    <h1 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '3rem', color: 'var(--gold)', marginBottom: '1.5rem' }}>Join Game</h1>
                    <form onSubmit={handleJoin}>
                        <input 
                            type="text" 
                            className="form-control" 
                            placeholder="Enter your name" 
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            style={{ marginBottom: '1.5rem', textAlign: 'center', fontSize: '1.2rem', padding: '1rem' }}
                            autoFocus
                        />
                        <button type="submit" className="btn btn-gold btn-xl" style={{ width: '100%' }}>JOIN BROADCAST</button>
                    </form>
                </div>
            </div>
        );
    }

    const leaderboard = [...(activeGame?.players || [])].sort((a, b) => b.score - a.score);
    const myRank = me ? leaderboard.findIndex(p => p.id === me.id) + 1 : null;
    const myBuzzIndex = buzzerQueue?.findIndex(b => b.playerId === me?.id || b.name?.toLowerCase() === playerName.toLowerCase()) ?? -1;

    if (activeGame?.status === 'completed') {
        const MEDALS = ['🥇', '🥈', '🥉'];
        const myRankFinal = me ? leaderboard.findIndex(p => p.id === me.id) + 1 : null;
        const rankLabel = (r) => r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`;
        return (
            <div className="view active">
                <div style={{ maxWidth: '520px', margin: '40px auto', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
                    {/* Header */}
                    <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>🏁</div>
                    <h1 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '3.5rem', color: 'var(--gold)', marginBottom: '0.25rem', letterSpacing: '0.05em' }}>GAME OVER!</h1>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>The broadcast has ended. Thanks for playing!</p>

                    {/* Personal result */}
                    {me && (
                        <div style={{ padding: '1.5rem', background: 'var(--bg-glass)', borderRadius: '20px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                            {myRankFinal && (
                                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '1.4rem', color: myRankFinal === 1 ? 'var(--gold)' : 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
                                    {MEDALS[myRankFinal - 1] || '🎯'} You finished {rankLabel(myRankFinal)}!
                                </div>
                            )}
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Your Final Score</div>
                            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '4rem', color: me.score < 0 ? 'var(--red)' : 'var(--gold)' }}>
                                {me.score < 0 ? `-$${Math.abs(me.score).toLocaleString()}` : `$${me.score.toLocaleString()}`}
                            </div>
                        </div>
                    )}

                    {/* Full leaderboard */}
                    {leaderboard.length > 0 && (
                        <div style={{ background: 'var(--bg-glass)', borderRadius: '20px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', fontFamily: "'Bebas Neue',sans-serif", fontSize: '1.3rem', color: 'var(--gold)', letterSpacing: '0.1em' }}>
                                🏆 FINAL LEADERBOARD
                            </div>
                            {leaderboard.map((player, idx) => {
                                const isMe = me && player.id === me.id;
                                const rank = idx + 1;
                                const medal = MEDALS[idx] || null;
                                return (
                                    <div key={player.id} style={{
                                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                                        padding: '0.85rem 1.25rem',
                                        background: isMe ? 'rgba(245,197,66,0.08)' : rank === 1 ? 'rgba(245,197,66,0.04)' : 'transparent',
                                        borderBottom: idx < leaderboard.length - 1 ? '1px solid var(--border)' : 'none',
                                        borderLeft: isMe ? '3px solid var(--gold)' : '3px solid transparent',
                                    }}>
                                        <div style={{ width: '2rem', textAlign: 'center', fontFamily: "'Bebas Neue',sans-serif", fontSize: medal ? '1.4rem' : '1rem', color: rank === 1 ? 'var(--gold)' : 'var(--text-muted)', flexShrink: 0 }}>
                                            {medal || `#${rank}`}
                                        </div>
                                        <div style={{ flex: 1, textAlign: 'left', fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--gold)' : 'var(--text-primary)', fontSize: '1rem' }}>
                                            {isMe ? `${player.name} (You)` : player.name}
                                        </div>
                                        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '1.2rem', color: player.score < 0 ? 'var(--red)' : rank === 1 ? 'var(--gold)' : 'var(--text-primary)', flexShrink: 0 }}>
                                            {player.score < 0 ? `-$${Math.abs(player.score).toLocaleString()}` : `$${player.score.toLocaleString()}`}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="view active">
            <div className="game-layout">
                <main style={{width:'100%', maxWidth:'760px', margin:'0 auto', textAlign:'center', paddingTop:'2rem'}}>
                    <h1 style={{fontSize:'3.5rem', color:'var(--gold)', marginBottom: '0.25rem'}}>Jeopardy</h1>
                    <p style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:'2rem', color:'var(--text-primary)', letterSpacing:'0.05em', margin:'0 0 0.5rem'}}>{activeGame?.name || gameId}</p>

                    {playerName && (
                        <div className="player-identity-badge">
                            Playing as <span className="player-identity-name">{playerName}</span>
                        </div>
                    )}

                    {scoreDelta !== null && me && (
                        <div className={`player-score-banner ${scoreDelta > 0 ? 'positive' : 'negative'}`}>
                            <div className="player-score-banner-label">{scoreDelta > 0 ? 'Points awarded' : 'Points deducted'}</div>
                            <div className="player-score-banner-value">{scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}</div>
                            <div className="player-score-banner-copy">Your score is now {me.score < 0 ? `-$${Math.abs(me.score)}` : `$${me.score}`}</div>
                        </div>
                    )}

                    {me && <PlayerScoreCard player={me} />}

                    <div className="player-buzzer-section">
                        <div style={{ minHeight: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {questionIsOpen ? (
                                <button 
                                    className={`btn buzzer-btn player-buzzer-btn buzzer-live ${hasBuzzed ? 'buzzer-pressed' : ''}`} 
                                    onClick={handleBuzz}
                                    disabled={hasBuzzed}
                                    aria-label="Buzz in"
                                    aria-pressed={hasBuzzed}
                                >
                                    <span className="buzzer-label">{hasBuzzed ? 'BUZZED' : 'BUZZ'}</span>
                                </button>
                            ) : (
                                <div className="player-buzzer-locked">
                                    <div className="player-buzzer-locked-label">Buzzer Hidden</div>
                                    <div className="player-buzzer-locked-copy">
                                        Wait for the host to reveal a question.
                                    </div>
                                </div>
                            )}
                        </div>

                        {questionIsOpen && (
                            <div className="player-buzzer-status-card">
                                <div className="player-buzzer-status-label">Your Buzz Status</div>
                                <div className="player-buzzer-status-value">
                                    {hasBuzzed ? `Locked In${myBuzzIndex >= 0 ? ` • Position #${myBuzzIndex + 1}` : ''}` : 'Ready to buzz'}
                                </div>
                                {hasBuzzed && myBuzzIndex >= 0 && (
                                    <div className="player-buzzer-status-copy">You are currently #{myBuzzIndex + 1} in the queue.</div>
                                )}
                            </div>
                        )}

                        {game.playerMode === 'self_register' && (
                            <div className="player-buzzer-order card">
                                <div className="player-panel-title">🔔 Buzzer Order</div>
                                {buzzerQueue && buzzerQueue.length > 0 ? (
                                    <ol className="player-buzzer-order-list">
                                        {buzzerQueue.map((b, i) => {
                                            const isMeEntry = b.playerId === me?.id || b.name?.toLowerCase() === playerName.toLowerCase();
                                            const rankLabel = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
                                            return (
                                                <li key={`${b.playerId || b.name || i}-${i}`} className={`player-buzzer-order-item ${i === 0 ? 'first' : ''} ${isMeEntry ? 'mine' : ''}`}>
                                                    <span className="player-buzzer-order-rank">{rankLabel}</span>
                                                    <span className="player-buzzer-order-name">{isMeEntry ? 'You' : (b.name || 'Unknown player')}</span>
                                                    {i === 0 && <span className="player-buzzer-order-tag">Answers now</span>}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                ) : (
                                    <div className="player-buzzer-order-empty">Waiting for buzzers...</div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="player-leaderboard card">
                        <div className="player-panel-title">🏆 Leaderboard</div>
                        <div className="player-leaderboard-list">
                            {leaderboard.length > 0 ? leaderboard.map((player, index) => {
                                const isCurrentPlayer = me && player.id === me.id;
                                    const isTop = index === 0;
                                return (
                                        <div key={player.id} className={`player-leaderboard-row ${isCurrentPlayer ? 'me' : ''} ${isTop ? 'top' : ''}`}>
                                            <div className="player-leaderboard-rank">{isTop ? '1st' : `${index + 1}${index + 1 === 2 ? 'nd' : index + 1 === 3 ? 'rd' : 'th'}`}</div>
                                            <div className="player-leaderboard-name">{isCurrentPlayer ? 'You' : player.name}</div>
                                            <div className="player-leaderboard-score">{player.score < 0 ? `-$${Math.abs(player.score)}` : `$${player.score}`}</div>
                                    </div>
                                );
                            }) : (
                                <div className="player-leaderboard-empty">Waiting for players to join.</div>
                            )}
                        </div>
                    </div>
                    
                    <div style={{marginTop:'2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: socketConnected ? 'var(--green)' : 'var(--red)', fontWeight: 600}}>
                        <div style={{width: 8, height: 8, borderRadius: '50%', background: socketConnected ? 'var(--green)' : 'var(--red)', animation: socketConnected ? 'pulse 2s infinite' : 'none'}}></div>
                        {joining ? 'Joining...' : socketConnected ? 'Connected to Game' : 'Disconnected'}
                    </div>
                </main>
            </div>
        </div>
    );
}

function PlayerScoreCard({ player }) {
    const [prevScore, setPrevScore] = useState(player.score);
    const [effect, setEffect] = useState(null);

    useEffect(() => {
        if (player.score !== prevScore) {
            const diff = player.score - prevScore;
            setEffect({ amount: diff, type: diff > 0 ? 'positive' : 'negative' });
            setPrevScore(player.score);
            const timer = setTimeout(() => setEffect(null), 1200);
            return () => clearTimeout(timer);
        }
    }, [player.score, prevScore]);

    const isNegative = player.score < 0;

    return (
        <div className={`player-stats-bar ${effect ? 'updating' : ''}`} style={{ 
            marginTop: '2rem', 
            background: 'var(--bg-glass)', 
            padding: '1.25rem', 
            borderRadius: '20px', 
            border: '1px solid var(--border)',
            position: 'relative'
        }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Your Score</div>
            <div style={{ 
                fontFamily: "'Bebas Neue',sans-serif", 
                fontSize: '4.5rem', 
                color: isNegative ? 'var(--red)' : 'var(--gold)',
                letterSpacing: '0.05em'
            }}>
                {isNegative ? `-$${Math.abs(player.score)}` : `$${player.score}`}
            </div>
            
            {effect && (
                <div className={`score-change-anim ${effect.type}`} style={{ right: 'auto', left: '50%', transform: 'translateX(-50%)' }}>
                    {effect.amount > 0 ? `+${effect.amount}` : effect.amount}
                </div>
            )}
        </div>
    );
}
