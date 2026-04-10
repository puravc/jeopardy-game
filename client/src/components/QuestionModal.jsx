import React, { useState, useEffect } from 'react';
import { API } from '../utils/api';

export default function QuestionModal({ game, activeQuestion, onClose, onAward, onDeduct, onSkip, buzzerQueue, questionTimer, loadGame, disableScoring = false }) {
    const [showingAnswer, setShowingAnswer] = useState(false);
    const [processingId, setProcessingId] = useState(null); // ID of player being processed
    const [, setTick] = useState(0);

    useEffect(() => {
        if (!questionTimer) return;
        const interval = setInterval(() => {
            setTick(t => t + 1);
        }, 100); // 100ms for smoother visual if needed, but 1s is fine for Jeopardy
        return () => clearInterval(interval);
    }, [questionTimer]);

    if (!activeQuestion) return null;

    const category = game.categories.find(c => c.id === activeQuestion.categoryId);
    const question = category?.questions.find(q => q.id === activeQuestion.questionId);

    if (!category || !question) return null;

    return (
        <div className="modal-overlay open">
            <div className="modal">
                <button className="modal-close" onClick={onClose}>✕</button>
                <div className="modal-category">{category.name}</div>
                <div className="modal-value">${question.value}</div>
                <div className="modal-question">{question.question}</div>

                {question.wrongAnswers?.length > 0 && !disableScoring && (
                    <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                        <button className="btn btn-ghost btn-sm" onClick={async () => {
                            if (window.confirm('Reset all wrong guesses for this question?')) {
                                await API.resetQuestion(game.id, question.id, activeQuestion.categoryId);
                                loadGame();
                            }
                        }}>🔄 Reset Guessers</button>
                    </div>
                )}

                {(() => {
                    if (!questionTimer) return null;
                    const remaining = Math.max(0, Math.ceil((questionTimer - Date.now()) / 1000));
                    return (
                        <div style={{ textAlign: 'center', marginBottom: '1rem', fontFamily: "'Bebas Neue',sans-serif", fontSize: '4rem', color: 'var(--gold)' }}>
                            <span>{remaining}</span><span style={{ fontSize: '1.5rem', color: 'var(--text-muted)', marginLeft: '5px' }}>s</span>
                        </div>
                    );
                })()}

                {showingAnswer ? (
                    <div className="modal-answer-reveal" style={{ display: 'block' }}>
                        <div className="modal-answer-label">Answer</div>
                        <div>{question.answer}</div>
                    </div>
                ) : null}

                {game.playerMode === 'self_register' && (
                    <div style={{ margin: '0.75rem 0', padding: '0.75rem 1rem', background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '12px' }}>
                        <div style={{ fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text-muted)', marginBottom: '.5rem' }}>🔔 Buzz Order</div>
                        {buzzerQueue && buzzerQueue.length > 0 ? (
                            <ol style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                                {buzzerQueue.map((b, i) => {
                                    const resolvedName = b.name || game.players.find(p => p.id === b.playerId)?.name || 'Unknown player';
                                    return (
                                    <li key={i} style={{ 
                                        fontSize: i === 0 ? '1.05rem' : '.9rem', 
                                        fontWeight: i === 0 ? 700 : 400, 
                                        color: i === 0 ? 'var(--gold)' : 'var(--text-secondary)',
                                        padding: i === 0 ? '.3rem .5rem' : '0 .5rem',
                                        background: i === 0 ? 'rgba(255,215,0,0.08)' : 'transparent',
                                        borderRadius: i === 0 ? '6px' : '0'
                                    }}>
                                        {i === 0 && '🥇 '} {resolvedName}
                                        {i === 0 && <span style={{ marginLeft: '.5rem', fontSize: '.75rem', color: 'var(--gold)', opacity: .8 }}>← answers now</span>}
                                    </li>
                                    );
                                })}
                            </ol>
                        ) : (
                            <div style={{ color: 'var(--text-muted)', fontSize: '.85rem', fontStyle: 'italic' }}>Waiting for buzzers...</div>
                        )}
                    </div>
                )}

                <div className="modal-divider"></div>

                <div className="modal-award-section">
                    <div className="modal-award-title">Who answered?</div>
                    {disableScoring ? (
                        <div style={{
                            textAlign: 'center',
                            padding: '0.9rem 1rem',
                            background: 'rgba(245,197,66,0.10)',
                            border: '1px solid rgba(245,197,66,0.35)',
                            borderRadius: '10px',
                            color: 'var(--text-secondary)'
                        }}>
                            Preview mode is active. Point assignment is disabled.
                        </div>
                    ) : (
                        <div className="player-award-grid">
                            {game.players.map(p => {
                                const hasGuessedWrong = question.wrongAnswers?.includes(p.id);
                                const wasRight = question.answered && question.answeredBy === p.id;
                                return (
                                    <div key={p.id} className={`player-award-card ${wasRight ? 'active' : ''}`} style={{ border: wasRight ? '2px solid var(--green)' : '1px solid var(--border)' }}>
                                        <div>{p.name} {hasGuessedWrong && <span style={{fontSize: '0.7rem', color: 'var(--red)'}}>(Wrong)</span>}</div>
                                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                                            <button 
                                                className="btn btn-primary btn-sm" 
                                                style={{ padding: '0.2rem 0.5rem' }} 
                                                disabled={!!processingId}
                                                onClick={async () => { 
                                                    setProcessingId(p.id);
                                                    try {
                                                        await onAward(p.id); 
                                                    } catch (err) {
                                                        alert('Award failed: ' + err.message);
                                                    } finally {
                                                        setProcessingId(null);
                                                        setShowingAnswer(false); 
                                                    }
                                                }}
                                            >
                                                {processingId === p.id ? '...' : '✅ Right'}
                                            </button>
                                            <button 
                                                className="btn btn-danger btn-sm" 
                                                style={{ padding: '0.2rem 0.5rem' }} 
                                                disabled={!!processingId}
                                                onClick={async () => {
                                                    setProcessingId(p.id);
                                                    try {
                                                        await onDeduct(p.id);
                                                    } catch (err) {
                                                        alert('Wrong answer failed: ' + err.message);
                                                    } finally {
                                                        setProcessingId(null);
                                                    }
                                                }}
                                            >
                                                {processingId === p.id ? '...' : '❌ Wrong'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <div className="modal-actions" style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                        <button className="btn btn-ghost" onClick={() => setShowingAnswer(true)}>👁 Reveal Answer</button>
                        <button className="btn btn-danger" onClick={() => { onSkip(); setShowingAnswer(false); }}>
                            {disableScoring ? '⏭ Mark As Seen' : '⏭ Skip (No Points)'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
