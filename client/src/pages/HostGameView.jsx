import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameState } from '../hooks/useGameState';
import { API } from '../utils/api';
import HostSetup from '../components/HostSetup';
import JeopardyBoard from '../components/JeopardyBoard';
import QuestionModal from '../components/QuestionModal';

export default function HostGameView() {
    const { gameId } = useParams();
    const navigate = useNavigate();
    const { 
        game, setGame, loading, error, socketConnected, sendSocketMessage, loadGame,
        activeQuestion, setActiveQuestion, buzzerQueue, questionTimer
    } = useGameState(gameId, true);
    const [mobileTab, setMobileTab] = useState('board');
    const [resetConfirm, setResetConfirm] = useState(false);
    const [resetting, setResetting] = useState(false);

    if (loading) return <div className="app-wrapper" style={{padding: '2rem'}}>Loading game...</div>;
    if (error) return <div className="app-wrapper" style={{padding: '2rem'}}>Error: {error}</div>;
    if (!game) return <div className="app-wrapper">Game not found</div>;

    // Based on game status, render Admin Console or The Actual Game Board
    if (game.status === 'configuring') {
        return (
            <div className="view active">
                <HostSetup game={game} setGame={setGame} loadGame={loadGame} sendSocketMessage={sendSocketMessage} />
            </div>
        );
    }

    if (game.status === 'completed') {
        return (
            <div className="view active">
                <GameResults game={game} onBack={() => navigate('/dashboard')} />
            </div>
        );
    }

    const handleTileClick = (categoryId, questionId) => {
        setActiveQuestion({ categoryId, questionId });
        sendSocketMessage({ type: 'open_question', questionId });
    };

    const handleCloseModal = () => {
        setActiveQuestion(null);
        sendSocketMessage({ type: 'close_question' });
    };

    const handleAward = async (playerId) => {
        const updatedGame = await API.awardPoints(gameId, activeQuestion.questionId, playerId, activeQuestion.categoryId);
        console.debug('award response', updatedGame);
        setGame(updatedGame?.value || updatedGame);
        handleCloseModal();
    };

    const handleDeduct = async (playerId) => {
        // First deduct points (server will record wrong guess)
        const deductResp = await API.deductPoints(gameId, activeQuestion.questionId, playerId, activeQuestion.categoryId);
        console.debug('deduct response', deductResp);

        // Then ask the server to close/skip the question so it's removed authoritative from the board.
        // This avoids local-state races with websocket updates.
        try {
            const skipResp = await API.skipQuestion(gameId, activeQuestion.questionId, activeQuestion.categoryId);
            console.debug('skip response after deduct', skipResp);
            setGame(skipResp?.value || skipResp || deductResp?.value || deductResp);
        } catch (err) {
            // Fallback: apply deduct response and also remove locally
            console.error('skip after deduct failed', err);
            setGame(deductResp?.value || deductResp);
            try {
                const catId = activeQuestion?.categoryId;
                const qId = activeQuestion?.questionId;
                setGame(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        categories: prev.categories.map(c => {
                            if (c.id !== catId) return c;
                            return { ...c, questions: (c.questions || []).filter(q => q.id !== qId) };
                        })
                    };
                });
            } catch (e) {
                console.error('local remove after skip failure also failed', e);
            }
        }

        handleCloseModal();
    };

    const handleSkip = async () => {
        const updatedGame = await API.skipQuestion(gameId, activeQuestion.questionId, activeQuestion.categoryId);
        console.debug('skip response', updatedGame);
        setGame(updatedGame?.value || updatedGame);
        handleCloseModal();
    };

    const handleResetGame = async () => {
        setResetting(true);
        try {
            await API.resetGame(gameId);
            setResetConfirm(false);
            await loadGame();
        } catch (e) {
            console.error('Reset failed', e);
        } finally {
            setResetting(false);
        }
    };

    const answeredCount = game.categories?.reduce((acc, c) => acc + (c.questions?.filter(q => q.answered).length || 0), 0) || 0;
    const totalQ = game.categories?.reduce((acc, c) => acc + (c.questions?.length || 0), 0) || 0;

    return (
        <div className="view active">
            <div className="host-mobile-tabs">
                <button className={`host-tab ${mobileTab === 'board' ? 'active' : ''}`} onClick={() => setMobileTab('board')}>📋 Board</button>
                <button className={`host-tab ${mobileTab === 'scores' ? 'active' : ''}`} onClick={() => setMobileTab('scores')}>📊 Scores</button>
                <button className={`host-tab ${mobileTab === 'info' ? 'active' : ''}`} onClick={() => setMobileTab('info')}>⚙️ Info</button>
            </div>
            <div className="game-layout">
                <div className={`game-board-area${mobileTab !== 'board' ? ' host-tab-hidden' : ''}`}>
                    <h1 className="game-board-title">{game.name.toUpperCase()}</h1>
                    <JeopardyBoard game={game} onTileClick={handleTileClick} />
                </div>
                <aside className={`game-sidebar${mobileTab === 'board' ? ' host-tab-hidden' : ''}`}>
                    <div className={mobileTab === 'info' ? 'host-tab-hidden' : ''}>
                        <p className="sidebar-section-title">📊 Scoreboard</p>
                        <div className="scoreboard">
                            {(() => {
                                const sortedPlayers = [...game.players].sort((a,b) => b.score - a.score);
                                const maxScore = Math.max(...sortedPlayers.map(p => p.score), -Infinity);
                                
                                return sortedPlayers.map(p => {
                                    const isLeading = p.score === maxScore && p.score !== 0;
                                    return <ScoreboardItem key={p.id} player={p} isLeading={isLeading} />;
                                });
                            })()}
                        </div>
                    </div>
                    <div className={mobileTab === 'scores' ? 'host-tab-hidden' : ''}>
                        <p className="sidebar-section-title">📈 Progress</p>
                        <div className="progress-info">
                            <div className="progress-label">Questions Answered</div>
                            <div className="progress-bar-bg">
                                <div className="progress-bar-fill" style={{ width: `${(answeredCount / totalQ) * 100}%` }}></div>
                            </div>
                            <div className="progress-text">{answeredCount} / {totalQ}</div>
                        </div>
                    </div>
                    <div className={`game-controls${mobileTab === 'scores' ? ' host-tab-hidden' : ''}`}>
                        <p className="sidebar-section-title">⚙️ Controls</p>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>← Back to Admin</button>
                        {!resetConfirm ? (
                            <button className="btn btn-danger btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setResetConfirm(true)}>↺ Reset Game</button>
                        ) : (
                            <div style={{ marginTop: '0.5rem' }}>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Reset all scores &amp; questions?</p>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <button className="btn btn-danger btn-sm" onClick={handleResetGame} disabled={resetting}>
                                        {resetting ? 'Resetting…' : 'Yes, Reset'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setResetConfirm(false)} disabled={resetting}>Cancel</button>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {game.playerMode === 'self_register' && (
                        <div id="buzzer-panel" className={mobileTab === 'scores' ? 'host-tab-hidden' : ''}>
                            <p className="sidebar-section-title">🔔 Buzzers</p>
                            <div style={{ marginBottom: '.75rem' }}>
                                <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Join at this device — code:</div>
                                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '2rem', color: 'var(--gold)', letterSpacing: '.15em' }}>{game.joinCode}</div>
                            </div>
                        </div>
                    )}
                </aside>
            </div>

            <QuestionModal 
                game={game} 
                activeQuestion={activeQuestion} 
                onClose={handleCloseModal}
                onAward={handleAward}
                onDeduct={handleDeduct}
                onSkip={handleSkip}
                buzzerQueue={buzzerQueue}
                questionTimer={questionTimer}
                loadGame={loadGame}
            />
        </div>
    );
}

function ScoreboardItem({ player, isLeading }) {
    const [prevScore, setPrevScore] = useState(player.score);
    const [effect, setEffect] = useState(null); // { amount, type }

    useEffect(() => {
        if (player.score !== prevScore) {
            const diff = player.score - prevScore;
            setEffect({ amount: diff, type: diff > 0 ? 'positive' : 'negative' });
            setPrevScore(player.score);
            
            // Clear effect after animation
            const timer = setTimeout(() => setEffect(null), 1200);
            return () => clearTimeout(timer);
        }
    }, [player.score, prevScore]);

    const isNegative = player.score < 0;

    return (
        <div className={`score-card ${isLeading ? 'leading' : ''} ${effect ? 'updating' : ''}`}>
            <div className="sb-avatar">{player.name[0].toUpperCase()}</div>
            <div className="sb-info">
                <div className="sb-name">{player.name}</div>
                <div className={`sb-score ${isNegative ? 'negative' : ''}`}>
                    {isNegative ? `-$${Math.abs(player.score)}` : `$${player.score}`}
                </div>
            </div>
            {isLeading && (
                <div className="sb-badge" style={{
                    fontSize: '0.65rem',
                    fontWeight: 800,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    padding: '0.2rem 0.5rem',
                    background: 'rgba(245, 197, 66, 0.1)',
                    borderRadius: '4px',
                    border: '1px solid rgba(245, 197, 66, 0.3)'
                }}>
                    Leader
                </div>
            )}
            
            {effect && (
                <div className={`score-change-anim ${effect.type}`}>
                    {effect.amount > 0 ? `+${effect.amount}` : effect.amount}
                </div>
            )}
        </div>
    );
}

function GameResults({ game, onBack }) {
    const sortedPlayers = [...game.players].sort((a, b) => b.score - a.score);
    const winners = sortedPlayers.slice(0, 3);
    const others = sortedPlayers.slice(3);
    const confettiRef = useRef(null);
    useConfetti(confettiRef);
    return (
        <div className="game-results-overlay">
            <canvas ref={confettiRef} className="confetti-canvas" />
            <div className="game-results-inner">
                <div className="results-header">
                    <div className="results-trophy">🏆</div>
                    <h1 className="results-title">Final Results</h1>
                    <p className="results-sub">The broadcast has concluded. Here are your champions.</p>
                </div>

                <div className="podium">
                    {winners[1] && <PodiumSpot player={winners[1]} rank={2} />}
                    {winners[0] && <PodiumSpot player={winners[0]} rank={1} />}
                    {winners[2] && <PodiumSpot player={winners[2]} rank={3} />}
                </div>

                {others.length > 0 && (
                    <div className="other-competitors card">
                        <h3 className="other-title">Other Competitors</h3>
                        <div className="other-table-wrap">
                            <table className="other-table">
                                <thead>
                                    <tr>
                                        <th>Rank</th>
                                        <th>Name</th>
                                        <th style={{ textAlign: 'right' }}>Score</th>
                                        <th style={{ textAlign: 'right' }}>Attempts</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {others.map((p, i) => (
                                        <tr key={p.id}>
                                            <td className="td-rank">#{i + 4}</td>
                                            <td className="td-name">{p.name}</td>
                                            <td className="td-score">${p.score.toLocaleString()}</td>
                                            <td className="td-attempts">{game.stats?.[p.id]?.attempted || 0}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                <div className="results-actions">
                    <button className="btn btn-gold btn-xl" onClick={onBack}>BACK TO DASHBOARD</button>
                </div>
            </div>
        </div>
    );
}

// Lightweight confetti: create particles on mount and animate for 3s
function useConfetti(canvasRef) {
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let W = canvas.width = window.innerWidth;
        let H = canvas.height = window.innerHeight;

        const colors = ['#f5c542','#60a5fa','#8b5cf6','#10b981','#f97316','#ef4444'];
        const particles = [];
        const count = 160;
        const rand = (a, b) => Math.random() * (b - a) + a;

        for (let i = 0; i < count; i++) {
            particles.push({
                x: rand(0, W),
                y: rand(-H, 0),
                r: rand(4, 9),
                d: rand(0.5, 1.5),
                color: colors[Math.floor(Math.random() * colors.length)],
                tilt: rand(-10, 10),
                tiltAngle: 0,
                tiltAngleIncrement: rand(0.05, 0.12)
            });
        }

        let stop = false;
        let raf = null;

        function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }

        function draw() {
            ctx.clearRect(0, 0, W, H);
            for (let p of particles) {
                p.tiltAngle += p.tiltAngleIncrement;
                p.y += Math.cos(p.d) + 3 + p.r / 2;
                p.x += Math.sin(p.d);
                p.tilt = Math.sin(p.tiltAngle) * 15;
                ctx.beginPath();
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x + p.tilt, p.y, p.r, p.r * 0.6);
            }
            if (!stop) raf = requestAnimationFrame(draw);
        }

        window.addEventListener('resize', resize);
        raf = requestAnimationFrame(draw);

        const timer = setTimeout(() => {
            stop = true;
            if (raf) cancelAnimationFrame(raf);
            ctx.clearRect(0, 0, W, H);
        }, 3000);

        return () => {
            stop = true;
            clearTimeout(timer);
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
            try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (e) {}
        };
    }, [canvasRef]);
}

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function PodiumSpot({ player, rank }) {
    const rankClass = rank === 1 ? 'first' : rank === 2 ? 'second' : 'third';
    return (
        <div className={`podium-spot ${rankClass}`}>
            {rank === 1 && <div className="podium-crown">👑</div>}
            <div className="podium-card">
                <div className={`avatar avatar-rank-${rank}`}>{player.name[0].toUpperCase()}</div>
                <div className="podium-name">{player.name}</div>
                <div className="podium-score">${player.score.toLocaleString()}</div>
                <div className="podium-medal">{MEDALS[rank]}</div>
            </div>
            <div className={`podium-platform rank-${rank}`}>
                <span className="podium-rank-num">#{rank}</span>
            </div>
        </div>
    );
}
