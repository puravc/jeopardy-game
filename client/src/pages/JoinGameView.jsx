import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../utils/api';

export default function JoinGameView() {
    const navigate = useNavigate();
    const [joinCode, setJoinCode] = useState('');
    const [game, setGame] = useState(null);
    const [playerName, setPlayerName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [joining, setJoining] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const code = joinCode.trim().toUpperCase();
        if (!code) return;
        try {
            setError('');
            setLoading(true);
            // Pass stored player name so existing players can re-lookup after game starts
            const storedName = localStorage.getItem(`jeopardy_player_name_by_code_${code}`);
            const game = await API.getJoinGame(code, storedName || undefined);
            setGame(game);
        } catch (err) {
            setError(err.message || 'Unable to join game.');
        } finally {
            setLoading(false);
        }
    };

    const handleNameSubmit = (e) => {
        e.preventDefault();
        const name = playerName.trim();
        if (!game || !name) return;
        localStorage.setItem(`jeopardy_player_name_${game.id}`, name);
        localStorage.setItem(`jeopardy_player_name_by_code_${game.joinCode}`, name);
        setJoining(true);
        navigate(`/play/${game.id}?name=${encodeURIComponent(name)}`, { state: { game, playerName: name } });
    };

    return (
        <div className="view active">
            <div className="join-code-shell">
                <div className="join-code-card">
                    <div className="join-code-badge">SELF REGISTER</div>
                    {!game ? (
                        <>
                            <h1 className="join-code-title">Enter Game Code</h1>
                            <p className="join-code-subtitle">Use the 6-character code shared by your host to join the game.</p>

                            <form onSubmit={handleSubmit} className="join-code-form">
                                <input
                                    className="join-code-input"
                                    value={joinCode}
                                    onChange={(e) => setJoinCode(e.target.value)}
                                    placeholder="ABC123"
                                    autoCapitalize="characters"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    maxLength={6}
                                    autoFocus
                                />
                                <button type="submit" className="btn btn-gold btn-xl join-code-button" disabled={loading}>
                                    {loading ? 'CHECKING...' : 'JOIN GAME'}
                                </button>
                            </form>
                        </>
                    ) : (
                        <>
                            <h1 className="join-code-title">Welcome to {game.name}</h1>
                            <p className="join-code-subtitle">Code accepted. Enter your name to join the buzzer room.</p>

                            <form onSubmit={handleNameSubmit} className="join-code-form">
                                <input
                                    className="join-code-input"
                                    value={playerName}
                                    onChange={(e) => setPlayerName(e.target.value)}
                                    placeholder="Your name"
                                    autoFocus
                                />
                                <button type="submit" className="btn btn-gold btn-xl join-code-button" disabled={loading || joining}>
                                    {joining ? 'JOINING...' : 'ENTER GAME'}
                                </button>
                            </form>
                        </>
                    )}

                    {error && <div className="join-code-error">{error}</div>}
                </div>
            </div>
        </div>
    );
}